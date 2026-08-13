// Live 飞轮：会话恢复 —— 建会话发消息后 openRecent/LiveConversation 恢复历史。
import { test } from "node:test";
import assert from "node:assert/strict";
import { DshClient } from "../lib/client.js";
import { Session, PTC_PRESET } from "../lib/session.js";
import { LiveConversation } from "../lib/live.js";
import { writeRecent } from "../lib/registry.js";

const live = process.env.DSH_TEST_LIVE === "1";
const baseUrl = process.env.DSH_URL ?? "http://127.0.0.1:3080";
const skipReason = "需要真实 host（npm run test:live）";

const waitUntil = async (cond, timeoutMs = 120_000, pollMs = 400) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (cond()) return true;
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	return false;
};

test(
	"会话恢复：发消息 → 记忆 → 重新打开 LiveConversation 看到历史",
	{ skip: !live && skipReason, timeout: 200_000 },
	async () => {
		const client = new DshClient(baseUrl);

		// 1. 建 PTC 会话并发一条消息
		const session = await Session.create(client, { agentPreset: PTC_PRESET, cwd: process.cwd() });
		const view = await session.converse("回复两个字：成功吗", { timeoutMs: 100_000 });
		assert.ok(view.messages.some((m) => m.role === "assistant"), "应有回复");

		// 2. 记入客户端记忆
		writeRecent(session.sessionId, { cwd: session.cwd, agentPreset: session.agentPreset });

		// 3. 用 openRecent 恢复（点内部会用写入的记忆）
		const resumed = await Session.openRecent(client, {
			remembered: { sessionId: session.sessionId, cwd: session.cwd, agentPreset: session.agentPreset }
		});
		assert.equal(resumed.sessionId, session.sessionId, "应恢复到刚用的会话");

		// 4. LiveConversation 打开应能看到之前的 user/assistant 历史
		const conv = new LiveConversation({ client, session: resumed });
		await conv.open();
		const state = conv.snapshot();
		assert.ok(state.messages.length >= 2, "恢复后应看到 user + assistant 历史");
		assert.ok(state.messages.some((m) => m.role === "user"), "应含 user 历史");
		assert.ok(state.messages.some((m) => m.role === "assistant"), "应含 assistant 历史");
		conv.close();
	}
);
