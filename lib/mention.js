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
 * 升级（对标 pi-tui file-autocomplete）：
 *  - 若 query 含 `/`：当作目录内查询，只列该目录（尾带 `/` 下钻语义），不做全树匹配。
 *  - 分级打分：完整文件名=1000 > 基名前缀=900 > 全文前缀=800 > 基名包含=700 > 全文包含=500 >
 *    子序列匹配=300(带 gap 分数)。目录 +20。排序：分 → 目录优先 → 路径长度 → 字典序。
 * @param {string} mentionSoFar - 当前 `@` 后已输入的部分（可含路径 或 `@"..."` quoted 变体）。
 * @param {string[]} files - 目录内的相对文件名（不含 @）。
 * @param {number} [limit=8]
 * @returns {Array<{ file: string, score: number, isDir?: boolean }>} 按分数降序的候选。
 */
export function buildMentionCandidates(mentionSoFar, files = [], limit = 8) {
	const { q } = parseMentionQuery(mentionSoFar);
	if (!Array.isArray(files)) return [];
	// 目录内查询：query 含 `/` 时只匹配该目录前缀（下钻）。
	const hasPath = q.includes("/");
	const scored = files
		.filter((f) => typeof f === "string" && f.length > 0)
		.map((f) => {
			const lower = f.toLowerCase();
			// 目录内查询：必须位于该目录前缀下
			if (hasPath && !lower.startsWith(q)) return null;
			const base = f.split(/[\\/]/).pop().toLowerCase();
			const score = scoreCandidate(base, lower, q);
			if (score <= 0) return null;
			return { file: f, score, isDir: f.endsWith("/") };
		})
		.filter(Boolean)
		.sort((a, b) => b.score - a.score || (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0) || a.file.length - b.file.length || a.file.localeCompare(b.file));
	return scored.slice(0, limit);
}

/** 纯打分：base 是基名、full 是完整路径（均 toLowerCase），q 是小写 query。 */
function scoreCandidate(base, full, q) {
	if (q === "") return 1;
	if (base === q) return 1000;
	if (base.startsWith(q)) return 900;
	if (full.startsWith(q)) return 800;
	if (base.includes(q)) return 700;
	if (full.includes(q)) return 500;
	const sub = subsequenceScore(base, q);
	return sub > 0 ? 300 + sub : 0;
}

/** 子序列匹配：q 的字符按序出现在 s 中 → 返回 gap 分（小 gap 高分），否则 0。 */
function subsequenceScore(s, q) {
	if (!s || !q || q.length > s.length) return 0;
	let i = 0;
	let gap = 0;
	for (const ch of q) {
		const found = s.indexOf(ch, i);
		if (found === -1) return 0;
		gap += found - i;
		i = found + 1;
	}
	return Math.max(1, 100 - gap);
}

/** 解析 mention 输入，支持 `@"path with spaces"` quoted 变体 → 返回 { q, quoted }。 */
export function parseMentionQuery(mentionSoFar) {
	const raw = typeof mentionSoFar === "string" ? mentionSoFar : "";
	if (raw.startsWith('"')) {
		const close = raw.indexOf('"', 1);
		return close === -1
			? { q: raw.slice(1).toLowerCase(), quoted: true }
			: { q: raw.slice(1, close).toLowerCase(), quoted: true };
	}
	return { q: raw.toLowerCase(), quoted: false };
}

/** 生成文件引用文本（整 token 替换语义）；含空格时自动 quoted：`@"path"`。 */
export function mentionRef(file) {
	if (typeof file !== "string" || file === "") return "";
	if (/\s/.test(file) || /["\\]/.test(file)) return `@"${file}"`;
	return `@${file}`;
}

/** 把候选渲染成一行（OpenCode 风格）：`@file.ts`（空选中态由 UI 处理）。 */
export function mentionDisplay(c) {
	return `@${c.file}`;
}
