// lib/mention.js — 输入补全意图识别（OpenCode 心智，纯函数、零依赖、可单测）。
// 参考 opencode-ts-tui-reference：`@` 文件 / `#` 行范围 / `!` shell / `/` 命令。
// 这里只做「把输入识别成哪种意图 + 解析文件/行范围 + 生成 @ 候选」，fs 读取留在 UI 边界。

/** 识别输入意图。
 * @param {string} text - 当前输入框内容（未提交）。
 * @returns {{ kind: "shell"|"mention"|"slash"|"text", rest: string, mentionFile?: string }}
 *   - shell   : `!cmd` → 把 cmd 作为 shell/host 命令执行
 *   - mention : 含 `@file` → 文件引用（可能带 `#行范围`）
 *   - slash   : `/name` → 斜杠命令
 *   - text    : 普通对话
 */
export function detectIntent(text) {
	if (typeof text !== "string") return { kind: "text", rest: "" };
	if (text.startsWith("!")) {
		return { kind: "shell", rest: text.slice(1) };
	}
	if (text.startsWith("/")) {
		return { kind: "slash", rest: text.slice(1) };
	}
	// 只识别「行首 @」开头的文件引用（避免句中误判，如邮箱/提及）。
	if (text.startsWith("@")) {
		return { kind: "mention", rest: text.slice(1) };
	}
	return { kind: "text", rest: text };
}

/**
 * 解析 `@file.ts#10-20` 行范围引用。
 * @param {string} mention - `@` 之后的部分（可含路径 + `#start-end`）。
 * @returns {{ file: string, start: number|null, end: number|null }|null}
 *   `#10-20` → { start:10, end:20 }；`#10` → { start:10, end:10 }；无 `#` → { start:null, end:null }。
 */
export function parseLineRange(mention) {
	if (typeof mention !== "string" || !mention) return null;
	const hashIdx = mention.indexOf("#");
	if (hashIdx === -1) {
		return { file: mention, start: null, end: null };
	}
	const file = mention.slice(0, hashIdx);
	const range = mention.slice(hashIdx + 1);
	const m = range.trim().match(/^(\d+)(?:-(\d+))?$/);
	if (!m) return { file: file || null, start: null, end: null };
	const start = Number(m[1]);
	const end = m[2] ? Number(m[2]) : start;
	return { file: file || null, start, end };
}

/**
 * 为「@」文件引用生成本文件列表的候选（用于内联补全面板）。
 * 按前缀过滤 + 基名模糊排序；fileName 排序按是否前缀命中优先于包含命中。
 * @param {string} mentionSoFar - 当前 `@` 后已输入的部分。
 * @param {string[]} files - 目录内的相对文件名（不含 @）。
 * @param {number} [limit=8]
 * @returns {Array<{ file: string, score: number }>} 按分数降序的候选。
 */
export function buildMentionCandidates(mentionSoFar, files = [], limit = 8) {
	if (typeof mentionSoFar !== "string") return [];
	const q = mentionSoFar.toLowerCase();
	if (!Array.isArray(files)) return [];
	const scored = files
		.filter((f) => typeof f === "string" && f.length > 0)
		.map((f) => {
			const base = f.split(/[\\/]/).pop().toLowerCase();
			const full = f.toLowerCase();
			let score = 0;
			if (q === "") score = 1; // 空输入列出全部
			else if (base.startsWith(q)) score = 3;
			else if (full.startsWith(q)) score = 2;
			else if (base.includes(q)) score = 1;
			else return null;
			return { file: f, score };
		})
		.filter(Boolean)
		.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
	return scored.slice(0, limit);
}

/** 把候选渲染成一行（OpenCode 风格）：`@file.ts`（空选中态由 UI 处理）。 */
export function mentionDisplay(c) {
	return `@${c.file}`;
}
