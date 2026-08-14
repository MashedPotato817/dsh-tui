// lib/markdown.js — 轻量 Markdown 折行/结构解析（纯函数、零依赖、可单测）。
// 对标 Claude Code：让 assistant 正文里的 **粗体**、`inline code`、列表、代码块、
// 标题有清晰层级，而不是直接显示原始标记。这里只做「结构解析」，颜色/缩进由 UI 层消费。
// 只支持成熟 CLI 里最常见的一小面子集，未知一律按普通文本——宁缺毋滥。

export function parseMarkdown(text) {
	const blocks = [];
	const lines = String(text ?? "").split("\n");
	let i = 0;

	const pushText = (line) => {
		const last = blocks[blocks.length - 1];
		if (last && last.type === "text") last.content += (last.content ? "\n" : "") + line;
		else if (line.trim()) blocks.push({ type: "text", content: line });
	};

	while (i < lines.length) {
		const line = lines[i];

		// 代码块 ```lang ... ```
		if (/^\s*```/.test(line)) {
			const lang = line.replace(/^\s*```/, "").trim();
			const buf = [];
			i += 1;
			while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
			blocks.push({ type: "code", lang, content: buf.join("\n") });
			i += 1; // 跳过结束 ```
			continue;
		}

		// 引用 > ...（合并连续引用行为一整段，可选；这里简单归入 text 保留 > 前的语义）
		// 标题 ## / # / ###
		const heading = line.match(/^(#{1,4})\s+(.*)$/);
		if (heading) {
			if (line.trim()) blocks.push({ type: "heading", level: heading[1].length, content: heading[2] });
			i += 1;
			continue;
		}

		// 无序列表 - / * / •
		const ul = line.match(/^\s*[-*•]\s+(.*)$/);
		if (ul) {
			blocks.push({ type: "list", ordered: false, items: [], _slot: true });
			// 收集连续列表项
			while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
				blocks[blocks.length - 1].items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
				i += 1;
			}
			continue;
		}

		// 有序列表 1. / 1)
		const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
		if (ol) {
			blocks.push({ type: "list", ordered: true, items: [], _slot: true });
			while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
				blocks[blocks.length - 1].items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
				i += 1;
			}
			continue;
		}

		// diff 块（^[-+] 行，连续）
		if (/^[-+]\S/.test(line) || /^@/.test(line)) {
			const buf = [];
			while (i < lines.length && (/^[-+]\S/.test(lines[i]) || /^@@/.test(lines[i]) || lines[i].trim() === "")) {
				buf.push(lines[i]);
				i += 1;
			}
			if (buf.length) blocks.push({ type: "diff", content: buf.join("\n") });
			continue;
		}

		// 空行：分隔段落
		if (!line.trim()) { i += 1; continue; }

		pushText(line);
		i += 1;
	}
	// 清掉 _slot 辅助标记
	return blocks.map(({ _slot, ...rest }) => rest);
}

/**
 * 把一段可能含 **粗体** / `inline` 的单行文本拆成带标注的片段。
 * @param {string} text
 * @returns {Array<{ kind: "text"|"bold"|"code", content: string }>}
 */
export function inlineFragments(text) {
	const out = [];
	const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
	let last = 0;
	for (const m of text.matchAll(re)) {
		if (m.index > last) out.push({ kind: "text", content: text.slice(last, m.index) });
		if (m[1] && m[1].startsWith("**")) out.push({ kind: "bold", content: m[2] });
		else out.push({ kind: "code", content: m[3] });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ kind: "text", content: text.slice(last) });
	if (out.length === 0 && text) out.push({ kind: "text", content: text });
	return out;
}
