// 测试飞轮：node --test --watch —— 改文件即重跑，快速迭代的核心节奏。
//
// 用法：
//   node scripts/flywheel.mjs test        # 单元飞轮（快，确定性，默认）
//   node scripts/flywheel.mjs test-live   # live 飞轮（真实 host + PTC 模式，会调真实模型）
//
// 跑 test-live 时会自动注入 DSH_TEST_LIVE=1，让 live 测试不再自跳过。
// 显式文件列表而不是目录参数：Windows 上 node --test 对目录参数的
// 处理不可靠，且显式列表天然把 test-live 排除在单元飞轮之外。
import { spawn } from "node:child_process";

const SETS = {
	test: [
		"test/fold.test.js",
		"test/session.test.js",
		"test/client.test.js",
		"test/stream.test.js",
		"test/live.test.js",
		"test/vim.test.js",
		"test/hud.test.js",
		"test/bridge.test.js",
		"test/ui.test.js",
		"test/registry.test.js",
		"test/policy.test.js",
		"test/permission.test.js",
		"test/command-loader.test.js",
		"test/config.test.js"
	],
	"test-live": ["test-live/ptc.smoke.test.js", "test-live/stream.smoke.test.js", "test-live/resume.smoke.test.js"]
};

const name = process.argv[2] ?? "test";
const files = SETS[name];
if (!files) {
	console.error(`unknown set: ${name} (expected: ${Object.keys(SETS).join(" / ")})`);
	process.exit(2);
}
const live = name === "test-live";

const child = spawn(process.execPath, ["--test", "--watch", ...files], {
	stdio: "inherit",
	env: { ...process.env, ...(live ? { DSH_TEST_LIVE: "1" } : {}) }
});
child.on("exit", (code) => process.exit(code ?? 1));
