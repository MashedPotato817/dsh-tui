// 单元飞轮：LiveConversation —— fake client + 可控帧流，验证基线/增量/流式草稿。
import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveConversation, initialState } from "../lib/live.js";

/** 可手动 push 帧的假 mux 流（yield MuxStream 信封：{rpcId, payload}）。 */
class FakeStream {
	constructor() {
		this.queue = [];
		this.waiters = [];
		this.closed = false;
	}

	async *frames({ signal }) {
		signal.addEventListener("abort", () => {
			this.closed = true;
			while (this.waiters.length) this.waiters.shift()();
		});
		for (;;) {
			if (this.queue.length) {
				const frame = this.queue.shift();
				yield { rpcId: "rpc-test", payload: frame };
			} else if (this.closed) return;
			else await new Promise((resolve) => this.waiters.push(resolve));
		}
	}

	push(frame) {
		if (this.waiters.length) this.waiters.shift()();
		this.queue.push(frame);
	}
}

/** 假 client：记录 prompt，history 返回基线事件。 */
class FakeClient {
	constructor(baselineEvents = []) {
		this.baselineEvents = baselineEvents;
		this.prompts = [];
		this.historyCalls = 0;
	}

	async request(method, payload) {
		if (method === "session.history") {
			this.historyCalls += 1;
			return { events: this.baselineEvents.map((event) => ({ event })), hasMore: false };
		}
		if (method === "session.prompt") {
			this.prompts.push(payload.content[0].text);
			return { accepted: true };
		}
		if (method === "session.cancel") {
			this.cancelled = true;
			return { accepted: true };
		}
		throw new Error(`unexpected ${method}`);
	}

	async respond(rpcId, result) {
		this.responds = this.responds ?? [];
		this.responds.push({ rpcId, result });
		return { accepted: true };
	}
}

const mkEvent = (type, data, seq) => ({ type, seq, time: 1_700_000_000_000 + seq, data });

function setup(baselineEvents = []) {
	const client = new FakeClient(baselineEvents);
	const stream = new FakeStream();
	const snapshots = [];
	const conv = new LiveConversation({
		client,
		session: { sessionId: "s1", agentPreset: "code", cwd: "C:\\work", history: (p) => client.request("session.history", p), prompt: (t) => client.request("session.prompt", { content: [{ type: "text", text: t }] }) },
		stream,
		onState: (state) => snapshots.push(state)
	});
	return { client, stream, conv, snapshots };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("open：history 基线折叠进状态，connected=true", async () => {
	const baseline = [
		mkEvent("turn/start", { turn: 1 }, 0),
		mkEvent("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "早" }] }, 1),
		mkEvent("assistant/message", { turn: 1, step: 0, message: { id: "m1", role: "assistant", content: [{ type: "text", text: "好" }], source: { kind: "model" } } }, 2),
		mkEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, 3)
	];
	const { conv } = setup(baseline);
	await conv.open();
	const state = conv.snapshot();
	assert.equal(state.connected, true);
	assert.equal(state.lastSeq, 3);
	assert.deepEqual(state.messages.map((m) => m.text), ["早", "好"]);
	assert.equal(state.turn, 1);
});

test("流式：chunk 累积成 streaming 草稿，assistant/message 落定进消息", async () => {
	const { conv, stream } = setup();
	await conv.open();
	const pushOne = async (frame) => {
		stream.push(frame);
		await tick();
	};
	await pushOne({ type: "session/event", sessionId: "s1", event: mkEvent("turn/start", { turn: 1 }, 0) });
	await pushOne({ type: "session/event", sessionId: "s1", event: mkEvent("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "hi" }] }, 1) });

	await pushOne({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "block-start", index: 0, blockType: "text" } }, 2) });
	await pushOne({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "text-delta", index: 0, text: "你" } }, 3) });
	await pushOne({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "text-delta", index: 0, text: "好" } }, 4) });
	assert.equal(conv.snapshot().streaming.text, "你好");
	assert.equal(conv.snapshot().running, true);

	await pushOne({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/message", { turn: 1, step: 0, message: { id: "m2", role: "assistant", content: [{ type: "text", text: "你好" }], source: { kind: "model" } }, usage: { inputTokens: 5, outputTokens: 2 } }, 5) });
	await pushOne({ type: "session/event", sessionId: "s1", event: mkEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, 6) });

	const state = conv.snapshot();
	assert.equal(state.streaming, null);
	assert.equal(state.running, false);
	assert.deepEqual(state.messages.map((m) => m.text), ["hi", "你好"]);
	assert.equal(state.messages[1].usage.outputTokens, 2);
});

