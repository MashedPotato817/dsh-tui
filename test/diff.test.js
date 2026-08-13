// 单元飞轮：工具结果 diff 可视化——抽取/分类/统计。
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLinesFrom, classifyDiffLines, diffStats, diffSummary } from "../lib/diff.js";

const DIFF = [
	"--- a/src/foo.ts",
	"+++ b/src/foo.ts",
	"@@ -1,4 +1,4 @@",
	" export function foo() {",
	"-  return old;",
	"+  return new;",
	" }"
];

test("diffLinesFrom：支持字符串/对象 diff/patch/text/数组", () => {
	assert.deepEqual(diffLinesFrom(DIFF.join("\n")), DIFF);
	assert.deepEqual(diffLinesFrom({ diff: DIFF.join("\n") }), DIFF);
	assert.deepEqual(diffLinesFrom({ patch: DIFF.join("\n") }), DIFF);
	assert.deepEqual(diffLinesFrom({ text: DIFF.join("\n") }), DIFF);
	assert.deepEqual(diffLinesFrom(["a", "b"]), ["a", "b"]);
	assert.deepEqual(diffLinesFrom(null), []);
	assert.deepEqual(diffLinesFrom(undefined), []);
});

test("classifyDiffLines：add/del/ctx/meta 分类", () => {
	const cls = classifyDiffLines(DIFF);
	const tags = cls.map((c) => c.tag);
	assert.deepEqual(tags, ["meta", "meta", "meta", "ctx", "del", "add", "ctx"]);
	// meta 行的 +++/--- 不被误判为 add/del
	const addLines = cls.filter((c) => c.tag === "add");
	const delLines = cls.filter((c) => c.tag === "del");
	assert.equal(addLines[0].text, "+  return new;");
	assert.equal(delLines[0].text, "-  return old;");
});

test("diffStats：增删统计 + summary", () => {
	const stats = diffStats(DIFF);
	assert.deepEqual(stats, { add: 1, del: 1 });
	assert.equal(diffSummary(stats), "+1/-1");
});
