// 单元飞轮：项目内置文档计数（Claude Code "1 CLAUDE.md" / Codex AGENTS.md）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { countProjectDocs, projectDocsLabel, DOC_NAMES } from "../lib/docs.js";

test("countProjectDocs：识别 CLAUDE.md / AGENTS.md（大小写不敏感）", () => {
	assert.equal(countProjectDocs(["CLAUDE.md", "src/main.js"]), 1);
	assert.equal(countProjectDocs(["AGENTS.md", "claude.md", "README.md", "agents.md"]), 3);
	assert.equal(countProjectDocs([]), 0);
	assert.equal(countProjectDocs(["README.md", "src/a.ts"]), 0);
	// 非数组安全
	assert.equal(countProjectDocs(null), 0);
	assert.equal(countProjectDocs(undefined), 0);
});

test("DOC_NAMES 默认清单包含 Claude 与 Codex 约定", () => {
	assert.ok(DOC_NAMES.includes("CLAUDE.md"));
	assert.ok(DOC_NAMES.includes("AGENTS.md"));
});

test("projectDocsLabel：0 空串，>0 显示 docs 计数", () => {
	assert.equal(projectDocsLabel(["README.md"]), "");
	assert.equal(projectDocsLabel(["CLAUDE.md"]), "1 docs");
	assert.equal(projectDocsLabel(["CLAUDE.md", "AGENTS.md"]), "2 docs");
});
