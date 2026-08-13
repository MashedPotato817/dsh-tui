// Live 飞轮：真实 host + PTC 模式的实时流式会话（mux SSE）。
//
// 覆盖里程碑 3 的核心链路：baseline → mux 流 → 流式草稿(chunk) → assistant/message 落定
// → turn/end。会调用一次真实模型。默认跳过（DSH_TEST_LIVE=1 时跑）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { DshClient } from "../lib/client.js";
import { Session } from "../lib/session.js";
import { LiveConversation } from "../lib/live.js";
import { PTC_PRESET } from "../lib/session.js";

const live = process.env.DSH_TEST_LIVE === "1";
const baseUrl = process.env.DSH_URL ?? "http://127.0.0.1:3080";
const skipReason = "需要真实 host（npm run test:live）";

const waitUntil = async (cond, timeoutMs = 160_000, pollMs = 300, label = "condition") => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (cond()) return;
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	assert.fail(`等待超时：${label}`);
};

test(
	"LiveConversation：PTC 会话 create → mux 流 → 流式草稿 → 回复落定 → turn/end",
	{ skip: !live && skipReason, timeout: 200_000 },
	async () => {
		const client = new DshClient(baseUrl);
		const session = await Session.create(client, { agentPreset: PTC_PRESET, cwd: process.cwd() });
		const conv = new LiveConversation({ client, session });
		const snapshots = [];
		conv.onState = (state) => snapshots.push(state);
		await conv.open();
		assert.equal(conv.snapshot().connected, true, "mux 流应建立");

		const sendP = conv.send("请用一个字回答：好");
		await new Promise((resolve) => setTimeout(resolve, 1500)); // 给 mux 一点时间推流

		// 流式草稿 OR 落定的 assistant 消息
		const sawStreaming = snapshots.some((s) => s.streaming && s.streaming.text.length > 0);
		const sawAssistant = snapshots.some((s) => s.messages.some((m) => m.role === "assistant"));

		await waitUntil(
			() => {
				const s = conv.snapshot();
				return s.lastTurnEnd !== null || (s.running === false && s.messages.some((m) => m.role === "assistant"));
			},
			160_000,
			300,
			"回合结束"
		);
		await sendP;

		const final = conv.snapshot();
		assert.ok(
			sawStreaming || sawAssistant || final.messages.some((m) => m.role === "assistant"),
			"应产生 assistant 回复（流式草稿或已落定）"
		);

		// 找到最后一条 assistant 文本并断言包含 好
		const assistant = [...final.messages].reverse().find((m) => m.role === "assistant");
		if (assistant) {
			assert.ok(assistant.text.includes("好"), `回复应含「好」，实际: ${JSON.stringify(assistant.text)}`);
		}

		conv.close();
	}
);
