/**
 * HUD 状态派生：把 LiveConversation 快照 + 会话信息折成状态栏一行。
 *
 * Claude Code HUD 风格：model / cost / mode / cwd / running，紧凑一行。
 * 成本按内置近似价格表（USD/百万 token）计算，价格可注入覆盖；
 * 模型不在表里时 costUsd 为 null（只显示 token 数，不假装知道价格）。
 */
export const DEFAULT_PRICES = {
	"deepseek-chat": { input: 0.27, cacheRead: 0.07, output: 1.1 },
	"deepseek-reasoner": { input: 0.55, cacheRead: 0.14, output: 2.19 }
};

import { modeBadge, modeColor } from "./permission.js";

/** 汇总消息 + 流式草稿里的 token 用量。 */
export function sumUsage(messages = [], streaming = null) {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	for (const message of messages) {
		if (message && message.usage) {
			input += message.usage.inputTokens ?? 0;
			output += message.usage.outputTokens ?? 0;
			cacheRead += message.usage.cacheReadTokens ?? 0;
			cacheWrite += message.usage.cacheWriteTokens ?? 0;
		}
	}
	if (streaming && streaming.usage) {
		input += streaming.usage.inputTokens ?? 0;
		output += streaming.usage.outputTokens ?? 0;
		cacheRead += streaming.usage.cacheReadTokens ?? 0;
		cacheWrite += streaming.usage.cacheWriteTokens ?? 0;
	}
	return { input, output, cacheRead, cacheWrite };
}

/** 按模型查价格（精确匹配，缺省回退 deepseek-chat，再缺省 null）。 */
export function priceFor(model, prices = DEFAULT_PRICES) {
	if (!model) return prices["deepseek-chat"] ?? null;
	return prices[model] ?? prices["deepseek-chat"] ?? null;
}

/** token 用量 × 价格表 → 美元成本；无价格表返回 null。 */
export function costUsd(usage, price) {
	if (!price) return null;
	return (
		((usage.input ?? 0) * price.input +
			(usage.output ?? 0) * price.output +
			(usage.cacheRead ?? 0) * (price.cacheRead ?? 0)) /
		1_000_000
	);
}

/**
 * 派生 HUD 一行。
 * @param {object} input
 * @param {object} input.view - LiveConversation 快照。
 * @param {object} input.session - { sessionId, agentPreset, cwd }。
 * @param {object} [input.prices]
 * @returns {{ model, mode, cwd, running, usage, costUsd, sessionId }}
 */
export function hudState({ view, session, prices }) {
	const usage = sumUsage(view.messages, view.streaming);
	const price = priceFor(view.model, prices);
	const preset = session.agentPreset;
	const contextPct = view.contextWindow && view.contextWindow > 0
		? Math.min(100, Math.round(((usage.input + usage.output) / view.contextWindow) * 100))
		: null;
	return {
		model: view.model ?? "—",
		mode: preset === "code" ? "PTC" : preset === "standard" ? "std" : preset ?? "?",
		// 权限档位徽标（Claude Code 概念）：view.permissionMode 来自 LiveConversation。
		permBadge: modeBadge(view.permissionMode), // 默认 manual
		permColor: modeColor(view.permissionMode),
		cwd: session.cwd ?? "",
		running: Boolean(view.running),
		usage,
		contextPct,
		costUsd: costUsd(usage, price),
		sessionId: session.sessionId ? String(session.sessionId).replace(/^session-/, "").slice(0, 8) : ""
	};
}

/** 把成本格式化成紧凑字符串（$0.0012 / 1.2¢）。 */
export function formatCost(usd) {
	if (usd === null || usd === undefined || Number.isNaN(usd)) return null;
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	if (usd < 1) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(2)}`;
}
