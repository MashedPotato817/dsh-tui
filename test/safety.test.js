// 单元飞轮：终端文本安全 sanitizeControlChars / hasControlChars / safeSingleLine。
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeControlChars, hasControlChars, safeSingleLine } from "../lib/safety.js";

test("sanitizeControlChars：转义 C0 控制字符，保留可见文本", () => {
	assert.equal(sanitizeControlChars("hello"), "hello");
	// ESC 0x1b、BEL 0x07、NUL 0x00 → �
	assert.equal(sanitizeControlChars("a\x1b[31mb\x07c\x00d"), "a�[31mb�c�d");
	// 换行 \n / 回车 \r 必须保留（多行正文与代码块依赖它；0x0a/0x0d 不再被吞）
	assert.equal(sanitizeControlChars("a\nb"), "a\nb");
	assert.equal(sanitizeControlChars("a\rb"), "a\rb");
});

test("sanitizeControlChars：\\t 展开为空格，非转义空白保留", () => {
	assert.equal(sanitizeControlChars("a\tb"), "a    b");
	assert.equal(sanitizeControlChars("a b"), "a b");
});

test("hasControlChars：检测是否存在需转义字符", () => {
	assert.equal(hasControlChars("plain"), false);
	assert.equal(hasControlChars("a\x1bb"), true);
	assert.equal(hasControlChars("a\nb"), true);
	assert.equal(hasControlChars(null), false);
});

test("safeSingleLine：压成单行 + 转义控制 + 截断", () => {
	assert.equal(safeSingleLine("a\nb"), "a b");
	assert.equal(safeSingleLine("x\x1b[31my"), "x�[31my");
	assert.equal(safeSingleLine("n".repeat(200)), "n".repeat(79) + "…");
	assert.equal(safeSingleLine(""), "");
});
