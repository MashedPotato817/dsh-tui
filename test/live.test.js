// 单元飞轮：LiveConversation —— fake client + 可控帧流，验证基线/增量/流式草稿。
import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveConversation, initialState, mergeToolsByCallId } from "../lib/live.js";
import { foldEvents } from "../lib/fold.js";

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
		this.responds = [];
		this.cancelled = false;
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
		if (method === "subagent.list") {
			this.subagentListCalls = (this.subagentListCalls ?? 0) + 1;
			return { items: [{ sessionId: "session-child", running: true }] };
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

function setup(baselineEvents = [], ops = {}) {
	const client = new FakeClient(baselineEvents);
	const stream = new FakeStream();
	const snapshots = [];
	const conv = new LiveConversation({
		client,
		session: { sessionId: "s1", agentPreset: "code", cwd: "C:\\work", history: (p) => client.request("session.history", p), prompt: (t) => client.request("session.prompt", { content: [{ type: "text", text: t }] }) },
		stream,
		approvalMode: ops?.approvalMode,
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
	conv.flushStreaming(); // 流式批合并后需手动/定时 flush 才可见
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

test("流式合并：1000 个 delta 批处理发布次数≪chunk数，最终文本严格一致", async () => {
	const { conv, stream } = setup();
	await conv.open();
	let emitCount = 0;
	conv.onState = () => { emitCount += 1; };
	// 开头：block-start + turn/start 使 internal 有内容
	const seqBase = 1;
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("turn/start", { turn: 1 }, seqBase) });
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "block-start", index: 0, blockType: "text" } }, seqBase + 1) });
	// 一次性推入 1000 个单字符 delta（不 await，全进同一批）
	const expected = [];
	for (let i = 0; i < 1000; i++) {
		const ch = String(i % 10);
		expected.push(ch);
		stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "text-delta", index: 0, text: ch } }, seqBase + 2 + i) });
	}
	await tick(); // 让 consumer 消费这些帧（同步路径，emit 被合并）
	const emitsBeforeBroadcast = emitCount; // 应远小于 1001
	conv.flushStreaming(); // 发布最终 batch
	const text = conv.snapshot().streaming?.text ?? "";
	assert.equal(text, expected.join(""), "最终文本必须与所有 delta 严格拼接一致");
	assert.ok(emitsBeforeBroadcast < 50, `合并后 emit 次数应远小于 chunk 数，实际 ${emitsBeforeBroadcast}`);
});

test("流式：含换行的正文立即 flush，不等 50ms 批", async () => {
	const { conv, stream } = setup();
	await conv.open();
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("turn/start", { turn: 1 }, 1) });
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "block-start", index: 0, blockType: "text" } }, 2) });
	// 双换行 = 段落边界 → hasFlushSignal 触发立即 flush
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "text-delta", index: 0, text: "第一段\n\n第二段" } }, 3) });
	await tick();
	assert.equal(conv.snapshot().streaming?.text, "第一段\n\n第二段", "换行应立即可见");
});

test("流式：usage 不触发正文重绘（不发正文批）", async () => {
	const { conv, stream } = setup();
	await conv.open();
	let emitForBody = 0;
	conv.onState = () => { emitForBody += 1; };
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } } }, 1) });
	await tick();
	const before = emitForBody;
	conv.flushStreaming();
	assert.equal(before, 0, "usage 单独到达不应触发正文 emit");
});

test("流式：超过 streamingMaxChars 立即 flush，不积压成超大单批", async () => {
	const { conv, stream } = setup();
	await conv.open();
	conv.streamingMaxChars = 20; // 设小，方便测
	conv.streamingPublishMs = 100000; // 拉长定时器，确保是「max 触发」而非「定时触发」
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("turn/start", { turn: 1 }, 1) });
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "block-start", index: 0, blockType: "text" } }, 2) });
	const text = "a".repeat(25); // 25 > cap 20
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "text-delta", index: 0, text } }, 3) });
	await tick();
	assert.equal(conv.snapshot().streaming?.text, text, "超 max 应立刻发布，不等定时器");
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

