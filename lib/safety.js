// lib/safety.js — 终端文本安全（纯函数、零依赖、可单测）。
// 防御模型/工具输出携带 C0/C1 控制字符（如 \x1b CSI/OSC 序列、\x07 BEL、\x00 等）
// 注入到 Ink 渲染，破坏布局或触发终端转义（pi-tui 源码里 text.ts 的 displayText 同类做法）。
// 供 MessageRow / ToolCards / streaming 等所有渲染外部文本处接入。

/** 分段：把控制字符替换为可见记号；不删除（保留长度轮廓）。C0 保留部分合理空白如 \t/\n/\r。 */
export function sanitizeControlChars(text) {
	if (typeof text !== "string") return "";
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code === 0x09) { // \t → 空格，避免折叠错位
			out += "    ";
			continue;
		}
		if (code === 0x0a || code === 0x0d) { // \n / \r → 保留换行（多行正文/代码块依赖它）
			out += text[i];
			continue;
		}
		// C0：0x00-0x1F（除已保留的 \t\n\r）；C1：0x80-0x9F
		if (code >= 0x00 && code < 0x20 || code >= 0x7f && code < 0xa0) {
			out += "�";
			continue;
		}
		out += text[i];
	}
	return out;
}

/** 是否包含任何需要转义的控制字符（供调用方判断是否需要 sanitize）。 */
export function hasControlChars(text) {
	if (typeof text !== "string") return false;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c < 0x20 || c >= 0x7f && c < 0xa0) return true;
	}
	return false;
}

/** 把一段文本压成一个「可用于单行摘要」的安全单行（去掉换行/控制）。 */
export function safeSingleLine(text, max = 80) {
	const one = String(text ?? "").replace(/[\n\r]+/g, " ").trim();
	const s = sanitizeControlChars(one);
	return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
