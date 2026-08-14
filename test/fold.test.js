// 单元飞轮：fold 纯函数 —— 确定性、无 IO，跑得最快。
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldEvents, lastAssistantText } from "../lib/fold.js";

let seq = 0;
const event = (type, data, extra = {}) => ({
	type,
	seq: ++seq,
	time: 1_700_000_000_000 + seq,
	data,
	...extra
});

test("空页折叠为空视图", () => {
	const view = foldEvents([]);
	assert.deepEqual(view, {
		messages: [],
		tools: [],
		turn: 0,
		lastTurnEnd: null,
		turnStartTime: null,
		turnEndedAt: null,
		lastSeq: -1,
		model: null,
		contextWindow: null
	});
});

test("turn/start 记录 turnStartTime；tool 记录 startedAt / finishedAt", () => {
	const turnStart = event("turn/start", { turn: 1 });
	const callEv = event("tool/call", { turn: 1, step: 0, callId: "call-t", name: "run_code", arguments: "{}" });
	const resultEv = event("tool/result", {
		turn: 1, step: 0,
		message: { id: "m", role: "user", content: [{ type: "tool-result", toolCallId: "call-t", content: [] }], source: { kind: "tool" } }
	});
	const view = foldEvents([{ event: turnStart }, { event: callEv }, { event: resultEv }]);
	assert.equal(view.turnStartTime, turnStart.time, "turnStartTime 来自 turn/start 的 time");
	assert.equal(view.tools[0].startedAt, callEv.time);
	assert.equal(view.tools[0].finishedAt, resultEv.time);
	assert.equal(view.tools[0].status, "done");
});

test("无 turn/start 时 turnStartTime 为 null", () => {
	const view = foldEvents([
		{ event: event("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "hi" }] }) }
	]);
	assert.equal(view.turnStartTime, null);
});

test("turn/end 记录稳定结束时间", () => {
	const end = event("turn/end", { turn: 1, reason: { kind: "completed" } });
	const view = foldEvents([end]);
	assert.equal(view.turnEndedAt, end.time);
	assert.equal(view.lastTurnEnd.time, end.time);
});

test("user + assistant 消息折叠为两条对话消息，text 块按行连接", () => {
	const entries = [
		{ event: event("turn/start", { turn: 1 }) },
		{
			event: event("user/message", {
				source: { kind: "user" },
				content: [
					{ type: "text", text: "第一行" },
					{ type: "text", text: "第二行" }
				]
			})
		},
		{
			event: event("assistant/message", {
				turn: 1,
				step: 0,
				message: {
					id: "m1",
					role: "assistant",
					content: [{ type: "text", text: "回复" }],
					source: { kind: "model" }
				},
				usage: { inputTokens: 10, outputTokens: 2 }
			})
		},
		{ event: event("turn/end", { turn: 1, reason: { kind: "completed" } }) }
	];
	const view = foldEvents(entries);

	assert.equal(view.turn, 1);
	assert.equal(view.lastTurnEnd.reason.kind, "completed");
	assert.equal(view.lastSeq, entries[3].event.seq);
	assert.equal(view.messages.length, 2);
	assert.deepEqual(view.messages[0], {
		role: "user",
		seq: entries[1].event.seq,
		time: entries[1].event.time,
		text: "第一行\n第二行"
	});
	assert.deepEqual(view.messages[1], {
		role: "assistant",
		seq: entries[2].event.seq,
		time: entries[2].event.time,
		text: "回复",
		usage: { inputTokens: 10, outputTokens: 2 }
	});
	assert.equal(lastAssistantText(view), "回复");
});

test("reasoning 块不进入可见文本", () => {
	const view = foldEvents([
		{
			event: event("assistant/message", {
				turn: 1,
				step: 0,
				message: {
					id: "m1",
					role: "assistant",
					content: [
						{ type: "reasoning", text: "思考过程" },
						{ type: "text", text: "可见回复" }
					],
					source: { kind: "model" }
				}
			})
		}
	]);
	assert.equal(view.messages[0].text, "可见回复");
});

test("tool/call 计入 tools，不产生对话消息", () => {
	const callEvent = event("tool/call", {
		turn: 1,
		step: 0,
		callId: "call-1",
		name: "run_code",
		arguments: "{}"
	});
	const view = foldEvents([
		{ event: callEvent },
		{
			event: event("tool/result", {
				turn: 1,
				step: 0,
				message: {
					id: "m2",
					role: "user",
					content: [{ type: "tool-result", toolCallId: "call-1", content: [] }],
					source: { kind: "tool" }
				}
			})
		}
	]);
	assert.equal(view.messages.length, 0);
	assert.equal(view.tools.length, 1);
	assert.equal(view.tools[0].callId, "call-1");
	assert.equal(view.tools[0].name, "run_code");
	assert.equal(view.tools[0].status, "done", "tool/result 后状态应为 done");
	assert.ok("args" in view.tools[0], "应保留参数摘要");
});

test("tool/call 未收到 result 时 status 保持 running", () => {
	const callEvent = event("tool/call", { turn: 1, step: 0, callId: "c-2", name: "read", arguments: '{"path":"a.txt"}' });
	const view = foldEvents([{ event: callEvent }]);
	assert.equal(view.tools[0].status, "running");
	assert.equal(view.tools[0].args, '{"path":"a.txt"}');
});

test("未知事件（merge-extensible 词汇增长）安全跳过", () => {
	const view = foldEvents([
		event("something/future", { some: "payload" }),
		event("todo/write", { todos: [] }),
		{ event: event("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "hi" }] }) }
	]);
	assert.equal(view.messages.length, 1);
	assert.equal(view.messages[0].text, "hi");
});

test("accepts bare events（不带 HistoryEntry 包装）", () => {
	const view = foldEvents([event("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "裸事件" }] })]);
	assert.equal(view.messages[0].text, "裸事件");
});

test("turn/end error 被记录进 lastTurnEnd", () => {
	const view = foldEvents([
		event("turn/end", { turn: 1, reason: { kind: "error", error: { message: "boom", code: "X" } } })
	]);
	assert.equal(view.lastTurnEnd.reason.kind, "error");
});

test("user/message 按 source.kind 区分人工输入与注入上下文", () => {
	const human = foldEvents([
		{ event: event("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "人工输入" }] }) }
	]);
	assert.equal(human.messages[0].injected, undefined, "人工输入不标记 injected");

	const noSource = foldEvents([
		{ event: event("user/message", { content: [{ type: "text", text: "无 source" }] }) }
	]);
	assert.equal(noSource.messages[0].injected, undefined, "无 source 当作普通用户消息");

	const plugin = foldEvents([
		{ event: event("user/message", { source: { kind: "plugin", plugin: "x" }, content: [{ type: "text", text: "运行时上下文" }] }) }
	]);
	assert.equal(plugin.messages[0].injected, true, "plugin 上下文标记 injected");

	const agentPrefix = foldEvents([
		{ event: event("user/message", { source: { kind: "agent-instructions" }, content: [{ type: "text", text: "工作区指令" }] }) }
	]);
	assert.equal(agentPrefix.messages[0].injected, true, "agent-instructions 标记 injected");
});
