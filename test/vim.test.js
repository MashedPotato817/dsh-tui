// 单元飞轮：Vim 模态状态机 —— 纯函数全覆盖。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVim, vimKey, submitText, MODES } from "../lib/vim.js";
/** 连续按键，返回最终 state（忽略中间 action）。多字符字符串按字符拆分。 */
function typeKeys(initial, keys) {
	let state = initial;
	const flat = [];
	for (const key of keys) {
		if (typeof key === "string" && key.length > 1) {
			for (const ch of key) flat.push(ch);
		} else {
			flat.push(key);
		}
	}
	for (const key of flat) {
		state = vimKey(state, key).state;
	}
	return state;
}

test("初始状态：normal 模态，单行空 buffer", () => {
	const vim = createVim();
	assert.equal(vim.mode, MODES.NORMAL);
	assert.deepEqual(vim.lines, [""]);
	assert.deepEqual(vim.cursor, { row: 0, col: 0 });
	assert.equal(submitText(vim), "");
});

test("insert 打字：字符插入光标处，光标前进", () => {
	let state = createVim();
	state = vimKey(state, "i").state;
	state = typeKeys(state, ["h", "e", "l", "l", "o"]);
	assert.equal(state.mode, MODES.INSERT);
	assert.equal(submitText(state), "hello");
	assert.deepEqual(state.cursor, { row: 0, col: 5 });
});

test("insert Enter → submit action，buffer 保持不变", () => {
	let state = createVim();
	state = vimKey(state, "i").state;
	state = typeKeys(state, ["你", "好"]);
	const result = vimKey(state, "enter");
	assert.equal(result.action, "submit");
	assert.equal(submitText(result.state), "你好");
});

test("ESC 回 normal 后光标退回插入前；i/a/I/A 进入 insert", () => {
	// 基准：输入 "ab"，escape 回 normal。escape 把光标退回刚插入文本前的位置
	// （插 "ab" 后光标在 col2，escape 到 col1 = a|b 之间的 b 上）。
	const makeAb = () => {
		let s = createVim();
		s = vimKey(s, "i").state;
		s = typeKeys(s, ["ab"]);
		s = vimKey(s, "escape").state;
		assert.equal(s.mode, MODES.NORMAL);
		assert.equal(s.cursor.col, 1);
		return s;
	};

	// i：在光标处（col1，b 上）插入
	let s = makeAb();
	s = vimKey(s, "i").state;
	s = vimKey(s, "X").state;
	assert.equal(submitText(s), "aXb");

	// a：从光标后插 (col1 → col2)
	let s2 = makeAb();
	s2 = vimKey(s2, "a").state;
	s2 = vimKey(s2, "Z").state;
	assert.equal(submitText(s2), "abZ");

	// I：行首插入
	let s3 = makeAb();
	s3 = vimKey(s3, "I").state;
	s3 = vimKey(s3, "0").state;
	assert.equal(submitText(s3), "0ab");

	// A：行尾插入
	let s4 = makeAb();
	s4 = vimKey(s4, "A").state;
	s4 = vimKey(s4, "9").state;
	assert.equal(submitText(s4), "ab9");
});

test("normal 移动：h/l/0/$/^/w/b", () => {
	let state = createVim();
	state = vimKey(state, "i").state;
	state = typeKeys(state, ["hello world"]);
	state = vimKey(state, "escape").state; // cursor col 11

	state = vimKey(state, "0").state;
	assert.equal(state.cursor.col, 0);
	state = vimKey(state, "$").state;
	assert.equal(state.cursor.col, 11);
	state = vimKey(state, "h").state;
	assert.equal(state.cursor.col, 10);
	state = vimKey(state, "l").state;
	assert.equal(state.cursor.col, 11);

	// w：从行首跳到 world 的 w（index 6）
	state = vimKey(state, "0").state;
	state = vimKey(state, "w").state;
	assert.equal(state.cursor.col, 6);
	// b：跳回 hello
	state = vimKey(state, "b").state;
	assert.equal(state.cursor.col, 0);

	// ^：跳到第一个非空白（在前面加两个空格）
	state = vimKey(state, "I").state;
	let padded = typeKeys(state, [" ", " "]);
	padded = vimKey(padded, "escape").state;
	padded = vimKey(padded, "^").state;
	assert.equal(padded.cursor.col, 2);
});

test("o/O 开新行，j/k 行间移动", () => {
	let state = createVim();
	state = vimKey(state, "i").state;
	state = typeKeys(state, ["first"]);
	state = vimKey(state, "escape").state;
	state = vimKey(state, "o").state;
	state = typeKeys(state, ["second"]);
	assert.equal(state.mode, MODES.INSERT);
	assert.deepEqual(state.lines, ["first", "second"]);
	state = vimKey(state, "escape").state;
	assert.deepEqual(state.cursor, { row: 1, col: 5 });
	state = vimKey(state, "k").state;
	assert.equal(state.cursor.row, 0);
	state = vimKey(state, "j").state;
	assert.equal(state.cursor.row, 1);
	assert.equal(submitText(state), "first\nsecond");
});

