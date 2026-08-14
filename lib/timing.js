// lib/timing.js — 回合/步骤计时增量累加器（纯函数、零依赖、可单测）。
// 对标 pi-tui chat/timing.ts 的 StepTimingTracker：用「一次前向扫描 + 共享游标」累加，
// 使整个会话计时是 O(events) 而非 O(step × events)，避免逐 step 回放二次方退化。
// 纯状态机：喂事件，累加成桶（thinking / responding / tools），供 UI 展示 `Thinking 2.1s · …`。

export function createTimingAccumulator() {
	return { scanned: 0, buckets: { thinking: 0, responding: 0, tools: 0 }, active: null };
}

/**
 * 前向推进计时：从上次扫描点继续处理事件（append-only，共享游标）。
 * 只回调「事件相位」：调用方把每个事件映射为 phase（thinking|responding|tools）或 null。
 * @param {object} acc - createTimingAccumulator() 的返回值（就地修改）。
 * @param {Array<{ phase: string|null, at: number }>} events - 有序事件，按时间排序。
 */
export function advanceTiming(acc, events) {
	const b = acc.buckets;
	while (acc.scanned < events.length) {
		const ev = events[acc.scanned];
		acc.scanned += 1;
		if (!ev || !Number.isFinite(ev.at)) continue;
		// 关上一个相位：把 (lastPhaseStart → ev.at) 计入对应桶
		if (acc.active) {
			const elapsed = Math.max(0, ev.at - acc.active.start);
			b[acc.active.phase] = (b[acc.active.phase] ?? 0) + elapsed;
		}
		acc.active = ev.phase ? { phase: ev.phase, start: ev.at } : null;
	}
	return acc.buckets;
}

/** 把某个 phase 的累计时长格式化成 `2m03.4s` / `1.5s`（100ms 分辨率）。 */
export function formatDurationMs(ms) {
	if (!Number.isFinite(ms) || ms <= 0) return null;
	const totalMs = Math.round(ms / 100) * 100;
	const s = totalMs / 1000;
	if (s < 60) return `${(s).toFixed(1)}s`;
	const m = Math.floor(s / 60);
	const rs = s - m * 60;
	return `${m}m${rs.toFixed(1).padStart(4, "0")}s`;
}

/** 生成一行「Thinking/Response」计时摘要（只显示 >0 的桶）。 */
export function timingSummary(buckets) {
	const parts = [];
	if ((buckets.thinking ?? 0) > 0) parts.push(`Thinking ${formatDurationMs(buckets.thinking)}`);
	if ((buckets.responding ?? 0) > 0) parts.push(`Response ${formatDurationMs(buckets.responding)}`);
	if ((buckets.tools ?? 0) > 0) parts.push(`Tools ${formatDurationMs(buckets.tools)}`);
	return parts.join(" · ");
}
