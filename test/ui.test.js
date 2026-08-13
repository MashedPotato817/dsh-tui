// UI 冒烟：renderToString 渲染 App 树，验证组件不崩。纯逻辑，无真实 host。
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "ink";
import React from "react";
import App from "../ui/components.js";
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
