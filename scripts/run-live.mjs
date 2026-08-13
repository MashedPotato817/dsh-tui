// live 测试单跑：真实 host + PTC 模式全链路（会调用一次真实模型）。
// 用法：node scripts/run-live.mjs（DSH_URL 可选，默认 127.0.0.1:3080）
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["--test", "test-live/ptc.smoke.test.js"], {
	stdio: "inherit",
	env: { ...process.env, DSH_TEST_LIVE: "1" }
});
child.on("exit", (code) => process.exit(code ?? 1));
