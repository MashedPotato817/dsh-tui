// 单元飞轮：全局 mode 状态机 + keybinding 归属表。
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODES, transitionMode, keyOwner } from "../lib/mode.js";

test("transitionMode：允许/禁止转移", () => {
	assert.deepEqual(transitionMode(MODES.CHAT, MODES.COMMAND), { ok: true, to: MODES.COMMAND });
	assert.deepEqual(transitionMode(MODES.CHAT, MODES.COMPLETE), { ok: true, to: MODES.COMPLETE });
	assert.deepEqual(transitionMode(MODES.COMMAND, MODES.CHAT), { ok: true, to: MODES.CHAT });
	// 非法：COMMAND 不能直接跳 HISTORY
	assert.deepEqual(transitionMode(MODES.COMMAND, MODES.HISTORY), { ok: false, to: null });
	// 同态恒允许
	assert.deepEqual(transitionMode(MODES.CHAT, MODES.CHAT), { ok: true, to: MODES.CHAT });
	// 未知态安全
	assert.deepEqual(transitionMode("nope", MODES.CHAT), { ok: false, to: null });
});

test("keyOwner：全局键始终归 global，不因 mode 打架", () => {
	for (const m of Object.values(MODES)) {
		assert.equal(keyOwner(m, { key: "esc" }), "global", `esc 在 ${m} 应归 global`);
		assert.equal(keyOwner(m, { key: "o", ctrl: true }), "global", `ctrl+o 在 ${m} 应归 global`);
		assert.equal(keyOwner(m, { key: "l", ctrl: true }), "global");
	}
});

test("keyOwner：↑ ↓ 在补全归 panel、历史归 history、其它归 global", () => {
	assert.equal(keyOwner(MODES.COMPLETE, { key: "up" }), "panel");
	assert.equal(keyOwner(MODES.COMPLETE, { key: "down" }), "panel");
	assert.equal(keyOwner(MODES.HISTORY, { key: "up" }), "history");
	assert.equal(keyOwner(MODES.CHAT, { key: "up" }), "global");
	// 无 key / 未知 key → null
	assert.equal(keyOwner(MODES.CHAT, {}), null);
	assert.equal(keyOwner(MODES.CHAT, { key: "zzz" }), null);
});
