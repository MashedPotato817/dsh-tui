// 单元飞轮：自定义命令加载（Claude Code 式 Markdown 命令）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, loadCustomCommands } from "../lib/command-loader.js";

function makeTmp() {
	const dir = mkdtempSync(join(tmpdir(), "dsh-tui-cmd-"));
	return dir;
}

test("parseFrontmatter：解析 key: value，无 frontmatter 返回 {}", () => {
	const meta = parseFrontmatter("---\ndescription: 测试命令\nargument-hint: <file>\nallowed-tools: write, edit\n---\n\n正文");
	assert.equal(meta.description, "测试命令");
	assert.equal(meta["argument-hint"], "<file>");
	assert.equal(meta["allowed-tools"], "write, edit");
	assert.deepEqual(parseFrontmatter("没有 frontmatter"), {});
});

test("loadCustomCommands：项目级 + 个人级发现，项目优先同名覆盖", () => {
	const root = makeTmp();
	try {
		const proj = join(root, "proj");
		const user = join(root, "home");
		mkdirSync(join(proj, ".claude", "commands"), { recursive: true });
		mkdirSync(join(user, ".claude", "commands"), { recursive: true });
		// 项目命令
		writeFileSync(join(proj, ".claude", "commands", "lint.md"), "---\ndescription: 项目 lint\n---\nrun lint");
		// 个人命令（与项目同名的，应被项目覆盖）
		writeFileSync(join(user, ".claude", "commands", "lint.md"), "---\ndescription: 个人 lint\n---\nrun user lint");
		// 个人独有命令
		writeFileSync(join(user, ".claude", "commands", "bootstrap.md"), "---\ndescription: 初始化\n---\ninit");

		const cmds = loadCustomCommands({ projectDir: proj, home: user });
		const lint = cmds.find((c) => c.name === "lint");
		const bootstrap = cmds.find((c) => c.name === "bootstrap");
		assert.ok(lint, "lint 应存在");
		assert.equal(lint.description, "项目 lint", "项目命令覆盖个人同名校");
		assert.equal(lint.source, "project", "项目命令 source 标记");
		assert.ok(bootstrap, "个人独有命令应加载");
		assert.equal(bootstrap.source, "user");
		assert.ok(lint.body.includes("lint"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("loadCustomCommands：目录不存在返回空", () => {
	const cmds = loadCustomCommands({ projectDir: join(tmpdir(), "no-such-proj-xyz"), home: join(tmpdir(), "no-home-xyz") });
	assert.deepEqual(cmds, []);
});
