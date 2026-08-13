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

function fakeFetch(chunks, status = 200) {
	return async () => ({
		ok: status >= 200 && status < 300,
		status,
		body: new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
				controller.close();
			}
		})
	});
}

const frame = (payload) => JSON.stringify({ type: "server-request", rpcId: "r", method: "events.mux", payload });

test("MuxStream.frames：跳过注释行，逐帧 yield payload，跨 chunk 边界分帧", async () => {
	const payload1 = { type: "session/subscribed", sessionId: "s1", lastSeq: 3 };
	const payload2 = { type: "stream/error", error: { code: "internal", message: "boom" } };
	const f1 = frame(payload1);
	// 第一帧拆成两段到达（在帧中间断开），第二帧紧跟其后
	const chunks = [
		`: connected\n\ndata: ${f1.slice(0, 30)}`,
		`${f1.slice(30)}\n\ndata: ${frame(payload2)}\n\n`
	];
	const stream = new MuxStream("http://127.0.0.1:3080", { fetchImpl: fakeFetch(chunks) });
	const frames = [];
	let opened = false;
	for await (const f of stream.frames({ onOpen: () => { opened = true; } })) {
		frames.push(f);
	}
	assert.equal(opened, true);
	assert.deepEqual(frames, [payload1, payload2]);
});

test("MuxStream.frames：HTTP 错误 → transport failure", async () => {
	const stream = new MuxStream("http://127.0.0.1:3080", { fetchImpl: fakeFetch([], 404) });
	await assert.rejects(async () => {
		for await (const _ of stream.frames()) { /* noop */ }
	}, /transport failure for events\.mux: HTTP 404/);
});

test("MuxStream.frames：坏帧跳过，后续帧照常", async () => {
	const good = { type: "session/subscribed", sessionId: "s1", lastSeq: 1 };
	const chunks = [`data: garbage\n\ndata: ${frame(good)}\n\n`];
	const stream = new MuxStream("http://127.0.0.1:3080", { fetchImpl: fakeFetch(chunks) });
	const frames = [];
	for await (const f of stream.frames()) frames.push(f);
	assert.deepEqual(frames, [good]);
});
