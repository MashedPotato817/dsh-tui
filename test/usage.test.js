// 单元飞轮：token 用量去重汇总 dedupeUsage。
import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeUsage, hasAnyUsage, usageZero } from "../lib/usage.js";

test("dedupeUsage：按 seq 去重，重复消息不同一 usage 累加两次", () => {
	const msgs = [
		{ seq: 5, role: "assistant", usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 0 } },
		{ seq: 5, role: "assistant", usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 0 } }, // 同 seq 重复
		{ seq: 6, role: "user", text: "hi" },
		{ seq: 7, role: "assistant", usage: { inputTokens: 50, outputTokens: 5 } }
	];
	const u = dedupeUsage(msgs);
	assert.deepEqual(u, { input: 150, output: 25, cacheRead: 10, cacheWrite: 0 }, "同 seq 只计一次");
});

test("dedupeUsage：无 usage 的消息跳过；空安全", () => {
	assert.deepEqual(dedupeUsage([]), usageZero());
	assert.deepEqual(dedupeUsage([{ role: "user", text: "hi" }]), usageZero());
	assert.deepEqual(dedupeUsage(null), usageZero());
});

test("hasAnyUsage：有 token 才为真", () => {
	assert.equal(hasAnyUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), false);
	assert.equal(hasAnyUsage({ input: 10, output: 0 }), true);
	assert.equal(hasAnyUsage(null), false);
});
