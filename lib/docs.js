// lib/docs.js — 项目内置文档计数（纯函数，零依赖）
// Claude Code HUD 会显示 "1 CLAUDE.md"（加载的内置指令文档数量）。
// 这里把「哪些文件名算项目文档」定义为纯规则，fs 读取留在调用边界，
// 保证 core 可单测、可供 VSCode 复用。
// 注意：统计命名与 Claude Code 一致（CLAUDE.md），同时兼容 AGENTS.md（Codex 约定）。

export const DOC_NAMES = ["CLAUDE.md", "AGENTS.md", "claude.md", "agents.md"];

/**
 * 从文件名列表统计内置项目文档数量。
 * @param {string[]} filenames - 目录下的文件名（只读，不包含路径分隔符）。
 * @returns {number} 命中的文档数。
 */
export function countProjectDocs(filenames = []) {
	if (!Array.isArray(filenames)) return 0;
	const set = new Set(DOC_NAMES.map((n) => n.toLowerCase()));
	return filenames.filter((f) => typeof f === "string" && set.has(f.toLowerCase())).length;
}

/**
 * 汇总一条 HUD 用的文档显示（"2 docs" / "1 CLAUDE.md" / 空则 ""）。
 * @param {string[]} filenames
 * @returns {string} 要拼进 HUD 的片段（含空串）。
 */
export function projectDocsLabel(filenames = []) {
	const n = countProjectDocs(filenames);
	if (n <= 0) return "";
	const hasClaude = (filenames || []).some((f) => { const l = String(f).toLowerCase(); return l === "claude.md" || l === "agents.md"; });
	return hasClaude ? `${n} docs` : `${n} docs`;
}
