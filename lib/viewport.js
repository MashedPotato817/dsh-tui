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
	if (!Array.isArray(messages) || messages.length === 0) return { start: 0, lines: 0 };
	if (budget <= 0 || columns <= 0) {
		// 预算不足：尽力保留最新一条
		const last = messages.length - 1;
		return { start: last, lines: estimateMessageRows(messages[last], columns) };
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
	// P0 修复：最新一条自身就超过预算（0 < budget < 最新消息高度）时，循环在 i=latest 处就 break，
	// 导致 start 仍是 messages.length → 空列表，长回复整片消失。此处回退为「至少保留最新一条」。
	if (start === messages.length) {
		start = messages.length - 1;
		used = estimateMessageRows(messages[start], columns);
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

/**
 * 把消息流摊平成「视觉行块」布局：每条消息按 estimateMessageRows 占若干行，
 * 记录 { msgIndex, lineStart, lineCount }（lineStart 为全局视觉行偏移，top=0，向下累计）。
 * 这是行级视口的基础：允许在单条超长消息内部按视口裁剪滚动，而非只按整条消息分页。
 * @param {Array<object>} messages
 * @param {number} columns
 * @returns {Array<{ msgIndex: number, lineStart: number, lineCount: number }>}
 */
export function buildLineLayout(messages, columns) {
	if (!Array.isArray(messages)) return [];
	const layout = [];
	let lineCursor = 0;
	for (let i = 0; i < messages.length; i++) {
		const lineCount = estimateMessageRows(messages[i], columns);
		layout.push({ msgIndex: i, lineStart: lineCursor, lineCount });
		lineCursor += lineCount;
	}
	return layout;
}

/**
 * 行级视口窗口：给定「从底部向上滚动 scrollLines 行」的意图，返回应渲染的起始块与该块内的起始行。
 * 总是在正数预算内兜底保留最新消息的尾部，绝不会返回空窗口（即便最新消息自身超预算）。
 * @param {Array<object>} messages
 * @param {number} budget - 可渲染视觉行数（>0）。
 * @param {number} columns
 * @param {number} [scrollLines=0] - 从底部往上翻的行数（PageUp 累计语义；0=贴底跟随）。
 * @returns {{ startMsg: number, startLine: number, scrollLines: number }}
 *   startMsg=渲染的起始消息下标，startLine=该消息内起始视觉行。
 *   scrollLines 会夹到 [0, totalLines - 1]，避免越界。
 */
export function windowViewport(messages, budget, columns, scrollLines = 0) {
	if (!Array.isArray(messages) || messages.length === 0) {
		return { startMsg: 0, startLine: 0, scrollLines: 0 };
	}
	const layout = buildLineLayout(messages, columns);
	const totalLines = layout.length ? layout[layout.length - 1].lineStart + layout[layout.length - 1].lineCount : 0;
	const clampedScroll = Math.max(0, Math.min(Math.max(0, scrollLines), Math.max(0, totalLines - 1)));
	// 窗口底部（全局行）= 总行数 - 1 - clampedScroll；窗口顶 = 底部 - budget + 1
	const bottomLine = Math.max(0, totalLines - 1 - clampedScroll);
	const topLine = Math.max(0, bottomLine - Math.max(1, budget) + 1);
	// 找到含 topLine 的块
	let startMsg = 0;
	let startLine = 0;
	for (const b of layout) {
		const bEnd = b.lineStart + b.lineCount - 1;
		if (topLine <= bEnd) {
			startMsg = b.msgIndex;
			startLine = Math.max(0, topLine - b.lineStart);
			break;
		}
	}
	return { startMsg, startLine, scrollLines: clampedScroll };
}
