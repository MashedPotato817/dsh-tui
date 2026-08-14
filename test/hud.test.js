// 单元飞轮：HUD 状态派生 —— token 汇总、成本计算、mode 映射。
import { test } from "node:test";
import assert from "node:assert/strict";
import { sumUsage, priceFor, costUsd, hudState, formatCost, DEFAULT_PRICES, formatDuration, turnElapsedLabel, contextWindowLabel, toolDurationLabel } from "../lib/hud.js";

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

test("formatDuration：秒/分/时切换", () => {
	assert.equal(formatDuration(3000), "3s");
	assert.equal(formatDuration(59_000), "59s");
	assert.equal(formatDuration(65_000), "1m 5s");
	assert.equal(formatDuration(125_000), "2m 5s");
	assert.equal(formatDuration(3_720_000), "1h 2m");
	assert.equal(formatDuration(null), null);
	assert.equal(formatDuration(-5), null);
});

test("turnElapsedLabel：HUD 回合耗时段", () => {
	assert.equal(turnElapsedLabel(1_000_000, 1_003_000), " ⏱3s");
	assert.equal(turnElapsedLabel(null, Date.now()), "");
	assert.equal(turnElapsedLabel(1_000_000, 999_000), "");
});

test("contextWindowLabel：model[1M] / [16k] 标注", () => {
	assert.equal(contextWindowLabel("deepseek-chat", 1_000_000), "deepseek-chat[1M]");
	assert.equal(contextWindowLabel("m", 16_000), "m[16k]");
	assert.equal(contextWindowLabel("gpt", 2_500_000), "gpt[2.5M]");
	assert.equal(contextWindowLabel("m", null), "m");
	assert.equal(contextWindowLabel(null, null), "—");
});

test("toolDurationLabel：工具迭代耗时", () => {
	assert.equal(toolDurationLabel(1_000_000, 1_003_000), "(3s)");
	assert.equal(toolDurationLabel(null, 1_003_000), null);
	assert.equal(toolDurationLabel(1_000_000, null), null);
});

test("hudState：turnStartTime 存在时派生回合耗时标签", () => {
	const view = { messages: [], streaming: null, running: true, model: "deepseek-chat", turnStartTime: 1_000_000 };
	const hud = hudState({ view, session: { agentPreset: "code" }, now: 1_003_500 });
	assert.equal(hud.turnElapsedLabel, " ⏱4s");
	assert.equal(hud.modelLabel, "deepseek-chat");
	// 无 now 时回退 Date.now()，turnStartTime=now → label 为空（仍在原点）
	assert.equal(hudState({ view: { ...view, turnStartTime: Date.now() }, session: { agentPreset: "code" } }).turnElapsedLabel, "");
});