test("approval/requested（auto 模式）：自动拒绝并 respond，resolved 后清空", async () => {
	const { conv, stream } = setup([], { approvalMode: "auto" });
	await conv.open();
	const pushOne = async (frame) => {
		stream.push(frame);
		await tick();
	};
	await pushOne({ type: "approval/requested", sessionId: "s1", approvalId: "ap-1", toolName: "write", rpcId: "rpc-approval" });
	await pushOne({ type: "approval/resolved", sessionId: "s1", approvalId: "ap-1", outcome: "allowed-once" });
	await tick();

	assert.equal(conv.snapshot().pendingApprovals.length, 0, "resolved 后清空");
});

test("approval/requested（默认 interactive）：挂起不等 UI，不自动应答；answerApproval 后 respond", async () => {
	const { conv, stream } = setup();
	await conv.open();
	stream.push({ type: "approval/requested", sessionId: "s1", approvalId: "ap-1", toolName: "write", rpcId: "rpc-approval" });
	await tick();

	// 挂起：pendingApprovals 有项，但未响应（FakeClient.responds 空）
	assert.equal(conv.snapshot().pendingApprovals.length, 1, "应挂起进入 pending");
	assert.equal(conv.client.responds.length, 0, "未自动应答");

	// 用户选择「本会话允许」→ respond + 记入 sessionAllowedTools
	const pending = conv.snapshot().pendingApprovals[0];
	await conv.answerApproval(pending, "allowed-session");
	assert.equal(conv.client.responds.length, 1, "应 respond 一次");
	assert.ok(conv.sessionAllowedTools.has("write"), "本会话允许应被记住");

	// 再次同一工具→自动放行
	stream.push({ type: "approval/requested", sessionId: "s1", approvalId: "ap-2", toolName: "write", rpcId: "rpc-approval2" });
	await tick();
	assert.equal(conv.snapshot().pendingApprovals.length, 0, "本会话允许的工具自动放行不挂起");
	assert.equal(conv.client.responds.length, 2, "自动放行也 respond");

	// 拒绝 → respond outcome=rejected
	stream.push({ type: "approval/requested", sessionId: "s1", approvalId: "ap-3", toolName: "bash", rpcId: "rpc-approval3" });
	await tick();
	const bashPending = conv.snapshot().pendingApprovals[0];
	await conv.answerApproval(bashPending, "rejected");
	assert.equal(conv.client.responds[2].result.value.outcome, "rejected");
});

test("approval/requested：acceptEdits 档自动放行编辑工具不挂起", async () => {
	const { conv, stream } = setup();
	await conv.open();
	conv.permissionOptions.editableTools = ["write", "edit"];
	conv.setPermissionMode("acceptEdits");
	stream.push({ type: "approval/requested", sessionId: "s1", approvalId: "ap-e", toolName: "write", rpcId: "rpc-ap-e" });
	await tick();
	assert.equal(conv.snapshot().pendingApprovals.length, 0, "编辑工具在 acceptEdits 档自动放行");
	assert.equal(conv.client.responds.length, 1, "自动 respond");
	// 非编辑工具仍挂起
	stream.push({ type: "approval/requested", sessionId: "s1", approvalId: "ap-b", toolName: "bash", rpcId: "rpc-ap-b" });
	await tick();
	assert.equal(conv.snapshot().pendingApprovals.length, 1, "非编辑工具在 acceptEdits 档挂起待交互");
});

