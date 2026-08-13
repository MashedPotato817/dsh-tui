// Live 飞轮：真实 host + PTC 模式（code agent preset）全链路。
//
// 覆盖的核心链路：envelope → host → PTC agent（Code Mode SDK）→ 模型 → 历史折叠。
// 会调用一次真实模型（很便宜）。默认跳过 —— 用 `npm run test:live` 或
// `npm run flywheel:live` 才会跑（脚本里会设置 DSH_TEST_LIVE=1）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { DshClient } from "../lib/client.js";
import { Session, PTC_PRESET } from "../lib/session.js";

const live = process.env.DSH_TEST_LIVE === "1";
const baseUrl = process.env.DSH_URL ?? "http://127.0.0.1:3080";
const skipReason = "需要真实 host（npm run test:live），会调用一次真实模型";

test(
	"PTC 模式：create → prompt → 事件折叠 → assistant 回复（真实模型）",
	{ skip: !live && skipReason, timeout: 150_000 },
	async () => {
		const client = new DshClient(baseUrl);
		const session = await Session.create(client, {
			agentPreset: PTC_PRESET,
			cwd: process.cwd()
		});
		assert.equal(session.agentPreset, PTC_PRESET, "host 应确认会话由 PTC 模式（code）组合");

		const view = await session.converse("只回复一个字：好", { timeoutMs: 120_000, pollMs: 750 });
		assert.equal(view.accepted, true);
		assert.equal(view.turnEnd.reason.kind, "completed", `回合应以 completed 结束，实际: ${JSON.stringify(view.turnEnd.reason)}`);

		const assistant = [...view.messages].reverse().find((m) => m.role === "assistant");
		assert.ok(assistant, "折叠视图里应出现 assistant 消息");
		assert.ok(assistant.text.length > 0, "assistant 回复不应为空");
		assert.ok(assistant.text.includes("好"), `PTC 会话应能收到回复，实际: ${JSON.stringify(assistant.text)}`);

		const user = view.messages.find((m) => m.role === "user");
		assert.equal(user.text, "只回复一个字：好", "user 消息应原样进入历史");
	}
);
