/**
 * mux 事件流客户端：连接 `/api/events.mux` 读取服务端事件。
 *
 * 协议变更：DSH host 已将 `/api/events.mux` 从 SSE（GET + `data:` 帧）切换到 **WebSocket**。
 * 线上观测（host rev dcccb8324e44）：`GET /api/events.mux` 返回 `426 Upgrade Required`，
 * `upgrade: websocket`；改为 `ws://…/api/events.mux` 连接后，每条消息是纯 JSON 字符串，
 * 即 ServerRequest 信封 `{ type:"server-request", rpcId, method, payload }`，payload 是 MuxFrame。
 * 信封格式与旧 SSE `data:` 载荷完全一致，仅传输层从 SSE 换成 WebSocket。
 *
 * 本模块只做传输：把服务端消息流变成一个个 MuxFrame 信封。业务折叠在 live.js。
 * 零依赖：用 Node ≥22 内建全局 `WebSocket`（可注入 `WebSocketImpl` 单测）。
 */
import { DshClient } from "./client.js";

/** 从 SSE 块里抽出 data: 载荷（多行 data 连接；无 data 行返回 ""）。保留：兼容历史/测试。 */
export function extractSseData(chunk) {
	return chunk
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => line.slice(6))
		.join("");
}

/** 解析一帧 JSON 为 ServerRequest 信封；非法返回 null（坏帧跳过，不杀流）。 */
export function parseServerRequest(raw) {
	try {
		const message = JSON.parse(raw);
		if (!message || message.type !== "server-request" || typeof message.payload !== "object") {
			return null;
		}
		return message;
	} catch {
		return null;
	}
}

/**
 * 逐消息读取 mux WebSocket 流。yield 的是 ServerRequest 信封 `{ type, rpcId, method, payload }`
 * —— payload 是 MuxFrame（含 type 判别），rpcId 供应答（question/approval requested）。
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal] - 关闭流的信号（close() 用）。
 * @param {() => void} [opts.onOpen] - 连接建立、可收消息时回调（流已建立信号）。
 * @param {typeof WebSocket} [opts.WebSocketImpl] - 注入测试用 WebSocket 实现。
 */
export class MuxStream {
	constructor(baseUrl, { fetchImpl = fetch, WebSocketImpl = (typeof WebSocket !== "undefined" ? WebSocket : undefined) } = {}) {
		this.baseUrl = String(baseUrl).replace(/\/+$/, "");
		this.fetchImpl = fetchImpl;
		this.WebSocketImpl = WebSocketImpl;
	}

	/** http(s):// → ws(s)://（同一 host/port 的 WebSocket 入口）。 */
	#wsUrl() {
		return this.baseUrl.replace(/^http/i, "ws") + "/api/events.mux";
	}

	async *frames({ signal, onOpen, WebSocketImpl } = {}) {
		const Impl = WebSocketImpl ?? this.WebSocketImpl;
		if (!Impl) {
			throw new Error("无 WebSocket 实现（Node ≥22 内建全局 WebSocket，或注入 WebSocketImpl）");
		}
		const ws = new Impl(this.#wsUrl());
		// 消息队列 + 终止信号：把事件回调桥接成 async 迭代。
		const inbox = [];
		let closed = false;
		let closeError = null;
		let wake = null;

		const settle = () => { if (wake) { const w = wake; wake = null; w(); } };

		ws.addEventListener("open", () => { onOpen?.(); settle(); });
		ws.addEventListener("message", (ev) => {
			const message = parseServerRequest(typeof ev.data === "string" ? ev.data : String(ev.data ?? ""));
			if (!message) return; // 坏帧跳过，不杀流
			inbox.push(message);
			settle();
		});
		ws.addEventListener("error", (ev) => {
			closeError = closeError ?? new Error(`transport failure for events.mux: ${ev.message || "websocket error"}`);
			settle();
		});
		ws.addEventListener("close", () => { closed = true; settle(); });
		const onAbort = () => { try { ws.close(); } catch {} closed = true; settle(); };
		if (signal) {
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}

		try {
			for (;;) {
				while (inbox.length === 0 && !closed) {
					await new Promise((r) => { wake = r; });
				}
				if (inbox.length > 0) yield inbox.shift();
				else if (closed) {
					if (closeError) throw closeError;
					return;
				}
			}
		} finally {
			if (signal) signal.removeEventListener("abort", onAbort);
			try { ws.close(); } catch {}
		}
	}
}

/** 应答一个可应答的 server-request（approval/question requested 用），走 /api/respond。 */
export async function respond(client, rpcId, result) {
	return client.respond(rpcId, result);
}
