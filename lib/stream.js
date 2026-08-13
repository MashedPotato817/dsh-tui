/**
 * mux 事件流客户端：GET /api/events.mux 的 SSE 读取。
 *
 * 线上格式（探测自 dsh-host-apiproxy 的 sseResponse / readSse）：
 * - 开流先发 `: connected\n\n` 注释行（不是帧，跳过）。
 * - 每帧 `data: <JSON>\n\n`，JSON 是 ServerRequest 信封
 *   `{ type: "server-request", rpcId, method, payload }`，payload 即 MuxFrame。
 * - 中途失败发一个 stream/error 帧后关闭；客户端按帧容错，坏帧跳过不杀流。
 *
 * 本模块只做传输：把线上字节流变成一个个 MuxFrame。业务折叠在 live.js。
 */
import { DshClient } from "./client.js";

/** 从 SSE 块里抽出 data: 载荷（多行 data 连接；无 data 行返回 ""）。 */
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
 * 逐帧读取 mux 流。yield 的是 MuxFrame payload（含 type 判别）。
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal] - 关闭流的信号（close() 用）。
 * @param {() => void} [opts.onOpen] - 响应头就绪、流可读时回调（流已建立信号）。
 * @param {typeof fetch} [opts.fetchImpl] - 注入测试用 fetch。
 */
export class MuxStream {
	constructor(baseUrl, { fetchImpl = fetch } = {}) {
		this.baseUrl = String(baseUrl).replace(/\/+$/, "");
		this.fetchImpl = fetchImpl;
	}

	async *frames({ signal, onOpen } = {}) {
		const response = await this.fetchImpl(`${this.baseUrl}/api/events.mux`, { signal });
		if (!response.ok || !response.body) {
			throw new Error(`transport failure for events.mux: HTTP ${response.status}`);
		}
		onOpen?.();

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) return;
				buffer += decoder.decode(value, { stream: true });
				let boundary;
				while ((boundary = buffer.indexOf("\n\n")) !== -1) {
					const chunk = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const data = extractSseData(chunk);
					if (data === "") continue; // 注释行 / 心跳
					const message = parseServerRequest(data);
					if (!message) continue; // 坏帧跳过
					yield message.payload;
				}
			}
		} finally {
			reader.releaseLock?.();
		}
	}
}

/** 应答一个可应答的 server-request（approval/question requested 用），走 /api/respond。 */
export async function respond(client, rpcId, result) {
	return client.respond(rpcId, result);
}