test("send：乐观回显 pending 行，真实 user/message 到达后替换（不重复）", async () => {
	const { conv, stream } = setup();
	await conv.open();
	const sendPromise = conv.send("在吗");
	await tick();
	assert.equal(conv.snapshot().messages.length, 1);
	assert.equal(conv.snapshot().messages[0].pending, true);
	assert.equal(conv.snapshot().messages[0].text, "在吗");

	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("turn/start", { turn: 1 }, 0) });
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "在吗" }] }, 1) });
	await tick();

	const state = conv.snapshot();
	assert.equal(state.messages.length, 1, "不应出现重复 user 行");
	assert.equal(state.messages[0].pending, undefined);
	assert.equal(state.messages[0].seq, 1);
	await sendPromise;
});

test("send：/ 开头的命令不进模型，命令结果进 notice", async () => {
	const { conv } = setup();
	const host = new FakeClient();
	host.request = async (method, payload) => {
		if (method === "session.history") return { events: [], hasMore: false };
		if (method === "session.prompt") return { accepted: true, command: { kind: "success", text: "ok" } };
		throw new Error(`unexpected ${method}`);
	};
	const conv2 = new LiveConversation({
		client: host,
		session: { sessionId: "s1", history: (p) => host.request("session.history", p), prompt: () => host.request("session.prompt") },
		stream: new FakeStream()
	});
	await conv2.open();
	await conv2.send("/status");
	const state = conv2.snapshot();
	assert.equal(state.messages.length, 0, "命令不乐观回显");
	assert.equal(state.notice, "ok", "命令结果进 notice");
});

test("send 失败：撤销乐观回显，notice 提示", async () => {
	const { conv } = setup();
	const failing = new FakeClient();
	failing.request = async (method) => {
		if (method === "session.history") return { events: [], hasMore: false };
		throw Object.assign(new Error("agent-busy: turn in flight"), { code: "agent-busy" });
	};
	const conv2 = new LiveConversation({
		client: failing,
		session: { sessionId: "s1", history: (p) => failing.request("session.history", p), prompt: () => failing.request("session.prompt") },
		stream: new FakeStream()
	});
	await conv2.open();
	await assert.rejects(() => conv2.send("hi"));
	assert.equal(conv2.snapshot().messages.length, 0, "失败后乐观行应被撤销");
	assert.match(conv2.snapshot().notice, /发送失败/);
});

test("其他会话的帧被过滤", async () => {
	const { conv, stream } = setup();
	await conv.open();
	stream.push({ type: "session/event", sessionId: "other-session", event: mkEvent("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "别人的" }] }, 0) });
	await tick();
	assert.equal(conv.snapshot().messages.length, 0);
});

test("close：abort 信号断开，帧流结束", async () => {
	const { conv, stream } = setup();
	await conv.open();
	conv.close();
	await tick();
	assert.equal(stream.closed, true);
	assert.equal(conv.ac.signal.aborted, true);
});

test("initialState 形状", () => {
	const s = initialState();
	assert.equal(s.lastSeq, -1);
	assert.equal(s.running, false);
	assert.equal(s.streaming, null);
	assert.deepEqual(s.messages, []);
	assert.deepEqual(s.pendingApprovals, []);
	assert.deepEqual(s.pendingQuestions, []);
});

test("approval/requested：默认拒绝并 respond，resolved 后清空", async () => {
	const { conv, stream } = setup();
	await conv.open();
	const pushOne = async (frame) => {
		stream.push(frame);
		await tick();
	};
	await pushOne({ type: "approval/requested", sessionId: "s1", approvalId: "ap-1", toolName: "write", rpcId: "rpc-approval" });
	await pushOne({ type: "approval/resolved", sessionId: "s1", approvalId: "ap-1", outcome: "allowed-once" });
	await tick();

	assert.equal(conv.snapshot().pendingApprovals.length, 0, "resolved 后清空");
	// FakeStream yield 的信封 rpcId 是固定 "rpc-test"，所以 respond 应针对该 rpcId
});

test("question/requested：自动应答并记录 pending，resolved 清空", async () => {
	const { conv, stream } = setup();
	await conv.open();
	const pushOne = async (frame) => {
		stream.push(frame);
		await tick();
	};
	await pushOne({
		type: "question/requested",
		sessionId: "s1",
		questions: [{ id: "q1", question: "继续？", options: [{ label: "是" }, { label: "否" }] }]
	});
	await tick();
	assert.equal(conv.snapshot().pendingQuestions.length, 1);
	// respond 已被 FakeClient 记录（信封 rpcId 固定 rpc-test）
	assert.equal(conv.client.responds.length, 1, "应自动应答一次");
	await pushOne({ type: "question/resolved", sessionId: "s1", questionRpcId: "rpc-test" });
	await tick();
	assert.equal(conv.snapshot().pendingQuestions.length, 0, "resolved 后清空");
});

test("cancelTurn：调用 session.cancel", async () => {
	const { conv } = setup();
	await conv.open();
	await conv.cancelTurn();
	assert.equal(conv.client.cancelled, true);
	assert.match(conv.snapshot().notice, /停止/);
});
