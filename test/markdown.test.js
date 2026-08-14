// 单元飞轮：轻量 Markdown 结构解析（code block / 标题 / 列表 / diff / inline 粗体+code）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, inlineFragments } from "../lib/markdown.js";

test("parseMarkdown：代码块提取 lang + content", () => {
	const blocks = parseMarkdown("前文\n```js\nconst a = 1;\n```\n后文");
	assert.equal(blocks[0].type, "text");
	assert.equal(blocks[1].type, "code");
	assert.equal(blocks[1].lang, "js");
	assert.equal(blocks[1].content, "const a = 1;");
});

test("parseMarkdown：标题层级", () => {
	const [h2] = parseMarkdown("## 标题");
	assert.equal(h2.type, "heading");
	assert.equal(h2.level, 2);
	assert.equal(h2.content, "标题");
});

test("parseMarkdown：无序/有序列表各自收集项", () => {
	const [ul] = parseMarkdown("- a\n- b\n");
	assert.equal(ul.type, "list");
	assert.equal(ul.ordered, false);
	assert.deepEqual(ul.items, ["a", "b"]);

	const [ol] = parseMarkdown("1. 一\n2. 二");
	assert.equal(ol.ordered, true);
	assert.deepEqual(ol.items, ["一", "二"]);
});

test("parseMarkdown：diff 行合并成 diff 块", () => {
	const blocks = parseMarkdown("-old line\n+new line\n@@ -2 +2 @@");
	const diff = blocks.find((b) => b.type === "diff");
	assert.ok(diff, "应有 diff 块");
	assert.ok(diff.content.includes("-old line"));
	assert.ok(diff.content.includes("+new line"));
});

test("inlineFragments：粗体与 inline code 拆分", () => {
	const frags = inlineFragments("用 **brittle** 和 `code` 测试");
	assert.equal(frags[0].kind, "text");
	assert.equal(frags[1].kind, "bold");
	assert.equal(frags[1].content, "brittle");
	assert.equal(frags[2].kind, "text");
	assert.equal(frags[3].kind, "code");
	assert.equal(frags[3].content, "code");
});

test("parseMarkdown：普通段落合并", () => {
	const [p] = parseMarkdown("第一行\n第二行");
	assert.equal(p.type, "text");
	assert.equal(p.content, "第一行\n第二行");
});
