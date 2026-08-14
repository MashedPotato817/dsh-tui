// 单元飞轮:终端可视行预算裁剪 viewport（长对话不顶走输入区的核心）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayWidth, wrapLines, estimateMessageRows, tailWithinBudget, messageBudget } from "../lib/viewport.js";

test("displayWidth：东亚字符宽 2、ASCII 宽 1", () => {
	assert.equal(displayWidth("abc"), 3);
	assert.equal(displayWidth("边界"), 4);
	assert.equal(displayWidth("a中b"), 4); // 1 + 2 + 1
});

test("wrapLines：按终端宽度折行，至少 1", () => {
	assert.equal(wrapLines("abc", 80), 1);
	assert.equal(wrapLines("a".repeat(160), 80), 2);
	assert.equal(wrapLines("a".repeat(240), 80), 3);
	assert.equal(wrapLines("abc", 0), 1); // 太窄至少 1
	assert.equal(wrapLines("中".repeat(100), 50), 4); // 中文宽 2
});

test("estimateMessageRows：普通消息一行，长文本按折行", () => {
	assert.equal(estimateMessageRows({ text: "hello" }, 80), 1);
	assert.equal(estimateMessageRows({ text: "a".repeat(200) }, 80), 3);
	assert.equal(estimateMessageRows({ text: "a\nb" }, 80), 2);
	assert.equal(estimateMessageRows({ text: "" }, 80), 1); // 空占位一行
});

test("tailWithinBudget：预算不足时保留最新一条；预算充足全保留", () => {
	const msgs = [
		{ text: "一" },
		{ text: "二" },
		{ text: "三" },
		{ text: "四" }
	];
	// 预算足够 → 全保留
	const all = tailWithinBudget(msgs, 100, 80);
	assert.equal(all.start, 0);
	assert.equal(all.lines, 4);
	// 预算只够 2 行 → 保留后 2 条
	const two = tailWithinBudget(msgs, 2, 80);
	assert.equal(two.start, 2);
	assert.deepEqual(msgs.slice(two.start).map((m) => m.text), ["三", "四"]);
	// 超长单条 → 至少保留最新
	const budget0 = tailWithinBudget(msgs, 0, 80);
	assert.deepEqual(msgs.slice(budget0.start).map((m) => m.text), ["四"]);
});

test("tailWithinBudget：超长 markdown 消息对行数影响", () => {
	const long = { text: "一\n".repeat(50) + "end" }; // 51 行
	const msgs = [{ text: "开头" }, long, { text: "结尾" }];
	// 预算只够 2 行 → 超长的中间消息被挤掉，只保留最新「结尾」
	const r = tailWithinBudget(msgs, 2, 80);
	assert.deepEqual(msgs.slice(r.start).map((m) => m.text), ["结尾"]);
});

test("messageBudget：固定元素扣除后 ≥1", () => {
	assert.ok(messageBudget(30, {}) >= 1);
	assert.ok(messageBudget(30, { banner: 2, hud: 1, input: 2, worked: 1, docks: 4, margin: 2 }) >= 1);
	assert.ok(messageBudget(10, { banner: 2, hud: 1, input: 2, worked: 1, docks: 4, margin: 2 }) >= 1);
});