test("x 删字符、dd 删行、u 撤销", () => {
	let state = createVim();
	state = vimKey(state, "i").state;
	state = typeKeys(state, ["abc"]);
	state = vimKey(state, "escape").state; // 光标 col 2（c 上）
	assert.equal(state.cursor.col, 2);
	state = vimKey(state, "h").state; // col 1（b 上）
	state = vimKey(state, "x").state; // 删除 b
	assert.equal(submitText(state), "ac");

	// o 开新行，cursor 在空行(row1)，dd 删掉空行，剩 "ac"
	state = vimKey(state, "o").state;
	state = vimKey(state, "escape").state;
	assert.deepEqual(state.lines, ["ac", ""]);
	assert.deepEqual(state.cursor, { row: 1, col: 0 });
	state = vimKey(state, "d").state;
	state = vimKey(state, "d").state;
	assert.deepEqual(state.lines, ["ac"]);
	assert.deepEqual(state.cursor, { row: 0, col: 0 });

	// u 撤销 dd
	state = vimKey(state, "u").state;
	assert.deepEqual(state.lines, ["ac", ""]);
});

test("dd 复合键：d 后跟其它键取消", () => {
	let state = createVim();
	state = vimKey(state, "i").state;
	state = typeKeys(state, ["abc"]);
	state = vimKey(state, "escape").state;
	state = vimKey(state, "0").state;
	state = vimKey(state, "d").state;
	assert.equal(state.pending, "d");
	state = vimKey(state, "x").state;
	assert.equal(state.pending, "");
	assert.equal(submitText(state), "bc"); // 只删了一个字符
});

test("命令模态：: 进入，输入命令，Enter → run-command，ESC → cancel", () => {
	let state = createVim();
	state = vimKey(state, ":").state;
	assert.equal(state.mode, MODES.COMMAND);
	state = typeKeys(state, ["w"]);
	const run = vimKey(state, "enter");
	assert.equal(run.action, "run-command");
	assert.equal(run.command, "w");
	assert.equal(run.state.mode, MODES.NORMAL);

	let s2 = vimKey(createVim(), ":").state;
	s2 = typeKeys(s2, ["q"]);
	const cancel = vimKey(s2, "escape");
	assert.equal(cancel.action, "cancel-command");
	assert.equal(cancel.state.mode, MODES.NORMAL);
});

test("backspace / delete / 方向键在 insert 下工作", () => {
	let state = createVim();
	state = vimKey(state, "i").state;
	state = typeKeys(state, ["abc"]);
	state = vimKey(state, "backspace").state;
	assert.equal(submitText(state), "ab");
	state = vimKey(state, "left").state;
	assert.equal(state.cursor.col, 1);
	state = vimKey(state, "d").state;
	assert.equal(submitText(state), "adb");
	state = vimKey(state, "home").state;
	assert.equal(state.cursor.col, 0);
	state = vimKey(state, "end").state;
	assert.equal(state.cursor.col, 3);
});

test("多行输入：Shift+Enter / Ctrl+J 在 insert 光标处切行，Enter 才提交", () => {
	let state = createVim();
	state = vimKey(state, "i").state;
	state = typeKeys(state, ["a", "b", "c"]);
	// 光标移到 b|c 之间，shift-enter 切行
	state = vimKey(state, "left").state; // col 2（c 前）
	const r1 = vimKey(state, "shift-enter");
	assert.equal(r1.action, "none", "shift-enter 不应提交");
	assert.deepEqual(r1.state.lines, ["ab", "c"], "应在光标处切行");
	assert.equal(submitText(r1.state), "ab\nc");

	// Ctrl+J 也在新行尾再切（等效）
	const r2 = vimKey(r1.state, "ctrl-j");
	assert.deepEqual(r2.state.lines, ["ab", "", "c"], "ctrl-j 追加一空行");

	// Enter 仍提交
	const submit = vimKey(r2.state, "enter");
	assert.equal(submit.action, "submit");
	assert.equal(submitText(submit.state), "ab\n\nc");
});

test("Claude Code 心智：ESC 回 normal（保留草稿），再按一次 ESC 且非空则清空整框", () => {
	let state = createVim();
	state = vimKey(state, "i").state; // insert
	state = typeKeys(state, ["h", "i", "!"]); // "hi!"
	// 第一次 ESC → 回 normal，草稿保留
	const esc1 = vimKey(state, "escape");
	assert.equal(esc1.state.mode, MODES.NORMAL);
	assert.equal(submitText(esc1.state), "hi!", "第一次 ESC 不清空草稿");
	// 第二次 ESC（normal 且非空）→ 清空并回到 insert（可直接接着打字）
	const esc2 = vimKey(esc1.state, "escape");
	assert.equal(esc2.state.mode, MODES.INSERT, "清空后应回 insert 便于继续输入");
	assert.equal(submitText(esc2.state), "", "第二次 ESC 应清空整个输入");
	// 清空后可直接继续打字（insert）
	const typed = vimKey(esc2.state, "x");
	assert.equal(submitText(typed.state), "x", "清空后 insert 可立即输入");
});
