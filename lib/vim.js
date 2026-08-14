/**
 * Vim 模态输入状态机（纯函数，无 IO，可整机测试）。
 *
 * 模态：normal（浏览/编辑命令）/ insert（打字）/ command（":" 命令）。
 * vimKey(state, key) 返回 `{ state, action }`：
 *   action 'submit'       → UI 应提交当前 buffer（Enter 在 normal/insert 均提交，聊天快路径）
 *   action 'run-command'  → UI 应执行 command 字符串（:w 提交 / :q 退出 / :new 新会话 …）
 *   action 'cancel-command' → 从 command 模态退回 normal
 *   action 'none'         → 只是编辑动作
 *
 * 关键按键（normal）：i/a/I/A/o/O 进入 insert，h/j/k/l/0/$/^/w/b 移动，
 * x/X 删字符，dd 删行，u 撤销，":" 进命令模态，Enter 提交。
 * 插入/删除用数组行模型，多行编辑由 o/O 开新行；提交文本 = lines.join("\n")。
 */

export const MODES = {
	NORMAL: "normal",
	INSERT: "insert",
	COMMAND: "command"
};

const WHITESPACE = /\s/;

export function createVim() {
	return {
		mode: MODES.NORMAL,
		lines: [""],
		cursor: { row: 0, col: 0 },
		command: "",
		pending: "", // 复合键（dd）暂存
		undo: []
	};
}

function clone(state, patch) {
	const next = {
		...state,
		cursor: { ...state.cursor },
		lines: [...state.lines],
		undo: [...state.undo],
		...patch
	};
	return next;
}

/** 行内 clamp 光标列到合法范围。 */
function clampCol(state) {
	const line = state.lines[state.cursor.row] ?? "";
	state.cursor.col = Math.max(0, Math.min(state.cursor.col, line.length));
	return state;
}

function pushUndo(state) {
	if (state.undo.length >= 50) state.undo.shift();
	state.undo.push({ lines: [...state.lines], cursor: { ...state.cursor }, mode: state.mode });
}

/** 提交文本（多行按 \n 连接）。 */
export function submitText(state) {
	return state.lines.join("\n");
}

function wordForward(line, col) {
	let i = col;
	while (i < line.length && !WHITESPACE.test(line[i])) i++;
	while (i < line.length && WHITESPACE.test(line[i])) i++;
	return i;
}

function wordBack(line, col) {
	let i = col > 0 ? col - 1 : 0;
	while (i > 0 && WHITESPACE.test(line[i])) i--;
	while (i > 0 && !WHITESPACE.test(line[i - 1])) i--;
	return i;
}

/** 纯变换：一次按键 → 新状态 + action。 */
export function vimKey(prev, key) {
	if (prev.mode === MODES.COMMAND) {
		return commandKey(prev, key);
	}
	if (prev.mode === MODES.INSERT) {
		return insertKey(prev, key);
	}
	return normalKey(prev, key);
}

function normalKey(prev, key) {
	let state = clone(prev);
	state.pending = "";

	switch (key) {
		// ── 进入 insert ─────────────────────────────
		case "i":
			return enterInsert(state);
		case "a":
			state.cursor.col = Math.min(state.cursor.col + 1, state.lines[state.cursor.row].length);
			return enterInsert(state);
		case "I":
			state.cursor.col = 0;
			return enterInsert(state);
		case "A": {
			state.cursor.col = state.lines[state.cursor.row].length;
			return enterInsert(state);
		}
		case "o":
		case "O": {
			pushUndo(state);
			const row = state.cursor.row + (key === "o" ? 1 : 0);
			state.lines.splice(row, 0, "");
			state.cursor = { row, col: 0 };
			return enterInsert(state);
		}
		// ── 移动 ────────────────────────────────────
		case "h":
		case "left":
			state.cursor.col = Math.max(0, state.cursor.col - 1);
			break;
		case "l":
		case "right":
			state.cursor.col = Math.min(state.cursor.col + 1, state.lines[state.cursor.row].length);
			break;
		case "j":
		case "down":
			state.cursor.row = Math.min(state.cursor.row + 1, state.lines.length - 1);
			clampCol(state);
			break;
		case "k":
		case "up":
			state.cursor.row = Math.max(0, state.cursor.row - 1);
			clampCol(state);
			break;
		case "0":
		case "home":
			state.cursor.col = 0;
			break;
		case "$":
		case "end":
			state.cursor.col = state.lines[state.cursor.row].length;
			break;
		case "^":
			state.cursor.col = state.lines[state.cursor.row].search(/\S/) >= 0
				? state.lines[state.cursor.row].search(/\S/)
				: 0;
			break;
		case "w":
			state.cursor.col = wordForward(state.lines[state.cursor.row], state.cursor.col);
			break;
		case "b":
			state.cursor.col = wordBack(state.lines[state.cursor.row], state.cursor.col);
			break;
		// ── 编辑 ────────────────────────────────────
		case "x": {
			pushUndo(state);
			const line = state.lines[state.cursor.row];
			if (state.cursor.col < line.length) {
				state.lines[state.cursor.row] = line.slice(0, state.cursor.col) + line.slice(state.cursor.col + 1);
			}
			break;
		}
		case "X": {
			pushUndo(state);
			const line = state.lines[state.cursor.row];
			if (state.cursor.col > 0) {
				state.lines[state.cursor.row] = line.slice(0, state.cursor.col - 1) + line.slice(state.cursor.col);
				state.cursor.col -= 1;
			}
			break;
		}
		case "u": {
			const snapshot = state.undo.pop();
			if (snapshot) {
				state.lines = snapshot.lines;
				state.cursor = snapshot.cursor;
			}
			break;
		}
		case "d": {
			// 复合键：等下一个键（dd=删行，其它=取消）
			state.pending = "d";
			break;
		}
		case "enter":
			return { state: clone(prev), action: "submit" };
		case ":":
			return { state: clone(prev, { mode: MODES.COMMAND, command: "" }), action: "none" };
		case "escape":
			// Claude Code 式：第一次 ESC 已退回 normal（保留草稿）；在 normal 下再按一次 ESC
			// 且输入非空 → 清空并**回到 insert（可直接继续打字）**。normal 下 buffer 空则不做事。
			if (submitText(prev).trim() !== "") {
				return { state: clone(prev, { mode: MODES.INSERT, lines: [""], cursor: { row: 0, col: 0 }, pending: "", undo: [] }), action: "clear" };
			}
			break;
		default:
			break; // normal 模态下其它键忽略
	}

	if (prev.pending === "d" && key === "d") {
		pushUndo(state);
		if (state.lines.length > 1) {
			state.lines.splice(state.cursor.row, 1);
			state.cursor.row = Math.max(0, state.cursor.row - 1);
			clampCol(state);
		} else {
			state.lines[0] = "";
			state.cursor.col = 0;
		}
		state.pending = "";
		return { state, action: "none" };
	}

	return { state, action: "none" };
}

