// 单元飞轮：HUD 状态派生 —— token 汇总、成本计算、mode 映射。
import { test } from "node:test";
import assert from "node:assert/strict";
import { sumUsage, priceFor, costUsd, hudState, formatCost, DEFAULT_PRICES } from "../lib/hud.js";

test("sumUsage：消息 + 流式草稿的 token 汇总", () => {
	const usage = sumUsage(
		[
			{ role: "assistant", usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 } },
			{ role: "user" }
		],
		{ text: "草稿", usage: { inputTokens: 10, outputTokens: 5 } }
	);
	assert.deepEqual(usage, { input: 110, output: 25, cacheRead: 30, cacheWrite: 0 });
});

test("priceFor：精确匹配 → 回退 deepseek-chat → null", () => {
	assert.equal(priceFor("deepseek-chat").input, DEFAULT_PRICES["deepseek-chat"].input);
	assert.equal(priceFor("some-unknown-model").input, DEFAULT_PRICES["deepseek-chat"].input);
	assert.equal(priceFor(null, {}), null);
});

test("costUsd：token × 价格（美元）", () => {
	const price = { input: 0.27, output: 1.1, cacheRead: 0.07 };
	const usd = costUsd({ input: 1_000_000, output: 0, cacheRead: 0 }, price);
	assert.equal(usd, 0.27);
	assert.equal(costUsd({ input: 1, output: 1 }, null), null);
});

test("hudState：mode 映射、running、成本为空时 costUsd=null", () => {
	const view = {
		messages: [{ role: "assistant", usage: { inputTokens: 1000, outputTokens: 500 } }],
		streaming: null,
		running: true,
		model: "deepseek-chat"
	};
	const hud = hudState({ view, session: { sessionId: "session-abcdef123456", agentPreset: "code", cwd: "C:\\work" } });
	assert.equal(hud.mode, "PTC");
	assert.equal(hud.running, true);
	assert.equal(hud.model, "deepseek-chat");
	assert.equal(hud.sessionId, "abcdef12");
	assert.equal(hud.cwd, "C:\\work");
	assert.ok(hud.costUsd > 0);

	const noPrice = hudState({ view: { ...view, model: "weird-model" }, session: { agentPreset: "code" }, prices: {} });
	assert.equal(noPrice.costUsd, null);

	const std = hudState({ view, session: { agentPreset: "standard" } });
	assert.equal(std.mode, "std");
});

test("formatCost：紧凑格式", () => {
	assert.equal(formatCost(0.00012), "$0.0001");
	assert.equal(formatCost(0.12), "$0.120");
	assert.equal(formatCost(1.5), "$1.50");
	assert.equal(formatCost(null), null);
});
