/**
 * 工具结果 diff 可视化（Claude Code /diff、Codex tool output）。
 *
 * 从 tool/result 的 meta.diff 或 content 里抽出统一 diff 文本，
 * 折叠成带 +/−/上下文 标记的行列表，UI 据此渲染彩色 diff。
 * 纯函数、可单测；不依赖具体 diff 格式的严格完整解析（容错）。
 */

/** 从任意 diff 形状抽「行数组」。支持：字符串(按行)、对象{text}|{patch}、数组。 */
export function diffLinesFrom(meta) {
	if (!meta) return [];
	if (typeof meta === "string") return meta.split("\n");
	if (Array.isArray(meta)) return meta.map((l) => (typeof l === "string" ? l : String(l)));
	if (typeof meta === "object") {
		const candidate = meta.diff || meta.patch || meta.text || meta.content;
		if (typeof candidate === "string") return candidate.split("\n");
		if (Array.isArray(candidate)) return candidate.map((l) => (typeof l === "string" ? l : String(l)));
	}
	return [];
}

/**
 * 把 diff 文本标记归类。
 * @param {string[]} lines - diff 原始行。
 * @returns {Array<{tag:'add'|'del'|'ctx'|'meta', text:string}>} 渲染用行。
 */
export function classifyDiffLines(lines) {
	return lines.map((line) => {
		if (line.startsWith("+") && !line.startsWith("+++")) return { tag: "add", text: line };
		if (line.startsWith("-") && !line.startsWith("---")) return { tag: "del", text: line };
		if (line.startsWith("@@")) return { tag: "meta", text: line };
		if (line.startsWith("+++") || line.startsWith("---")) return { tag: "meta", text: line };
		return { tag: "ctx", text: line };
	});
}

/** 提取一块 diff 中的增删统计（供工具卡片徽标用，如 +2/-1）。 */
export function diffStats(lines) {
	let add = 0;
	let del = 0;
	for (const line of lines) {
		if (line.startsWith("+") && !line.startsWith("+++")) add++;
		else if (line.startsWith("-") && !line.startsWith("---")) del++;
	}
	return { add, del };
}

/** 把分类后的 diff 行渲染成单行字符串候选（用于工具卡片折叠展示）。 */
export function diffSummary(stats) {
	return `+${stats.add}/-${stats.del}`;
}
