/**
 * 命令历史：记录最近发送的 prompt，支持上/下键翻阅翻历史（readline 经典，
 * Claude Code/Codex 均有）。
 *
 * 纯内存环形缓冲：push 去重连续重复，navigate 在历史中上下移动。
 */
const DEFAULT_MAX = 50;

export function createHistory(max = DEFAULT_MAX) {
	return {
		max,
		items: [], // 新→旧 或 旧→新？用「旧→新」+ index 指向当前
		index: -1 // 当前浏览位置（-1 表示回到草稿输入）
	};
}

/** 记录一条新提交的 prompt；连续重复去重。返回新 state。 */
export function pushHistory(history, text) {
	const s = text.trim();
	if (!s) return { ...history, index: -1 };
	const items = [...history.items];
	if (items[items.length - 1] === s) {
		return { ...history, index: -1 };
	}
	items.push(s);
	if (items.length > history.max) items.shift();
	return { items, max: history.max, index: -1 };
}

/**
 * 在历史中上下移动。
 * @param {object} history
 * @param {'up'|'down'} dir
 * @param {string} [current] - 当前输入框内容（用于 down 回到最末的草稿）。
 * @returns {{ history: object, text: string|null }} text=null 表示无更多历史。
 */
export function navigateHistory(history, dir, current = "") {
	const items = history.items;
	if (items.length === 0) return { history, text: null };
	const clone = { ...history };

	if (dir === "up") {
		// 第一次 up 跳到最后一条（最近）；之后往更旧走。
		const target = clone.index === -1 ? items.length - 1 : clone.index - 1;
		if (target < 0) return { history: clone, text: null };
		clone.index = target;
		return { history: clone, text: items[target] };
	}
	// down
	if (clone.index <= -1) return { history: clone, text: current };
	const target = clone.index - 1;
	clone.index = target;
	if (target === -1) {
		// 回到草稿
		return { history: clone, text: current };
	}
	return { history: clone, text: items[target] };
}
