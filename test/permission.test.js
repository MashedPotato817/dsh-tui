// 单元飞轮：权限档位 —— 档位枚举/切换/放行映射。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	PERMISSION_MODES,
	parseMode,
	nextMode,
	allowToolsForMode,
	shouldDeclinePlanReview,
	modeBadge,
	modeColor
} from "../lib/permission.js";

test("parseMode：各种别名解析到档位", () => {
	assert.equal(parseMode("manual"), PERMISSION_MODES.MANUAL);
	assert.equal(parseMode("plan"), PERMISSION_MODES.PLAN);
	assert.equal(parseMode("acceptEdits"), PERMISSION_MODES.ACCEPT_EDITS);
	assert.equal(parseMode("accept-edits"), PERMISSION_MODES.ACCEPT_EDITS);
	assert.equal(parseMode("bypassPermissions"), PERMISSION_MODES.BYPASS);
	assert.equal(parseMode("bypass"), PERMISSION_MODES.BYPASS);
	assert.equal(parseMode("unknown-mode"), PERMISSION_MODES.MANUAL, "未知回退 manual");
});

test("nextMode：默认循环不暴露 bypass，显式允许后才加入", () => {
	let m = PERMISSION_MODES.MANUAL;
	const seq = [];
	for (let i = 0; i < 4; i++) {
		m = nextMode(m);
		seq.push(m);
	}
	assert.deepEqual(seq.slice(0, 3), [
		PERMISSION_MODES.ACCEPT_EDITS,
		PERMISSION_MODES.PLAN,
		PERMISSION_MODES.MANUAL
	]);
	assert.equal(nextMode(PERMISSION_MODES.PLAN, { allowBypass: true }), PERMISSION_MODES.BYPASS);
});

test("allowToolsForMode：manual/plan 空，acceptEdits 给编辑工具，bypass 明确代表全部", () => {
	const editable = ["write", "edit"];
	const allow = ["browser_navigate"];
	assert.deepEqual(allowToolsForMode(PERMISSION_MODES.MANUAL, { editableTools: editable, allowTools: allow }), []);
	assert.deepEqual(allowToolsForMode(PERMISSION_MODES.PLAN, { editableTools: editable, allowTools: allow }), []);
	assert.deepEqual(allowToolsForMode(PERMISSION_MODES.ACCEPT_EDITS, { editableTools: editable, allowTools: allow }), editable);
	assert.deepEqual(allowToolsForMode(PERMISSION_MODES.BYPASS, { editableTools: editable, allowTools: allow }), ["*"]);
});

test("shouldDeclinePlanReview：manual/plan 拒绝，acceptEdits/bypass 放行", () => {
	assert.equal(shouldDeclinePlanReview(PERMISSION_MODES.MANUAL), true);
	assert.equal(shouldDeclinePlanReview(PERMISSION_MODES.PLAN), true);
	assert.equal(shouldDeclinePlanReview(PERMISSION_MODES.ACCEPT_EDITS), false);
	assert.equal(shouldDeclinePlanReview(PERMISSION_MODES.BYPASS), false);
});

test("modeBadge/modeColor：各档位有徽标与配色", () => {
	assert.ok(modeBadge(PERMISSION_MODES.MANUAL).includes("manual"));
	assert.ok(modeBadge(PERMISSION_MODES.ACCEPT_EDITS).includes("edits"));
	assert.ok(modeBadge(PERMISSION_MODES.BYPASS).includes("bypass"));
	assert.equal(typeof modeColor(PERMISSION_MODES.PLAN), "string");
});