test("approval/requested 自动放行 respond 失败时保留 pending（Codex 评审 #6，不吞错）", async () => {
	const { conv, stream } = setup();
	await conv.open();
	// 让 respond 失败（模拟网络/host 瞬断）
	conv.client.respond = async () => { throw new Error("network down"); };
	conv.permissionOptions.editableTools = ["write"];
	conv.setPermissionMode("acceptEdits");
	stream.push({ type: "approval/requested", sessionId: "s1", approvalId: "ap-f", toolName: "write", rpcId: "rpc-ap-f" });
	await tick();
	await tick(); // 等 #autoAllow 的 await respond 落定
	const st = conv.snapshot();
	assert.equal(st.pendingApprovals.length, 1, "respond 失败后 pending 应保留，不静默删除");
	assert.equal(st.notice, "自动审批应答失败：network down（保留待你处理 y/n）", "应提示失败且可重试");
});

test("question/requested：auto 自动应答，interactive 挂起等待显式 answerQuestion", async () => {
	// auto 模式
	const { conv, stream } = setup([], { approvalMode: "auto" });
	await conv.open();
	stream.push({ type: "question/requested", sessionId: "s1", questions: [{ id: "q1", question: "继续？", options: [{ label: "是" }, { label: "否" }] }] });
	await tick();
	assert.equal(conv.client.responds.length, 1, "auto 模式应自动应答一次");

	// interactive 模式必须留给 TUI 模态面板，禁止静默替用户选第一项。
	const { conv: conv2, stream: stream2 } = setup();
	await conv2.open();
	stream2.push({ type: "question/requested", sessionId: "s1", questions: [{ id: "q2", question: "方案？", options: [{ label: "A" }, { label: "B" }] }] });
	await tick();
	assert.equal(conv2.client.responds.length, 0, "interactive 模式不应自动代答");
	assert.equal(conv2.snapshot().pendingQuestions.length, 1, "问题应保持挂起供 UI 选择");

	// 保留待未来交互式 UI 的 answerQuestion 路径仍可 respond（不回归 API 契约）
	const { conv: conv3, stream: stream3 } = setup();
	await conv3.open();
	stream3.push({ type: "question/requested", sessionId: "s1", questions: [{ id: "q3", question: "再确认？", options: [{ label: "X" }, { label: "Y" }] }] });
	await tick();
	const pendingQ = conv3.snapshot().pendingQuestions[0];
	await conv3.answerQuestion(pendingQ, [{ id: "q3", selected: ["X"] }]);
	assert.equal(conv3.client.responds.length, 1, "answerQuestion 显式 respond 一次");
	assert.deepEqual(conv3.client.responds[0].result.value.answer.answers, [{ id: "q3", selected: ["X"] }]);
});

test("启动竞态：慢 baseline 不得覆盖用户刚发送的乐观消息", async () => {
	const { conv } = setup();
	let releaseHistory;
	conv.session.history = () => new Promise((resolve) => { releaseHistory = () => resolve({ events: [] }); });
	const opening = conv.open();
	await tick();
	await conv.send("启动后立即发送");
	assert.equal(conv.snapshot().messages[0].text, "启动后立即发送");
	releaseHistory();
	await opening;
	assert.equal(conv.snapshot().messages[0].text, "启动后立即发送");
	assert.equal(conv.snapshot().messages[0].pending, true);
	conv.close();
});

