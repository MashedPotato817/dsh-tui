/**
 * UI Mode 状态机（对齐 Codex `AppState/Mode`、Claude Code 多模态心智）。
 *
 * 定义终端 App 的顶层交互模式，决定主视区焦点：
 * - 'chat'       对话（默认，消息 + 输入 + 面板共存）
 * - 'help'       快捷键帮助面板（`?` 切换）
 * - 'approving'  有挂起审批，审批卡占据交互焦点（y/Y/n）
 *
 * 纯函数：`deriveMode(snapshot, uiFlags)` 给定会话快照 + UI 标志，派生当前应处模式。
 * 可单测，不依赖 React。
 */

export const UI_MODES = {
	CHAT: "chat",
	HELP: "help",
	APPROVING: "approving"
};

/**
 * 派生当前 UI 模式。
 * @param {object} snapshot - LiveConversation 快照。
 * @param {{ showHelp?: boolean }} ui - UI 层标志。
 * @returns {'chat'|'help'|'approving'}
 */
export function deriveMode(snapshot, { showHelp = false } = {}) {
	// 帮助面板优先（用户主动打开）——但不遮蔽审批（审批是安全相关，更高优先）。
	const hasApprovals = Array.isArray(snapshot?.pendingApprovals) && snapshot.pendingApprovals.length > 0;
	if (hasApprovals) return UI_MODES.APPROVING;
	if (showHelp) return UI_MODES.HELP;
	return UI_MODES.CHAT;
}

/** 模式 → 简短标签（HUD/状态区显示用）。 */
export function modeLabel(mode) {
	switch (mode) {
		case UI_MODES.APPROVING:
			return "APPROVE";
		case UI_MODES.HELP:
			return "HELP";
		default:
			return "CHAT";
	}
}
