// 单元飞轮：补全意图识别（前缀区分：/ 命令、@ 文件、! shell、其余 text）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectIntent, parseLineRange, mentionRef } from "../lib/mention.js";

test("detectIntent：/ @ ! 前缀区分，其余归 text", () => {
	assert.deepEqual(detectIntent("/model"), { kind: "slash", rest: "model" });
	assert.deepEqual(detectIntent("/status --json"), { kind: "slash", rest: "status --json" });
	assert.deepEqual(detectIntent("@src/app.js"), { kind: "mention", rest: "src/app.js" });
	assert.deepEqual(detectIntent("!git status"), { kind: "shell", rest: "git status" });
	// 非行首触发不误判（如邮箱、行中提及）
	assert.deepEqual(detectIntent("foo@bar.com"), { kind: "text", rest: "foo@bar.com" });
	// 『:』不以任何聊天前缀触发：归 text，rest 为原样全文（不裁剪）
	assert.deepEqual(detectIntent(":w"), { kind: "text", rest: ":w" });
});

test("detectIntent：非字符串或空输入兜底", () => {
	assert.equal(detectIntent("").kind, "text");
	assert.equal(detectIntent(undefined).kind, "text");
});

test("parseLineRange：@file#line-range 解析", () => {
	assert.deepEqual(parseLineRange("src/a.js#10-20"), { file: "src/a.js", start: 10, end: 20 });
	assert.deepEqual(parseLineRange("src/a.js#10"), { file: "src/a.js", start: 10, end: 10 });
	assert.deepEqual(parseLineRange("src/a.js"), { file: "src/a.js", start: null, end: null });
	assert.equal(parseLineRange(""), null);
	assert.equal(parseLineRange(null), null);
});

test("mentionRef：引号包裹含空格路径，无空格则直接 @ 前缀", () => {
	assert.equal(mentionRef("a b.ts"), '@"a b.ts"');
	assert.equal(mentionRef("a.ts"), "@a.ts");
	assert.equal(mentionRef(""), "");
});
