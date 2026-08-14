// 单元飞轮：输入补全意图识别（OpenCode `@`/`#`/`!`，纯函数）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectIntent, parseLineRange, buildMentionCandidates, parseMentionQuery, mentionRef } from "../lib/mention.js";

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

test("buildMentionCandidates：目录内查询（query 含 / 时只列该目录，下钻语义）", () => {
	const files = ["src/main.ts", "src/utils/helper.ts", "test/main.test.ts", "README.md"];
	const s = buildMentionCandidates("src/", files);
	assert.ok(s.some((c) => c.file === "src/main.ts"));
	assert.ok(!s.some((c) => c.file === "test/main.test.ts"), "目录内查询不应返回其它目录");
});

test("buildMentionCandidates：子序列匹配（字符按序、可隔 gap）", () => {
	const files = ["components/transcript.ts", "components/content.ts", "components/theme.ts"];
	// query "trn" 是 transcript 的子序列（t-r-n）
	const hs = buildMentionCandidates("trn", files);
	assert.ok(hs.some((c) => c.file.includes("transcript")), "子序列 trn 应命中 transcript");
});

test("parseMentionQuery：支持 @\"path with spaces\" quoted 变体", () => {
	assert.deepEqual(parseMentionQuery('"a b.ts"'), { q: "a b.ts", quoted: true });
	assert.deepEqual(parseMentionQuery('"未闭合'), { q: "未闭合", quoted: true });
	assert.deepEqual(parseMentionQuery("src/main.ts"), { q: "src/main.ts", quoted: false });
	assert.deepEqual(parseMentionQuery(null), { q: "", quoted: false });
});

test("mentionRef：含空格/引号自动 quoted，否则裸 @path", () => {
	assert.equal(mentionRef("src/main.ts"), "@src/main.ts");
	assert.equal(mentionRef("my file.txt"), '@"my file.txt"');
	assert.equal(mentionRef(""), "");
});
