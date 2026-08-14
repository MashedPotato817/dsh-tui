/**
 * 权限档位：Claude Code 权限模式概念在 dsh-tui 应答策略层的映射。
 *
 * 关键约束：DSH 的审批由 host 控制（approval policy），客户端无法真正 bypass。
 * 所以这里的档位决定的是 dsh-tui 自己的应答策略（policy.allowTools / plan 时 decline），
 * 而不是 host 的权限。档位提供「用户可见的安全档 + 快捷键切换」的心智模型：
 *
 * - manual / plan（默认）：拒绝一切工具审批（allowed-once 也不给），plan-review 一律 decline
 *   —— 只读安全，危险操作被主动挡下。
 * - acceptEdits：放行「文件编辑类」工具（白名单 editableTools 交集）。
 * - bypassPermissions：放行全部工具，但只有显式配置 allowBypassPermissions 才能进入该档。
 *
 * 档位枚举 + 切换 + 档位→allowTools 都是纯函数，可单测。
 */

export const PERMISSION_MODES = {
	MANUAL: "manual",
	PLAN: "plan",
	ACCEPT_EDITS: "acceptEdits",
	BYPASS: "bypassPermissions"
};

/** 档位循环顺序（Shift+Tab 循环），plan 与 manual 等价都保守，故并做一档。 */
const CYCLE = [
	PERMISSION_MODES.MANUAL,
	PERMISSION_MODES.ACCEPT_EDITS,
	PERMISSION_MODES.PLAN,
	PERMISSION_MODES.BYPASS
];

/** 按名解析档位；未知返回 manual。 */
export function parseMode(name) {
	const n = String(name);
	if (n === "acceptEdits" || n === "accept-edits") return PERMISSION_MODES.ACCEPT_EDITS;
	if (n === "plan") return PERMISSION_MODES.PLAN;
	if (n === "bypassPermissions" || n === "bypass") return PERMISSION_MODES.BYPASS;
	return PERMISSION_MODES.MANUAL;
}

/** Shift+Tab 循环到下一个档位。bypass 必须由配置显式加入循环。 */
export function nextMode(mode, { allowBypass = false } = {}) {
	const cycle = allowBypass ? CYCLE : CYCLE.filter((item) => item !== PERMISSION_MODES.BYPASS);
	const i = cycle.indexOf(mode);
	return cycle[(i + 1) % cycle.length];
}

/** 当前档位下的 allowTools 白名单（收到 approval/requested 时据它决定放行）。 */
export function allowToolsForMode(mode, { editableTools = [], allowTools = [] } = {}) {
	switch (mode) {
		case PERMISSION_MODES.ACCEPT_EDITS:
			return editableTools.slice();
		case PERMISSION_MODES.BYPASS:
			return ["*"]; // bypass 的明确语义是一切；是否可进入该档由 allowBypassPermissions 门控
		case PERMISSION_MODES.MANUAL:
		case PERMISSION_MODES.PLAN:
		default:
			return []; // 保守：manual/plan 不自动放行任何工具
	}
}

/** 当前档位对待 plan-review 问询：manual/plan 拒绝，acceptEdits/bypass 放行。 */
export function shouldDeclinePlanReview(mode) {
	return mode === PERMISSION_MODES.MANUAL || mode === PERMISSION_MODES.PLAN;
}

/** 档位 → HUD 徽标文本。 */
export function modeBadge(mode) {
	switch (mode) {
		case PERMISSION_MODES.ACCEPT_EDITS:
			return "⏵⏵ edits";
		case PERMISSION_MODES.PLAN:
			return "⏸ plan";
		case PERMISSION_MODES.BYPASS:
			return "⏵⏵ bypass";
		default:
			return "⏸ manual";
	}
}

/** 档位 → HUD 颜色。 */
export function modeColor(mode) {
	switch (mode) {
		case PERMISSION_MODES.ACCEPT_EDITS:
			return "green";
		case PERMISSION_MODES.PLAN:
			return "yellow";
		case PERMISSION_MODES.BYPASS:
			return "red";
		default:
			return "gray";
	}
}
