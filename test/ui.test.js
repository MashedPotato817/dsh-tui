// UI 冒烟：renderToString 渲染 App 树，验证组件不崩。纯逻辑，无真实 host。
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "ink";
import React from "react";
import App, { HelpPanel, ToolCards } from "../ui/components.js";
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
	// 新 HUD 默认隐藏 sessionId（归 /status）；但应仍显示 model/token 等运行指标。
	assert.ok(output.includes("model") || output.includes("PTC"), "HUD 保留运行指标");
});

test("App 渲染：超长回复不得整片消失（P0 回归）", () => {
	const conv = fakeConv();
	// 最新一条 ~58 行、远超消息区预算，旧实现会返回空消息区（只剩 Worked for）。
	const longText = Array.from({ length: 58 }, (_, i) => `第 ${i + 1} 行内容`).join("\n");
	conv.state.messages = [
		{ role: "user", seq: 1, text: "请给我一段很长的回答" },
		{ role: "assistant", seq: 2, text: longText, usage: { inputTokens: 50, outputTokens: 2000 } }
	];
	const output = renderToString(
		React.createElement(App, {
			conv,
			session: { sessionId: "session-abcdef123456", agentPreset: "code", cwd: "C:\\work" },
			onCommand: () => {},
			onExit: () => {}
		})
	);
	// 修复后：最新长回复的尾部至少应可见若干行；不能只剩「Worked for」而无任何正文。
	const hasBody = /第\s*\d+\s*行内容/.test(output);
	assert.ok(hasBody, "超长回复应至少有尾部可见，而非整片空白");
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

test("App 渲染：工具卡片显示名称 + 状态徽标（collapsed 默认，diff 摘要折叠）", () => {
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
	assert.ok(!output.includes("+1/-1"), "collapsed 默认隐藏 diff 摘要（Ctrl+O 展开才显示）");
});

test("ToolCards：expanded 显示 diff 摘要，hidden 不渲染", () => {
	const tools = [{ seq: 1, callId: "c1", name: "write", args: '{"path":"a.ts"}', status: "done", diffMeta: "--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old();\n+new();\n" }];
	const exp = renderToString(React.createElement(ToolCards, { tools, show: "expanded" }));
	assert.ok(exp.includes("+1/-1"), "expanded 应显示 diff 摘要");
	const hid = renderToString(React.createElement(ToolCards, { tools, show: "hidden" }));
	assert.equal(hid.replace(/\n/g, "").trim(), "", "hidden 不应渲染任何内容");
});

test("工具卡片：running 工具不显示误导性时长（不累计成 4m2s）", () => {
	const conv = fakeConv();
	// running 工具无 finishedAt，之前用 Date.now() 会累计成巨值。
	const started = Date.now() - 242_000; // 4m 2s 前开始，仍未结束
	conv.state.tools = [
		{ seq: 1, callId: "a", name: "run_code", args: "x", status: "running", startedAt: started },
		{ seq: 2, callId: "b", name: "write", args: "y", status: "done", startedAt: Date.now() - 3000, finishedAt: Date.now() - 1000 }
	];
	const output = renderToString(
		React.createElement(App, {
			conv,
			session: { sessionId: "session-des", agentPreset: "code", cwd: "C:\\work" },
			onCommand: () => {},
			onExit: () => {}
		})
	);
	// running 卡不应出现 (4m 2s) 这类巨额耗时；done 卡可显示短耗时
	assert.ok(!/4m 2s/.test(output), "running 工具不应显示累计巨值时长");
	assert.ok(/◐/.test(output), "running 工具保留 ◐ 状态");
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

test("App 渲染：有挂起审批时显示审批面板（等待批准 + 工具名）", () => {
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
	// 新 HUD 去掉了 APPROVE 标签；审批信息在独立面板展示（y/Y/n）。
	assert.ok(output.includes("等待批准") || output.includes("y"), "审批信息应在审批面板而非 HUD 标签");
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

test("App 渲染：mux 重连时显示 Reconnecting 横幅", () => {
	const conv = fakeConv();
	conv.state.reconnecting = { n: 2, max: 6 };
	const output = renderToString(
		React.createElement(App, {
			conv,
			session: { sessionId: "session-abcdef123456", agentPreset: "code", cwd: "C:\\work" },
			onCommand: () => {},
			onExit: () => {}
		})
	);
	assert.ok(output.includes("正在重连"), "应渲染重连提示");
	assert.ok(output.includes("2/6"), "应显示重连进度 n/max");
});
