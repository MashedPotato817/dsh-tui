/**
 * 输入桥：把 Ink useInput 的 `(input, key)` 事件映射成 vimKey 的按键串并执行。
 *
 * Ink 回调签名：`(input: string, key) => void` — input 是可打印字符（粘贴
 * 时可能是整段字符串），key 有 {return, escape, backspace, delete,
 * left/right/up/down Arrow, home, end, tab, ctrl, ...}。
 *
 * 返回 vimKey 的结果 { state, action }；action 供 UI 处理
 * （submit / run-command / cancel-command）。多字符粘贴拆成逐字符，
 * 只保最后一个动作（防连续提交）。
 */
import { vimKey } from "./vim.js";

/** 基于键码的规范化按键（返回 null 表示交给 input 分支）。 */
export function keyToVimKey(key) {
	if (!key) return null;
	if (key.return) return key.shift ? "shift-enter" : "enter";
	if (key.escape) return "escape";
	if (key.backspace) return "backspace";
	if (key.delete) return "delete";
	if (key.leftArrow) return "left";
	if (key.rightArrow) return "right";
	if (key.upArrow) return "up";
	if (key.downArrow) return "down";
	if (key.home) return "home";
	if (key.end) return "end";
	if (key.tab) return "tab";
	return null;
}

/**
 * 把一个 Ink 输入事件转成 vimKey 按键序列。
 * @param {string} input - 可打印输入（可能整段）。
 * @param {object} key - Ink key 结构。
 * @returns {string[]} 按键数组。
 */
export function inputToKeys(input, key) {
	const named = keyToVimKey(key);
	if (named) return [named];
	if (key && key.ctrl && (input === "j" || input === "J")) return ["ctrl-j"];
	if (input) return [...input]; // 整段粘贴拆成逐字符
	return [];
}

/**
 * 处理一个 Ink 输入事件，返回 { state, action }。
 * @param {object} vim - 当前 vim 状态。
 * @param {string} input - Ink 的可打印输入。
 * @param {object} key - Ink 的 key 结构。
 */
export function processInput(vim, input, key) {
	let state = vim;
	let lastAction = "none";
	let lastCmd = "";
	for (const k of inputToKeys(input, key)) {
		const result = vimKey(state, k);
		state = result.state;
		if (result.action !== "none") {
			lastAction = result.action;
			lastCmd = result.command ?? "";
		}
	}
	return { state, action: lastAction, command: lastCmd };
}
