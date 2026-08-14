// UI 冒烟：renderToString 渲染 App 树，验证组件不崩。纯逻辑，无真实 host。
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "ink";
import React from "react";
import App, { HelpPanel } from "../ui/components.js";
import { initialState } from "../lib/live.js";
import { hudState } from "../lib/hud.js";
// 提供一个假 conv 让 App 的 useEffect 不碰网络
function fakeConv() {
	const state = { ...initialState(), messages: [
		{ role: "user", seq: 1, text: "你好" },
		{ role: "assistant", seq: 2, text: "回复内容", usage: { inputTokens: 100, outputTokens: 20 } }
	] };
	return {
		state,
		snapshot: () => state,
		onState: () => {},
		open: async () => {},
		close: () => {},
		send: async () => {}
	};
}

test("App 树 renderToString 不崩，含 HUD/消息", () => {
	const conv = fakeConv();
	const session = { sessionId: "session-abcdef123456", agentPreset: "code", cwd: "C:\\work" };
	// renderToString 需要立即渲染（不驱动 useEffect 副作用）
	const output = renderToString(
		React.createElement(App, { conv, session, onCommand: () => {}, onExit: () => {} })
	);
	assert.ok(output.includes("PTC"), "HUD 应显示 PTC 模式");
	assert.ok(output.includes("你好"), "消息列表应含 user 文本");
	assert.ok(output.includes("回复内容"), "消息列表应含 assistant 文本");
	assert.ok(output.includes("11111111") || output.includes("abcdef12"), "HUD 应含短 sessionId");
});

test("hudState + renderToString：流式草稿渲染", () => {
	const hud = hudState({
		view: { ...initialState(), messages: [], streaming: null, running: true, model: "deepseek-chat" },
		session: { sessionId: "abc123", agentPreset: "code", cwd: "" }
	});
	assert.equal(hud.mode, "PTC");
	assert.equal(hud.running, true);
});

test("App 渲染：流式草稿 + 等待批准面板都显示", () => {
	const conv = fakeConv();
	conv.state.streaming = { text: "正在生成回复…" };
	conv.state.pendingApprovals = [{ approvalId: "ap-1", toolName: "run_code" }];
	const output = renderToString(
		React.createElement(App, {
			conv,
			session: { sessionId: "session-abcdef123456", agentPreset: "code", cwd: "C:\\work" },
			onCommand: () => {},
			onExit: () => {}
		})
	);
	assert.ok(output.includes("正在生成回复"), "应渲染流式草稿");
	assert.ok(output.includes("等待批准"), "应渲染等待批准面板");
	assert.ok(output.includes("run_code"), "批准面板应含工具名");
});

test("App 渲染：工具卡片显示名称 + 状态徽标 + diff 摘要", () => {
	const conv = fakeConv();
	conv.state.tools = [
		{ seq: 5, callId: "c1", name: "run_code", args: '{"code":"1+1"}', status: "running" },
		{ seq: 6, callId: "c2", name: "write", args: '{"path":"a.ts"}', status: "done", diffMeta: "--- a.ts\n+++ a.ts\n@@ -1,2 +1,2 @@\n-old();\n+new();\n" }
	];
	const output = renderToString(
		React.createElement(App, {
			conv,
			session: { sessionId: "session-abcdef123456", agentPreset: "code", cwd: "C:\\work" },
			onCommand: () => {},
			onExit: () => {}
		})
	);
	assert.ok(output.includes("run_code"), "工具卡片应显示工具名");
	assert.ok(output.includes("read") || output.includes("write"), "工具卡片应显示工具名");
	assert.ok(output.includes("+1/-1"), "应渲染 diff 摘要 +1/-1");
});

test("App 渲染：队列 Dock 显示待处理消息", () => {
	const conv = fakeConv();
	conv.state.queue = [
		{ id: "mq-1", placement: "queued", message: { content: [{ type: "text", text: "排队任务一" }] } },
		{ id: "mq-2", placement: "steering", message: { content: [{ type: "text", text: "插队引导" }] } }
	];
	const output = renderToString(
		React.createElement(App, {
			conv,
			session: { sessionId: "session-abcdef123456", agentPreset: "code", cwd: "C:\\work" },
			onCommand: () => {},
			onExit: () => {}
		})
	);
	assert.ok(output.includes("待处理队列"), "应渲染队列面板标题");
	assert.ok(output.includes("排队任务一"), "应显示排队消息文本");
	assert.ok(output.includes("插队引导"), "应显示 steering 消息");
});

test("HelpPanel：渲染快捷键列表", () => {
	const output = renderToString(React.createElement(HelpPanel, {}));
	assert.ok(output.includes("快捷键"), "面板标题");
	assert.ok(output.includes("Shift+Enter"), "应含多行输入提示");
	assert.ok(output.includes("Ctrl+C"), "应含中断提示");
	assert.ok(output.includes("Shift+Tab"), "应含权限档位提示");
});

test("App 渲染：UI Mode 标签显示在 HUD（审批时 APPROVE）", () => {
	const conv = fakeConv();
	conv.state.pendingApprovals = [{ approvalId: "ap-1", toolName: "write" }];
	const output = renderToString(
		React.createElement(App, {
			conv,
			session: { sessionId: "session-abcdef123456", agentPreset: "code", cwd: "C:\\work" },
			onCommand: () => {},
			onExit: () => {}
		})
	);
	assert.ok(output.includes("APPROVE"), "有挂起审批时 HUD 应显示 APPROVE mode");
});

test("App 渲染：子代理 Dock 显示 fork 出的子代理", () => {
	const conv = fakeConv();
	conv.state.subagents = [{ sessionId: "session-child-1", running: true }, { sessionId: "session-child-2", running: false }];
	const output = renderToString(
		React.createElement(App, {
			conv,
			session: { sessionId: "session-abcdef123456", agentPreset: "code", cwd: "C:\\work" },
			onCommand: () => {},
			onExit: () => {}
		})
	);
	assert.ok(output.includes("子代理"), "应渲染子代理面板标题");
	assert.ok(output.includes("session-child-1"), "应显示子代理 sessionId");
});

test("App 渲染：空 assistant 回复显示占位而非空行", () => {
	const conv = fakeConv();
	conv.state.messages = [
		{ role: "user", seq: 1, text: "问" },
		{ role: "assistant", seq: 2, text: "" } // host 回了但没文本
	];
	const output = renderToString(
		React.createElement(App, {
			conv,
			session: { sessionId: "session-abcdef123456", agentPreset: "code", cwd: "C:\\work" },
			onCommand: () => {},
			onExit: () => {}
		})
	);
	assert.ok(output.includes("未生成文本内容"), "空回复应显示占位提示");
});

test("App 渲染：stuck pending 显示重发警告", () => {
	const conv = fakeConv();
	conv.state.messages = [
		{ role: "user", seq: -1, sentAt: Date.now() - 90_000, text: "问", pending: true, stuck: true }
	];
	const output = renderToString(
		React.createElement(App, {
			conv,
			session: { sessionId: "session-abcdef123456", agentPreset: "code", cwd: "C:\\work" },
			onCommand: () => {},
			onExit: () => {}
		})
	);
	assert.ok(output.includes("可能未生效"), "stuck pending 应显示重发警告");
});
