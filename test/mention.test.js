// 单元飞轮：输入补全意图识别（OpenCode `@`/`#`/`!`，纯函数）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectIntent, parseLineRange, buildMentionCandidates } from "../lib/mention.js";

test("detectIntent：区分 shell / mention / slash / text", () => {
	assert.deepEqual(detectIntent("!ls -la"), { kind: "shell", rest: "ls -la" });
	assert.deepEqual(detectIntent("!dir"), { kind: "shell", rest: "dir" });
	assert.deepEqual(detectIntent("@src/main.ts"), { kind: "mention", rest: "src/main.ts" });
	assert.deepEqual(detectIntent("/resume"), { kind: "slash", rest: "resume" });
	assert.deepEqual(detectIntent("帮我看看"), { kind: "text", rest: "帮我看看" });
	assert.deepEqual(detectIntent(""), { kind: "text", rest: "" });
	assert.deepEqual(detectIntent(null), { kind: "text", rest: "" });
	// 单词中途的 @ 不算 mention（如 "email@x.com"）
	assert.deepEqual(detectIntent("邮箱 a@b.com"), { kind: "text", rest: "邮箱 a@b.com" });
});

test("parseLineRange：解析 @file#start-end 与裸 @file", () => {
	assert.deepEqual(parseLineRange("src/a.ts#10-20"), { file: "src/a.ts", start: 10, end: 20 });
	assert.deepEqual(parseLineRange("src/a.ts#10"), { file: "src/a.ts", start: 10, end: 10 });
	assert.deepEqual(parseLineRange("src/a.ts"), { file: "src/a.ts", start: null, end: null });
	assert.deepEqual(parseLineRange("a.ts#x"), { file: "a.ts", start: null, end: null });
	assert.deepEqual(parseLineRange(""), null);
	assert.deepEqual(parseLineRange(null), null);
});

test("buildMentionCandidates：前缀/基名/包含排序 + 空输入全列", () => {
	const files = ["src/main.ts", "src/utils/helper.ts", "README.md", "test/main.test.ts", "package.json"];
	// 空输入 → 全部（按字母）
	assert.equal(buildMentionCandidates("", files).length, 5);
	// 前缀命中基名 "main" 优先
	const cands = buildMentionCandidates("main", files);
	assert.equal(cands.length, 2); // src/main.ts 与 test/main.test.ts
	assert.equal(cands[0].file, "src/main.ts", "基名前缀命中优先");
	// 子路径前缀命中也参与
	const sub = buildMentionCandidates("src/", files);
	assert.ok(sub.some((c) => c.file === "src/main.ts"));
	// limit 生效
	assert.equal(buildMentionCandidates("", files, 2).length, 2);
	// 无命中
	assert.equal(buildMentionCandidates("zzz", files).length, 0);
	// 非数组安全
	assert.equal(buildMentionCandidates("a", null).length, 0);
});