test("session/subscribed 游标只触发 history 对账，不跳过缺失消息", async () => {
	const { conv, stream, client } = setup();
	await conv.open();
	client.baselineEvents = [mkEvent("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "订阅间隙消息" }] }, 5)];
	stream.push({ type: "session/subscribed", sessionId: "s1", lastSeq: 5 });
	await tick();
	await tick();
	assert.equal(conv.snapshot().messages.some((message) => message.text === "订阅间隙消息"), true);
	conv.close();
});

test("cancelTurn：调用 session.cancel", async () => {
	const { conv } = setup();
	await conv.open();
	await conv.cancelTurn();
	assert.equal(conv.client.cancelled, true);
	assert.match(conv.snapshot().notice, /停止/);
});

test("history 兜底：mux 断帧时轮询 history 也能落定 pending + 显示回复", async () => {
	// history 第一次(baseline)返回空，之后返回 user+assistant —— 模拟 mux 事件没来，靠 history 兜底
	const host = new FakeClient();
	let historyCalls = 0;
	const historyEvents = [
		mkEvent("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "问" }] }, 10),
		mkEvent("assistant/message", { turn: 1, step: 0, message: { id: "m", role: "assistant", content: [{ type: "text", text: "答" }], source: { kind: "model" } } }, 11),
		mkEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, 12)
	];
	host.request = async (method, payload) => {
		if (method === "session.history") {
			historyCalls += 1;
			if (historyCalls === 1) return { events: [], hasMore: false }; // baseline 空
			return { events: historyEvents.map((e) => ({ event: e })), hasMore: false };
		}
		if (method === "session.prompt") return { accepted: true };
		throw new Error(`unexpected ${method}`);
	};
	const conv = new LiveConversation({
		client: host,
		session: { sessionId: "s2", history: (p) => host.request("session.history", p), prompt: () => host.request("session.prompt") },
		stream: new FakeStream()
	});
	await conv.open();
	// send 后再启动 history 兜底：此时 history 含 user+assistant，sync 应拉回并落定 pending
	await conv.send("问");
	conv.startHistorySync(30);
	await new Promise((r) => setTimeout(r, 90));
	conv.close();
	const st = conv.snapshot();
	assert.ok(st.messages.some((m) => m.role === "assistant" && m.text === "答"), "history 兜底应拉到 assistant 回复");
	assert.ok(!st.messages.some((m) => m.pending), "pending 应被真实 user 落定");
});

test("refreshSubagents：调 subagent.list，填充子代理列表", async () => {
	const { conv } = setup();
	await conv.open();
	await conv.refreshSubagents();
	assert.equal(conv.client.subagentListCalls, 1);
	assert.equal(conv.snapshot().subagents.length, 1);
	assert.equal(conv.snapshot().subagents[0].sessionId, "session-child");
});

test("resolveStuckPending：超时未落定的 pending 被标 stuck，正常 pending 不受影响", async () => {
	const { conv } = setup();
	await conv.open();
	conv.state.messages = [
		// 很久以前发出的（超时）
		{ role: "user", seq: -1, time: Date.now() - 120_000, sentAt: Date.now() - 120_000, text: "老消息", pending: true },
		// 刚发出的（未超时）
		{ role: "user", seq: -1, time: Date.now(), sentAt: Date.now(), text: "新消息", pending: true }
	];
	conv.resolveStuckPending(60_000);
	const st = conv.snapshot();
	const old = st.messages.find((m) => m.text === "老消息");
	const fresh = st.messages.find((m) => m.text === "新消息");
	assert.equal(old.stuck, true, "超时的 pending 应标 stuck");
	assert.ok(fresh.stuck === undefined, "未超时的 pending 不应标 stuck");
});

// ---- Codex 评审 #5：history 兜底应能落定 running=false ----
test("refreshHistory：mux 漏掉 turn/end 时，history 兜底把 running 落定 false", async () => {
	// 基线：一轮 turn/start 但【无 turn/end】（模拟 host 还在跑 / mux 断了）
	const baseline = [
		mkEvent("turn/start", { turn: 1 }, 0),
		mkEvent("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "问题" }] }, 1),
		mkEvent("assistant/message", { turn: 1, step: 0, message: { id: "m1", role: "assistant", content: [{ type: "text", text: "回答" }], source: { kind: "model" } }, usage: {} }, 2)
	];
	const { client, conv, snapshots } = setup(baseline);
	await conv.open();
	// 模拟 mux 已把本回合置为 running（turn/start 已到，但 turn/end 没来）
	conv.state.running = true;
	conv.emit();

	// host 实际已完成该回合（history 补上了 turn/end）
	client.baselineEvents = baseline.concat([mkEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, 3)]);
	const changed = await conv.refreshHistory();
	assert.equal(changed, true);
	assert.equal(conv.snapshot().running, false, "history 看到 turn/end 后 running 应落定 false");
	assert.equal(conv.snapshot().lastTurnEnd.reason.kind, "completed");
	// P1 #5：history 路径也应落定 turnEndedAt，否则 workedLabel 退回 now 一直走秒。
	assert.equal(typeof conv.snapshot().turnEndedAt, "number", "history 观察到 turn/end 应设置 turnEndedAt");
});

test("refreshHistory：无新事件时返回 false 且不改 running", async () => {
	const baseline = [mkEvent("turn/start", { turn: 1 }, 0)];
	const { conv } = setup(baseline);
	await conv.open();
	conv.state.running = true;
	const changed = await conv.refreshHistory();
	// 无 turn/end、无消息、无工具 → 不应误判，running 保持 true（turn 仍在进行）
	assert.equal(changed, false);
	assert.equal(conv.snapshot().running, true);
});
// ---- Codex 评审 #4：工具状态按 callId 合并，避免重复卡/永久 running ----
test("mergeToolsByCallId：tool/result（缺 name）就地更新已有 running 卡，保留 name/args", () => {
	const existing = [{ seq: 1, callId: "c1", name: "run_code", args: "x", status: "running" }];
	const result = [{ seq: 3, callId: "c1", name: undefined, args: "", status: "done", finishedAt: 1000 }];
	const merged = mergeToolsByCallId(existing, result);
	assert.equal(merged.length, 1, "不应新增重复卡");
	assert.equal(merged[0].status, "done");
	assert.equal(merged[0].name, "run_code", "保留原 name");
	assert.equal(merged[0].finishedAt, 1000);
});

test("mergeToolsByCallId：无 callId 的新工具追加；含 callId 的追加", () => {
	const out = mergeToolsByCallId([{ callId: "c1", name: "a", status: "running" }], [{ callId: "c2", name: "b", status: "running" }]);
	assert.equal(out.length, 2);
	assert.equal(mergeToolsByCallId([], [{ callId: "x", status: "running" }]).length, 1);
});

test("foldEvents：单独 tool/result 产出「状态更新」工具项，供 live 层按 callId 合并", () => {
	const view = foldEvents([
		{ event: { type: "tool/result", seq: 3, time: 1000, data: { turn: 1, step: 0, message: { id: "m", role: "user", content: [{ type: "tool-result", toolCallId: "c1", content: [] }], source: { kind: "tool" } } } } }
	]);
	assert.equal(view.tools.length, 1);
	assert.equal(view.tools[0].callId, "c1");
	assert.equal(view.tools[0].status, "done", "单独 result 也应标 done（供 live 合并用）");
	assert.equal(view.tools[0].finishedAt, 1000);
});

test("相位计时：reasoning→text→tool 分相累加，turn/end 写 phaseTiming 摘要", async () => {
	const { conv, stream } = setup();
	await conv.open();
	// turn/start + 各相位 delta + turn/end（带时间推进）
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("turn/start", { turn: 1 }, 1) });
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "reasoning-delta", index: 0, text: "想" } }, 2) });
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "text-delta", index: 0, text: "答" } }, 3) });
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("assistant/chunk", { turn: 1, step: 0, chunk: { type: "tool-call-delta", index: 1, id: "t1", name: "read", argumentsDelta: "{}" } }, 4) });
	await tick();
	stream.push({ type: "session/event", sessionId: "s1", event: mkEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, 5) });
	await tick();
	const st = conv.snapshot();
	// phaseTiming 已生成（Thinking/Response/Tools 至少各出现一次 -> 摘要非空）
	assert.ok(st.phaseTiming, `应生成分相计时摘要，实际 ${st.phaseTiming}`);
	assert.match(st.phaseTiming, /Thinking|Response|Tools/);
});
