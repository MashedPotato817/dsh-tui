// 单元飞轮：dsh-tui 配置——解析、默认合并、运行期映射。
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultConfig, parseConfig, loadConfig, configToRuntime } from "../lib/config.js";
import { PERMISSION_MODES } from "../lib/permission.js";

test("defaultConfig：合理默认", () => {
	const cfg = defaultConfig();
	assert.equal(cfg.approvalMode, "interactive");
	assert.equal(cfg.defaultPermissionMode, PERMISSION_MODES.MANUAL);
	assert.deepEqual(cfg.editableTools, []);
	assert.equal(cfg.allowBypassPermissions, false);
	assert.deepEqual(cfg.prices, {});
});

test("parseConfig：标量 + 嵌套 + 内联数组 + 注释", () => {
	const cfg = parseConfig(`
# 测试配置
approvalMode: auto
defaultPermissionMode: acceptEdits
editableTools: ["write", "edit"]
allowTools: ["browser_navigate"]
allowBypassPermissions: true
prices:
  deepseek-chat:
    input: 0.5
maxToolOutputLines: 3
`);
	assert.equal(cfg.approvalMode, "auto");
	assert.equal(cfg.defaultPermissionMode, "acceptEdits");
	assert.deepEqual(cfg.editableTools, ["write", "edit"]);
	assert.deepEqual(cfg.allowTools, ["browser_navigate"]);
	assert.equal(cfg.allowBypassPermissions, true);
	assert.equal(cfg.prices["deepseek-chat"].input, 0.5);
	assert.equal(cfg.maxToolOutputLines, 3);
});

test("parseConfig：空/坏输入回退默认，块状列表跳过", () => {
	assert.deepEqual(parseConfig(""), defaultConfig());
	assert.deepEqual(parseConfig("not valid yaml !!"), defaultConfig());
	const noList = parseConfig("- a\n- b\napprovalMode: interactive");
	// 块状列表被跳过，但不破坏后续键
	assert.equal(noList.approvalMode, "interactive");
});

test("loadConfig：注入 fs 读文件；缺失回退默认", () => {
	const mem = { "mem://cfg.yml": "approvalMode: auto\n" };
	const read = (p) => {
		if (mem[p]) return mem[p];
		const e = new Error("ENOENT"); e.code = "ENOENT"; throw e;
	};
	assert.equal(loadConfig("mem://cfg.yml", { read }).approvalMode, "auto");
	assert.equal(loadConfig("mem://missing.yml", { read }).approvalMode, "interactive");
});

test("configToRuntime：映射到 LiveConversation 断言", () => {
	const rt = configToRuntime({ approvalMode: "auto", defaultPermissionMode: PERMISSION_MODES.ACCEPT_EDITS, editableTools: ["write"], allowTools: ["x"], allowBypassPermissions: true });
	assert.equal(rt.approvalMode, "auto");
	assert.equal(rt.permissionMode, PERMISSION_MODES.ACCEPT_EDITS);
	assert.deepEqual(rt.editableTools, ["write"]);
	assert.deepEqual(rt.allowTools, ["x"]);
	assert.equal(rt.allowBypassPermissions, true);
});
