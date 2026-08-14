// 单元飞轮：mux SSE 传输层 —— 解析、分帧、坏帧容错。
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSseData, parseServerRequest, MuxStream } from "../lib/stream.js";

test("extractSseData：抽 data: 行并连接多行", () => {
	// 一个帧的 JSON 被拆成多行 data 字段（SSE 允许），拼接后是完整 JSON
	const chunk = 'event: msg\ndata: {"a":1,\ndata: "b":2}\n\n';
	assert.equal(extractSseData(chunk), '{"a":1,"b":2}');
});

test("extractSseData：注释/心跳行无 data → 空串", () => {
	assert.equal(extractSseData(": connected"), "");
	assert.equal(extractSseData(""), "");
});

test("parseServerRequest：合法信封解析出 payload", () => {
	const raw = JSON.stringify({ type: "server-request", rpcId: "r-1", method: "events.mux", payload: { type: "stream/error", error: { code: "internal", message: "x" } } });
	const message = parseServerRequest(raw);
	assert.equal(message.rpcId, "r-1");
	assert.equal(message.payload.type, "stream/error");
});

test("parseServerRequest：坏 JSON / 非 server-request → null（坏帧跳过不杀流）", () => {
	assert.equal(parseServerRequest("{not json"), null);
	assert.equal(parseServerRequest(JSON.stringify({ type: "server-response", rpcId: "r", result: {} })), null);
	assert.equal(parseServerRequest(JSON.stringify({ type: "server-request", rpcId: "r" })), null); // 无 payload
});

function fakeWebSocket(messages, { errorMessage = null } = {}) {
	// 与内建 WebSocket 同构的最小事件实现：支持 addEventListener(node 的 on-别名也可)。
	return class FakeWS {
		constructor(url) {
			this.url = url;
			this._listeners = {};
			this._mq = []; // 待派发的消息
			this.closed = false;
			// 微任务：先让 frames() 挂上监听，再派发 open + messages + close
			queueMicrotask(() => {
				this._emit("open");
				for (const data of messages) this._emit("message", { data });
				if (errorMessage) this._emit("error", { message: errorMessage });
				this._emit("close");
				this.closed = true;
			});
		}
		addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
		removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); }
		_emit(type, data) { for (const fn of this._listeners[type] || []) fn(data ?? {}); }
		close() { this.closed = true; }
	};
}

const frameWithRpc = (rpcId, payload) => JSON.stringify({ type: "server-request", rpcId, method: "events.mux", payload });

test("MuxStream.frames：WebSocket 逐消息 yield 信封（含 rpcId），跳过坏帧", async () => {
	const payload1 = { type: "session/subscribed", sessionId: "s1", lastSeq: 3 };
	const payload2 = { type: "stream/error", error: { code: "internal", message: "boom" } };
	const FakeWS = fakeWebSocket([frameWithRpc("r1", payload1), "garbage-not-json", frameWithRpc("r2", payload2)]);
	const stream = new MuxStream("http://127.0.0.1:3080", { WebSocketImpl: FakeWS });
	const frames = [];
	let opened = false;
	for await (const f of stream.frames({ onOpen: () => { opened = true; } })) {
		frames.push(f);
	}
	assert.equal(opened, true, "连接建立应回调 onOpen");
	assert.equal(frames.length, 2, "坏帧跳过，仅 2 条有效");
	assert.equal(frames[0].rpcId, "r1");
	assert.equal(frames[0].payload.type, "session/subscribed");
	assert.deepEqual(frames[0].payload, payload1);
	assert.equal(frames[1].payload.type, "stream/error");
});

test("MuxStream.frames：WebSocket error → transport failure", async () => {
	const FakeWS = fakeWebSocket([], { errorMessage: "connection refused" });
	const stream = new MuxStream("http://127.0.0.1:3080", { WebSocketImpl: FakeWS });
	await assert.rejects(async () => {
		for await (const _ of stream.frames()) { /* noop */ }
	}, /transport failure for events\.mux: connection refused/);
});

test("MuxStream.frames：signal abort 干净终止（不抛错，供 close 后正常退出）", async () => {
	// 已 abort 的信号：应立刻干净结束，不抛错（close() 语义，非重连错误）。
	const FakeWS = fakeWebSocket([frameWithRpc("r1", { type: "x" })]);
	const stream = new MuxStream("http://127.0.0.1:3080", { WebSocketImpl: FakeWS });
	const ac = new AbortController();
	ac.abort();
	const frames = [];
	for await (const f of stream.frames({ signal: ac.signal })) frames.push(f);
	assert.deepEqual(frames, [], "已 abort 应立即结束且不 yield");
});
