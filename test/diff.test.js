// 单元飞轮：工具结果 diff 可视化——抽取/分类/统计。
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLinesFrom, classifyDiffLines, diffStats, diffSummary, guardDiff } from "../lib/diff.js";

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

test("guardDiff：预算内 ok；超行数/超增删降级", () => {
	assert.deepEqual(guardDiff(DIFF), { ok: true, add: 1, del: 1 });
	// 超行数
	const manyLines = Array.from({ length: 250 }, (_, i) => (i % 2 ? `+${i}` : `-${i}`));
	const gl = guardDiff(manyLines, { maxLines: 200 });
	assert.equal(gl.ok, false);
	assert.equal(gl.reason, "too_many_lines");
	// 超增删总数（编辑距离代理）：提高 maxLines 上限，单独测 change-count
	const stamp = (n) => Array.from({ length: n }, (_, i) => (i % 2 ? `+x${i}` : `-x${i}`));
	const gc = guardDiff(stamp(1200), { maxLines: 5000, maxAddDel: 1000 });
	assert.equal(gc.ok, false);
	assert.equal(gc.reason, "too_many_changes");
	// 空安全
	assert.deepEqual(guardDiff([]), { ok: true, add: 0, del: 0 });
});
