// lib/tool-summary.js — 把工具参数折叠成一行“摘要”（纯函数、零依赖、可单测）。
// 对标 Claude Code：工具只显示一行结果（`✓ read ui/components.js`），不暴露大段 JSON。
// args 是工具调用的 arguments 字符串（JSON）；这里按工具语义提取「人类可读的一行」，
// 找不到则截断成固定长度。核心判据：哪种工具显示什么。

const DEFAULT_LIMIT = 60;

/** 尝试把 args 字符串解析成对象（容错：失败返回 null）。 */
function parseArgs(args) {
	if (typeof args !== "string" || !args.trim()) return null;
	try {
		const parsed = JSON.parse(args);
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * 生成工具一行摘要。
 * @param {object} tool - { name: string, args?: string, status: "running"|"done"|"error" }。
 * @param {number} [limit=60]
 * @returns {string} 单行人类可读摘要（如 `run_code …` / `write file.txt`）。
 */
export function toolSummary(tool, limit = DEFAULT_LIMIT) {
	const name = (tool && tool.name) || "";
	const args = tool && tool.args;
	const obj = parseArgs(args);

	if (obj) {
		// 各工具取最关键字段
		const key =
			obj.file_path ??
			obj.path ??
			obj.filename ??
			obj.pattern ??
			obj.query ??
			(obj.command && String(obj.command).slice(0, 40)) ??
			(obj.code && String(obj.code).slice(0, 40)) ??
			obj.url ??
			obj.title ??
			(obj.toolCallId ? `(${String(obj.toolCallId).slice(0, 8)})` : null);
		if (key !== null && key !== undefined) {
			const suffix = obj.line ? `#${obj.line}` : obj.start !== undefined && obj.end !== undefined ? `#${obj.start}-${obj.end}` : "";
			const s = `${name} ${String(key).slice(0, limit)}${suffix}`;
			return truncate(s, limit + 24);
		}
	}

	// 解析失败或无字段：名称 + 截断的原始参数（防 JSON 轰炸）
	if (args && args.trim()) {
		const flat = args.replace(/\s+/g, " ").trim();
		return truncate(`${name} ${flat}`, limit + 24);
	}
	return name;
}

function truncate(s, max) {
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + "…";
}
