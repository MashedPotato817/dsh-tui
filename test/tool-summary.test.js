// 单元飞轮：工具一行摘要 toolSummary（标签/参数折叠，对标 Claude Code 单行）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolSummary } from "../lib/tool-summary.js";

test("toolSummary：read/write 取 file_path/path，不暴露原始 JSON", () => {
	assert.equal(toolSummary({ name: "write", args: '{"file_path":"ui/components.js","content":"..."}' }), "write ui/components.js");
	assert.equal(toolSummary({ name: "read", args: '{"path":"lib/fold.js"}' }), "read lib/fold.js");
	assert.equal(toolSummary({ name: "edit", args: '{"file_path":"a.ts","old_string":"x"}' }), "edit a.ts");
});

test("toolSummary：run_code/pwsh 取 command 摘要", () => {
	assert.equal(toolSummary({ name: "run_code", args: '{"code":"1+1","description":"x"}' }), "run_code 1+1");
	assert.equal(toolSummary({ name: "pwsh", args: '{"command":"Get-ChildItem"}' }), "pwsh Get-ChildItem");
});

test("toolSummary：glob/grep 取 pattern/query", () => {
	assert.equal(toolSummary({ name: "glob", args: '{"pattern":"**/*.js"}' }), "glob **/*.js");
	assert.equal(toolSummary({ name: "grep", args: '{"query":"version"}' }), "grep version");
});

test("toolSummary：带行范围 #10-20", () => {
	assert.equal(toolSummary({ name: "read", args: '{"path":"a.ts","start":10,"end":20,"out":0}' }), "read a.ts#10-20");
});

test("toolSummary：无字段/解析失败 → 名称+截断原始参数", () => {
	assert.equal(toolSummary({ name: "foo", args: '{"unknown":1}' }), "foo {\"unknown\":1}");
	assert.equal(toolSummary({ name: "bar", args: null }), "bar");
	// 超长截断
	const long = toolSummary({ name: "x", args: '{"file_path":"very-long-'.padEnd(200, "p") + '"}' });
	assert.ok(long.length <= 90, "应截断: " + long.length);
});
