// 单元飞轮：输入桥 + slash 面板 —— Ink 事件 → vim 按键映射 + 命令过滤。
import { test } from "node:test";
import assert from "node:assert/strict";
import { inputToKeys, processInput, keyToVimKey } from "../lib/bridge.js";
import { filterCommands, buildSlashPanel, BUILTIN_COMMANDS } from "../lib/slash.js";
import { createVim } from "../lib/vim.js";

test("keyToVimKey：Ink 键名 → vim 按键", () => {
	assert.equal(keyToVimKey({ return: true }), "enter");
	assert.equal(keyToVimKey({ escape: true }), "escape");
	assert.equal(keyToVimKey({ backspace: true }), "backspace");
	assert.equal(keyToVimKey({ leftArrow: true }), "left");
	assert.equal(keyToVimKey({ rightArrow: true }), "right");
	assert.equal(keyToVimKey({ upArrow: true }), "up");
	assert.equal(keyToVimKey({ downArrow: true }), "down");
	assert.equal(keyToVimKey({ home: true }), "home");
	assert.equal(keyToVimKey({ end: true }), "end");
	assert.equal(keyToVimKey({ ctrl: true }), null); // 非移动键留给 input
});

test("inputToKeys：可打印整段拆成逐字符", () => {
	assert.deepEqual(inputToKeys("hello", {}), ["h", "e", "l", "l", "o"]);
	assert.deepEqual(inputToKeys("", { return: true }), ["enter"]);
	assert.deepEqual(inputToKeys("", {}), []);
});

test("processInput：键事件驱动 vim 状态，Enter 触发 submit action", () => {
	let vim = createVim();
	// Alt 用法：i 进 insert
	vim = processInput(vim, "i", {}).state;
	// 打字（Ink 把 'h' 作为 input）
	const typed = processInput(vim, "hi", {});
	assert.equal(typed.state.mode, "insert");
	assert.equal(typed.state.lines[0], "hi");
	// Enter 提交
	const submit = processInput(typed.state, "", { return: true });
	assert.equal(submit.action, "submit");
	// Esc 回 normal
	const esc = processInput(typed.state, "", { escape: true });
	assert.equal(esc.state.mode, "normal");
});

test("processInput：命令模态 run-command", () => {
	let vim = createVim();
	vim = processInput(vim, "", undefined).state; // noop
	// 进命令模态（:）— 对 vimKey(":") 的封装走 input
	vim = processInput(vim, ":", ).state; // ':' 是可打印
	// 打命令
	vim = processInput(vim, "q", {}).state;
	const run = processInput(vim, "", { return: true });
	assert.equal(run.action, "run-command");
	assert.equal(run.command, "q");
});

test("filterCommands：前缀匹配优先，空查询返回全部", () => {
	const all = filterCommands("", BUILTIN_COMMANDS);
	assert.equal(all.length, BUILTIN_COMMANDS.length);
	const status = filterCommands("s", BUILTIN_COMMANDS);
	assert.ok(status.some((c) => c.name === "status"));
	// 前缀命中在前
	const exact = filterCommands("st", BUILTIN_COMMANDS);
	assert.equal(exact[0].name, "status");
});

test("buildSlashPanel：/ 开头才出现，无匹配返回 null", () => {
	assert.equal(buildSlashPanel("hello", BUILTIN_COMMANDS), null);
	const panel = buildSlashPanel("/st", BUILTIN_COMMANDS, { active: 0 });
	assert.ok(panel && panel.items.length > 0);
	assert.equal(panel.active, 0);
	const none = buildSlashPanel("/xyz-not-a-command", BUILTIN_COMMANDS);
	assert.equal(none, null);
});
