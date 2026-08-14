// lib/usage.js — token 用量去重汇总（纯函数、零依赖、可单测）。
// 防同一 assistant 消息的 usage 因事件重复/重放被重复累加（对标 pi-tui tokens.ts turn:step 去重；
// 我们用消息 seq 作为天然去重键，因为 fold/merge 已按 seq 保证唯一）。
// 供 HUD 上下文压力/成本计算前先去重，避免高估。

export function usageZero() {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

/**
 * 按消息 seq 去重后累加 usage。
 * @param {Array<{ seq?: number, usage?: object, text?: string }>} messages
 * @returns {{ input, output, cacheRead, cacheWrite }}
 */
export function dedupeUsage(messages = []) {
	const seen = new Set();
	const total = usageZero();
	for (const m of messages || []) {
		if (!m || !m.usage) continue;
		// 用 seq 做去重键；无 seq 时退回用「文本 + role」粗去重，避免漏计。
		const key = typeof m.seq === "number" ? `s${m.seq}` : `t${String(m.text ?? "").length}-${m.role ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		total.input += m.usage.inputTokens ?? 0;
		total.output += m.usage.outputTokens ?? 0;
		total.cacheRead += m.usage.cacheReadTokens ?? 0;
		total.cacheWrite += m.usage.cacheWriteTokens ?? 0;
	}
	return total;
}

/** 是否真正有 token 用量（供 UI 判断是否显示 cost/token）。 */
export function hasAnyUsage(u) {
	return !!u && ((u.input ?? 0) > 0 || (u.output ?? 0) > 0 || (u.cacheRead ?? 0) > 0);
}
