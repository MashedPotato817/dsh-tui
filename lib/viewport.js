// lib/viewport.js — 终端可视行预算裁剪（纯函数、零依赖、可单测）。
// 修复根因：按“消息条数”截断（旧 WINDOW=60）无法应对「一条 Markdown 消息几十行 + 代码块折行」，
// 导致历史一长就把输入区/HUD 顶出屏幕、视口跳回第一轮。
// 这里按「终端视觉行预算」从最新往前累计，只渲染能放进预算的尾部。
// 纯函数：UI 传入 terminal rows + 文字估算函数，view 只做「求可渲染的尾部切片」。

const EAST_ASIAN_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** 估算一段文本的“显示宽度”（东亚字符记 2，其余记 1）。纯函数。 */
export function displayWidth(text) {
	let w = 0;
	for (const ch of String(text ?? "")) {
		w += EAST_ASIAN_RE.test(ch) ? 2 : 1;
	}
	return w;
}

/** 估算一行文本在给定终端宽度下会被折成多少行（宽>0；太窄至少 1）。 */
export function wrapLines(text, columns) {
	const w = displayWidth(text);
	if (columns <= 0) return 1;
	return Math.max(1, Math.ceil(w / columns));
}

/**
 * 估算一条消息占用的视觉行数（含 markdown 块、折行、灰条、圆点缩进）。
 * @param {object} msg - { role, text, injected, pending, time, sentAt }。
 * @param {number} columns - 终端宽度。
 * @param {object} [opts]
 * @returns {number} 估算的视觉行数。
 */
export function estimateMessageRows(msg, columns, opts = {}) {
	if (!msg) return 0;
	const text = String(msg.text ?? "");
	if (!text) return 1; // 空回复占位一行
	const indent = opts.userIndent ?? 0; // 用户灰条可多占一行
	let rows = 0;
	// 简化：按行拆，逐行算折行；加上 markdown 块的空行/代码块少估一点也够用。
	const lines = text.split("\n");
	for (const l of lines) {
		rows += wrapLines(l, columns);
	}
	// 用户灰条整行背景 + 顶部 padding，多算 1 行安全余量
	if (msg.role === "user") rows += indent;
	return rows;
}

/**
 * 从最新往前累计消息视觉行，返回「能放进行高预算的尾部切片（从某下标开始）」。
 * 预算不足时仍至少保留最新一条（除非预算为 0）。
 * @param {Array<object>} messages
 * @param {number} budget - 可用于消息区的视觉行数（>0）。
 * @param {number} columns - 终端宽度（用于折行估算）。
 * @returns {{ start: number, lines: number }} start=渲染起点下标，lines=实际累计行数。
 */
export function tailWithinBudget(messages, budget, columns) {
	if (!Array.isArray(messages)) return { start: 0, lines: 0 };
	if (budget <= 0 || columns <= 0) {
		// 预算不足：尽力保留最新一条
		return messages.length ? { start: Math.max(0, messages.length - 1), lines: estimateMessageRows(messages[messages.length - 1], columns) } : { start: 0, lines: 0 };
	}
	let used = 0;
	let start = messages.length;
	for (let i = messages.length - 1; i >= 0; i--) {
		const r = estimateMessageRows(messages[i], columns);
		if (used + r > budget) {
			break; // 放不下了，从 i+1 开始
		}
		used += r;
		start = i;
	}
	return { start, lines: used };
}

/**
 * 计算消息区可用的行高预算：终端高 − 固定元素（banner/hud/input/worked/安全余量）。
 * @param {number} terminalRows - stdout.rows。
 * @param {object} [fixed]
 * @returns {number} 可用于消息的视觉行数（≥1）。
 */
export function messageBudget(terminalRows, fixed = {}) {
	const total = Number.isFinite(terminalRows) ? terminalRows : 30;
	const consume =
		(fixed.banner || 2) +
		(fixed.hud || 1) +
		(fixed.input || 2) +
		(fixed.worked || 1) +
		(fixed.docks || 4) +
		(fixed.stream || 0) + // 增长中的流式正文
		(fixed.margin || 2);
	return Math.max(1, total - consume);
}
