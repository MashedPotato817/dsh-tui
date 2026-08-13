// 单元飞轮：UI Mode 状态机——派生当前交互模式。
import { test } from "node:test";
import assert from "node:assert/strict";
import { UI_MODES, deriveMode, modeLabel } from "../lib/ui-mode.js";

test("deriveMode：无审批无帮助 → chat", () => {
	assert.equal(deriveMode({}, {}), UI_MODES.CHAT);
	assert.equal(deriveMode({ pendingApprovals: [] }, {}), UI_MODES.CHAT);
	assert.equal(deriveMode(null, {}), UI_MODES.CHAT);
});

test("deriveMode：有挂起审批 → approving（优先于帮助）", () => {
	const snap = { pendingApprovals: [{ approvalId: "ap", toolName: "write" }] };
	assert.equal(deriveMode(snap, {}), UI_MODES.APPROVING);
	// 即使 showHelp 也为 true，审批仍优先
	assert.equal(deriveMode(snap, { showHelp: true }), UI_MODES.APPROVING);
});

test("deriveMode：showHelp 且无审批 → help", () => {
	assert.equal(deriveMode({ pendingApprovals: [] }, { showHelp: true }), UI_MODES.HELP);
});

test("modeLabel：各模式有标签", () => {
	assert.equal(modeLabel(UI_MODES.CHAT), "CHAT");
	assert.equal(modeLabel(UI_MODES.APPROVING), "APPROVE");
	assert.equal(modeLabel(UI_MODES.HELP), "HELP");
});
