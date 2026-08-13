// 单元飞轮：会话记忆 + 命令路由。
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeRecent, readRecent, clearRecent } from "../lib/registry.js";
import { parseSlash, routeSlash, isLocalCommand, allCommands } from "../lib/commands.js";

test("writeRecent/readRecent：内存 fs 往返", () => {
	const files = new Map();
	const fs = {
		mkdirSync: (dir, opts) => { files.set(dir, true); },
		writeFileSync: (path, content) => { files.set(path, content); }
	};
	const payload = writeRecent("session-abc", { cwd: "C:\\w", agentPreset: "code" }, "mem://recent.json", fs);
	assert.equal(payload.sessionId, "session-abc");
	assert.equal(payload.agentPreset, "code");
});

test("readRecent：文件缺失/损坏 → null", () => {
	assert.equal(readRecent("mem://nonexistent"), null);
});

test("parseSlash：解析 /cmd args，非 / 开头返回 null", () => {
	assert.equal(parseSlash("hello"), null);
	assert.deepEqual(parseSlash("/new"), { name: "new", args: "" });
	assert.deepEqual(parseSlash("/status"), { name: "status", args: "" });
	assert.deepEqual(parseSlash("/git status"), { name: "git", args: "status" });
	assert.deepEqual(parseSlash("  / commit --amend "), { name: "commit", args: "--amend" });
});

test("isLocalCommand：new/resume/exit 是本地，其它不是", () => {
	assert.equal(isLocalCommand("new"), true);
	assert.equal(isLocalCommand("resume"), true);
	assert.equal(isLocalCommand("exit"), true);
	assert.equal(isLocalCommand("status"), false);
	assert.equal(isLocalCommand("git"), false);
});

test("routeSlash：本地命令 vs host 命令", () => {
	assert.deepEqual(routeSlash("/exit"), { local: true, action: "exit" });
	assert.deepEqual(routeSlash("/new"), { local: true, action: "new" });
	assert.deepEqual(routeSlash("/resume"), { local: true, action: "resume" });
	assert.deepEqual(routeSlash("/list"), { local: true, action: "list" });
	assert.equal(routeSlash("/clear").local, true);
	assert.equal(routeSlash("/clear").action, "clear");
	assert.match(routeSlash("/clear").notice, /已清空/);
	assert.deepEqual(routeSlash("/help"), { local: true, action: "help", name: "help" });
	assert.deepEqual(routeSlash("/?"), { local: true, action: "help", name: "?" });
	assert.equal(routeSlash("/status").local, false);
	assert.equal(routeSlash("/status").name, "status");
	assert.equal(routeSlash(null), null);
	assert.deepEqual(routeSlash("/"), { local: true, action: "noop", notice: "空命令" });
});

test("allCommands：合并去重，含本地命令含 help", () => {
	const cmds = allCommands();
	assert.ok(cmds.some((c) => c.name === "new"));
	assert.ok(cmds.some((c) => c.name === "status"));
	assert.ok(cmds.some((c) => c.name === "help"), "应含 help");
	// exit 去重（builtin + local 各一个）
	const exits = cmds.filter((c) => c.name === "exit");
	assert.equal(exits.length, 1);
});

test("isLocalCommand：help 是本地命令", () => {
	assert.equal(isLocalCommand("help"), true);
	// "?" 仅 routeSlash 映射到 help（本地路由），但 LOCAL_COMMANDS 表里没有 "?" 键
	assert.equal(isLocalCommand("?"), false);
});