function enterInsert(state) {
	state.mode = MODES.INSERT;
	return { state, action: "none" };
}

function insertKey(prev, key) {
	let state = clone(prev);
	switch (key) {
		case "escape":
			state.mode = MODES.NORMAL;
			state.cursor.col = Math.max(0, state.cursor.col - 1); // 退回刚插入的位置（简化）
			break;
		case "enter":
			return { state: clone(prev), action: "submit" };
		case "shift-enter":
		case "ctrl-j":
			// 多行输入：在当前光标处切行（Claude Code/Codex 式 Shift+Enter 或 Ctrl+J 换行）
			{
				const line = state.lines[state.cursor.row];
				const before = line.slice(0, state.cursor.col);
				const after = line.slice(state.cursor.col);
				state.lines.splice(state.cursor.row, 1, before, after);
				state.cursor.row += 1;
				state.cursor.col = 0;
			}
			break;
		case "backspace": {
			const line = state.lines[state.cursor.row];
			if (state.cursor.col > 0) {
				state.lines[state.cursor.row] = line.slice(0, state.cursor.col - 1) + line.slice(state.cursor.col);
				state.cursor.col -= 1;
			} else if (state.cursor.row > 0) {
				const prevLine = state.lines[state.cursor.row - 1];
				state.lines.splice(state.cursor.row, 1);
				state.cursor.row -= 1;
				state.cursor.col = prevLine.length;
			}
			break;
		}
		case "delete": {
			const line = state.lines[state.cursor.row];
			if (state.cursor.col < line.length) {
				state.lines[state.cursor.row] = line.slice(0, state.cursor.col) + line.slice(state.cursor.col + 1);
			}
			break;
		}
		case "left":
			state.cursor.col = Math.max(0, state.cursor.col - 1);
			break;
		case "right":
			state.cursor.col = Math.min(state.cursor.col + 1, state.lines[state.cursor.row].length);
			break;
		case "up":
			state.cursor.row = Math.max(0, state.cursor.row - 1);
			clampCol(state);
			break;
		case "down":
			state.cursor.row = Math.min(state.cursor.row + 1, state.lines.length - 1);
			clampCol(state);
			break;
		case "home":
			state.cursor.col = 0;
			break;
		case "end":
			state.cursor.col = state.lines[state.cursor.row].length;
			break;
		default:
			// 可打印字符：插入光标处
			if (typeof key === "string" && key.length === 1 && key.charCodeAt(0) >= 32) {
				const line = state.lines[state.cursor.row];
				state.lines[state.cursor.row] = line.slice(0, state.cursor.col) + key + line.slice(state.cursor.col);
				state.cursor.col += 1;
			}
			break;
	}
	return { state, action: "none" };
}

function commandKey(prev, key) {
	let state = clone(prev);
	switch (key) {
		case "escape":
			return { state: clone(prev, { mode: MODES.NORMAL, command: "" }), action: "cancel-command" };
		case "enter":
			return { state: clone(prev, { mode: MODES.NORMAL }), action: "run-command", command: state.command };
		case "backspace":
			state.command = state.command.slice(0, -1);
			break;
		default:
			if (typeof key === "string" && key.length === 1 && key.charCodeAt(0) >= 32) {
				state.command += key;
			}
			break;
	}
	return { state, action: "none" };
}
