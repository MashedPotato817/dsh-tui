// 单元飞轮:终端可视行预算裁剪 viewport（长对话不顶走输入区的核心）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayWidth, wrapLines, estimateMessageRows, tailWithinBudget, messageBudget, buildLineLayout, windowViewport, splitVisualLines, sliceTextByVisualLines } from "../lib/viewport.js";

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

test("视觉行切片：无显式换行的超长段落也能从中间分页", () => {
	assert.deepEqual(splitVisualLines("abcdefghij", 4), ["abcd", "efgh", "ij"]);
	assert.equal(sliceTextByVisualLines("abcdefghij", 4, 1, 2), "efgh\nij");
	assert.deepEqual(splitVisualLines("中文中文", 4), ["中文", "中文"]);
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

test("tailWithinBudget：最新一条超过预算也不得整片消失（P0 回归）", () => {
	// 复现验收反馈：最新消息 ~58 行，预算仅 20 行，旧实现返回 { start: len, lines: 0 } 空列表。
	const long = { text: "一\n".repeat(57) + "end" }; // 58 行
	const msgs = [{ text: "用户提问" }, long];
	const r = tailWithinBudget(msgs, 20, 80);
	assert.equal(r.start, 1, "必须至少保留最新一条，start 应为最后一条下标");
	assert.ok(r.lines > 0, "lines 应 > 0");
	assert.ok(msgs.slice(r.start).length > 0, "渲染切片不得为空");
	assert.equal(msgs[r.start].text, long.text);
	// 覆盖反馈指出的缺失边界：0 < budget < 最新消息高度
	const r2 = tailWithinBudget(msgs, 1, 80); // budget=1 < 58
	assert.equal(r2.start, 1);
	assert.ok(r2.lines > 0);
});

test("messageBudget：固定元素扣除后 ≥1", () => {
	assert.ok(messageBudget(30, {}) >= 1);
	assert.ok(messageBudget(30, { banner: 2, hud: 1, input: 2, worked: 1, docks: 4, margin: 2 }) >= 1);
	assert.ok(messageBudget(10, { banner: 2, hud: 1, input: 2, worked: 1, docks: 4, margin: 2 }) >= 1);
});

test("buildLineLayout：按视觉行摊平消息块", () => {
	const msgs = [{ text: "a" }, { text: "b\nc" }, { text: "d\ne\nf" }];
	const layout = buildLineLayout(msgs, 80);
	assert.deepEqual(layout, [
		{ msgIndex: 0, lineStart: 0, lineCount: 1 },
		{ msgIndex: 1, lineStart: 1, lineCount: 2 },
		{ msgIndex: 2, lineStart: 3, lineCount: 3 }
	]);
});

test("windowViewport：贴底默认返回最新消息尾部，绝不空窗口", () => {
	const long = { text: "x\n".repeat(57) + "end" }; // 58 行
	const msgs = [{ text: "用户" }, long];
	// 预算 20、贴底 → 从最新消息的中间开始（58-20=38 行处）
	const w = windowViewport(msgs, 20, 80, 0);
	assert.equal(w.startMsg, 1, "应落到最新消息");
	assert.ok(w.startLine > 0, "单条超预算时应进入消息内部，非从头");
	// 顶部翻到最老 → 从第 0 条第 0 行开始
	const wOld = windowViewport(msgs, 20, 80, 9999);
	assert.equal(wOld.startMsg, 0);
	assert.equal(wOld.startLine, 0);
});

test("windowViewport：单条消息内可滚动（intra-message 分页）", () => {
	const long = { text: "行\n".repeat(20) }; // 21 行
	const msgs = [long];
	const bottom = windowViewport(msgs, 5, 80, 0); // 贴底 → 最后 5 行
	assert.equal(bottom.startMsg, 0);
	assert.equal(bottom.startLine, 16, "21 行里预算 5 → 起始行 16");
	const scrolled = windowViewport(msgs, 5, 80, 8); // 上翻 8 行
	assert.equal(scrolled.startMsg, 0);
	assert.ok(scrolled.startLine < bottom.startLine, "上翻后起始行变小（阅读更早内容）");
});
