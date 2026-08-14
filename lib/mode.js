// lib/mode.js — 显式全局 mode 状态机 + keybinding 表（纯函数、零依赖、可单测）。
// 目标：让「对话 / 审批 / 命令 / 补全 / 历史」等界面态互不打架（Batch 3 架构思路）。
// 这里先落地可测试的纯状态机 + 键位归属表，UI 层后续接入；不改协议。
// Mode 是「当前交互上下文」，决定哪些键全局可用、哪些让给具体面板。

export const MODES = {
	CHAT: "chat",          // 普通对话/输入
	APPROVING: "approving", // 有挂起审批
	COMMAND: "command",     // : 命令态
	COMPLETE: "complete",   // 补全面板（/ 或 @）
	HISTORY: "history",     // 上翻历史浏览
	HELP: "help"            // ? 帮助
};

/** 允许的 mode 转移表：from → Set(to)。 */
const TRANSITIONS = {
	[MODES.CHAT]: [MODES.APPROVING, MODES.COMMAND, MODES.COMPLETE, MODES.HISTORY, MODES.HELP],
	[MODES.APPROVING]: [MODES.CHAT, MODES.APPROVING],
	[MODES.COMMAND]: [MODES.CHAT, MODES.COMPLETE],
	[MODES.COMPLETE]: [MODES.CHAT, MODES.HISTORY],
	[MODES.HISTORY]: [MODES.CHAT, MODES.HELP],
	[MODES.HELP]: [MODES.CHAT]
};

/**
 * 尝试转移 mode。返回是否允许 + （若转移）新 mode。
 * @param {string} from
 * @param {string} to
 * @returns {{ ok: boolean, to: string|null }}
 */
export function transitionMode(from, to) {
	if (from === to) return { ok: true, to };
	const allowed = TRANSITIONS[from] || [];
	return allowed.includes(to) ? { ok: true, to } : { ok: false, to: null };
}

/**
 * 键位归属表：某「键名 + 修饰」在当前 mode（全局或面板态）下属于谁。
 * 用于避免同键在不同态打架（如 ↑ 在 COMPLETE 给补全面板、在 CHAT/HISTORY 给历史）。
 * @param {string} mode
 * @param {Array<{ key: string, ctrl?: boolean, shift?: boolean, meta?: boolean }>} key
 * @returns {string|null} 归属 ('global' | 'panel' | 'history' | null)
 */
export function keyOwner(mode, key) {
	const k = String(key?.key ?? "");
	const modifier = key?.ctrl ? "ctrl+" : key?.meta ? "meta+" : key?.shift ? "shift+" : "";
	const id = `${modifier}${k}`;
	if (!id) return null;
	// 全局始终占用：esc / ctrl+c / ctrl+l / ctrl+o
	const GLOBAL_OWNED = new Set(["esc", "ctrl+c", "ctrl+l", "ctrl+o", "ctrl+q"]);
	if (GLOBAL_OWNED.has(id)) return "global";
	// 补全面板态：↑↓/Tab/Enter 归 panel
	if (id === "up" || id === "down" || id === "tab" || id === "enter") {
		return mode === MODES.COMPLETE ? "panel" : mode === MODES.HISTORY ? "history" : "global";
	}
	// 历史态：↑↓ 归 history
	return null;
}
