// 单元飞轮：回合步骤计时增量累加（共享游标 O(events)，防二次方退化）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTimingAccumulator, advanceTiming, formatDurationMs, timingSummary } from "../lib/timing.js";

test("advanceTiming：共享游标——一次喂全量后游标到末尾，再喂不重复累计", () => {
	const acc = createTimingAccumulator();
	const events = [
		{ phase: "thinking", at: 1000 },
		{ phase: "responding", at: 3000 }, // thinking 2s
		{ phase: "tools", at: 4000 },      // responding 1s
		{ phase: null, at: 5000 }          // tools 1s
	];
	advanceTiming(acc, events);
	assert.equal(acc.scanned, events.length);
	assert.equal(acc.buckets.thinking, 2000);
	assert.equal(acc.buckets.responding, 1000);
	assert.equal(acc.buckets.tools, 1000);
	// 再喂同样数组：共享游标已到末尾，不重复累加（append-only 幂等）
	advanceTiming(acc, events);
	assert.equal(acc.scanned, events.length);
	assert.equal(acc.buckets.thinking, 2000);
	assert.equal(acc.buckets.responding, 1000);
	assert.equal(acc.buckets.tools, 1000);
});

test("advanceTiming：同相位多次喂不会重复累加（事件本身 append-only）", () => {
	const acc = createTimingAccumulator();
	const evs = [{ phase: "thinking", at: 1000 }, { phase: null, at: 2000 }];
	advanceTiming(acc, evs);
	assert.equal(acc.buckets.thinking, 1000);
	advanceTiming(acc, evs); // 再喂同样（游标已到 2，不重复）
	assert.equal(acc.buckets.thinking, 1000);
});

test("formatDurationMs：100ms 分辨率 + 分/秒", () => {
	assert.equal(formatDurationMs(1500), "1.5s");
	assert.equal(formatDurationMs(2000), "2.0s");
	assert.equal(formatDurationMs(123000), "2m03.0s");
	assert.equal(formatDurationMs(0), null);
	assert.equal(formatDurationMs(-5), null);
});

test("timingSummary：只显示 >0 的桶", () => {
	assert.equal(timingSummary({ thinking: 1500, responding: 0, tools: 2000 }), "Thinking 1.5s · Tools 2.0s");
	assert.equal(timingSummary({ thinking: 0, responding: 0, tools: 0 }), "");
});
