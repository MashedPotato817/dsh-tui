// 单元飞轮：命令历史（环形缓冲 + 上/下翻历史）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory, pushHistory, navigateHistory } from "../lib/history.js";

test("createHistory：初始为空", () => {
	const h = createHistory(3);
	assert.deepEqual(h.items, []);
	assert.equal(h.index, -1);
});

test("pushHistory：追加并重置 index，连续重复去重", () => {
	let h = createHistory();
	h = pushHistory(h, " 第一个  ");
	h = pushHistory(h, "第二个");
	h = pushHistory(h, "第二个");
	assert.deepEqual(h.items, ["第一个", "第二个"], "连续重复去重");
	assert.equal(h.index, -1);
	// 空/空白不记录
	h = pushHistory(h, "   ");
	assert.equal(h.items.length, 2, "空输入不入历史");
});

test("pushHistory：超上限丢弃最旧", () => {
	let h = createHistory(2);
	h = pushHistory(h, "a");
	h = pushHistory(h, "b");
	h = pushHistory(h, "c");
	assert.deepEqual(h.items, ["b", "c"], "超上限 shift 最旧");
});

test("navigateHistory：up 往历史深处，down 回到草稿", () => {
	let h = createHistory();
	h = pushHistory(h, "第一句话");
	h = pushHistory(h, "第二句话");

	// up 到最近（第二句）
	let r = navigateHistory(h, "up");
	assert.equal(r.text, "第二句话");
	h = r.history;
	// 再 up 到第一句
	r = navigateHistory(h, "up");
	assert.equal(r.text, "第一句话");
	h = r.history;
	// 再 up 到头 → null
	r = navigateHistory(h, "up");
	assert.equal(r.text, null);

	// down 回到草稿（从最深）
	r = navigateHistory(r.history, "down", "draft");
	assert.equal(r.text, "draft", "down 到最后回到草稿");
});

test("navigateHistory：空历史返回 null", () => {
	const h = createHistory();
	assert.deepEqual(navigateHistory(h, "up"), { history: h, text: null });
});
