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
export function hudState({ view, session, prices, now }) {
	const usage = sumUsage(view.messages, view.streaming);
	const price = priceFor(view.model, prices);
	const preset = session.agentPreset;
	const contextPct = view.contextWindow && view.contextWindow > 0
		? Math.min(100, Math.round(((usage.input + usage.output) / view.contextWindow) * 100))
		: null;
	return {
		model: view.model ?? "—",
		modelLabel: contextWindowLabel(view.model, view.contextWindow),
		mode: preset === "code" ? "PTC" : preset === "standard" ? "std" : preset ?? "?",
		// 权限档位徽标（Claude Code 概念）：view.permissionMode 来自 LiveConversation。
		permBadge: modeBadge(view.permissionMode), // 默认 manual
		permColor: modeColor(view.permissionMode),
		cwd: session.cwd ?? "",
		running: Boolean(view.running),
		usage,
		contextPct,
		costUsd: costUsd(usage, price),
		sessionId: session.sessionId ? String(session.sessionId).replace(/^session-/, "").slice(0, 8) : "",
		turnElapsedLabel: turnElapsedLabel(view.turnStartTime, now ?? Date.now()),
		contextWindow: view.contextWindow ?? null
	};
}

/** 把成本格式化成紧凑字符串（$0.0012 / 1.2¢）。 */
export function formatCost(usd) {
	if (usd === null || usd === undefined || Number.isNaN(usd)) return null;
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	if (usd < 1) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(2)}`;
}

/**
 * 回合/思考时长格式化（Claude Code "for 2s"· Codex "⏱" 心智）。
 * <60s → "Xs"；<60m → "Xm Ys"；否则 "Xh Ym"。
 * @param {number|null|undefined} ms
 * @returns {string|null}
 */
export function formatDuration(ms) {
	if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rs = s % 60;
	if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	return rm ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * HUD 回合耗时片段：`⏱<1m`（Claude Code/Codex 底部状态栏）。
 * @param {number|null} startedAtMs - turn/start 时间戳；无则不显示。
 * @param {number} nowMs - 当前时间。
 * @returns {string} 拼进 HUD 的片段（含空串）。
 */
export function turnElapsedLabel(startedAtMs, nowMs) {
	if (!startedAtMs || !nowMs || nowMs <= startedAtMs) return "";
	const d = formatDuration(nowMs - startedAtMs);
	return d ? ` ⏱${d}` : "";
}

/**
 * 上下文窗标注：`model[1M]`（Claude Code 对话框的 context window 提示）。
 * @param {number|null} window - contextWindow tokens（1_000_000 = 1M）。
 * @returns {string}
 */
export function contextWindowLabel(model, contextWindow) {
	if (!contextWindow || contextWindow <= 0) return model ? `${model}` : "—";
	if (contextWindow >= 1_000_000) {
		const m = contextWindow / 1_000_000;
		return `${model ?? ""}[${m % 1 === 0 ? m : m.toFixed(1)}M]`.trim();
	}
	const k = Math.round(contextWindow / 1000);
	return `${model ?? ""}[${k}k]`.trim();
}

/**
 * 给定两个时间戳求间隔并格式化成工具卡片里的 `(3s)`。
 * @param {number|null} start
 * @param {number} end - 结束时间戳（tool/result 落定或 now）。
 * @returns {string|null}
 */
export function toolDurationLabel(start, end) {
	if (!start || !end) return null;
	const d = formatDuration(end - start);
	return d ? `(${d})` : null;
}
