#!/usr/bin/env node
// dsh-tui — milestone 2:
//   dsh-tui                        # 列出 host 上的会话
//   dsh-tui run <prompt>           # 一次性调用：新建 PTC 模式会话 → 发消息 → 打印回复
//     --session <id>               #   复用已有会话（不新建）
//     --preset <id>                #   覆盖 agent preset（默认 code = PTC 模式）
//     --cwd <dir>                  #   新建会话的工作目录（默认 host cwd）
import { DshClient } from "../lib/client.js";
import { Session, PTC_PRESET } from "../lib/session.js";
import { lastAssistantText } from "../lib/fold.js";

const baseUrl = process.env.DSH_URL ?? "http://127.0.0.1:3080";
const client = new DshClient(baseUrl);

function usage() {
	console.error("usage: dsh-tui [run <prompt> [--session <id>] [--preset <id>] [--cwd <dir>]]");
}

async function main() {
	const args = process.argv.slice(2);

	if (args[0] !== "run") {
		// 默认动作：列出会话。
		const { items } = await client.request("session.list");
		console.log(`Connected to ${baseUrl} — ${items.length} session(s):`);
		for (const item of items) {
			const state = item.blank ? "blank" : "used ";
			const running = item.running ? " (running)" : "";
			const preset = item.agentPreset ? `  [${item.agentPreset}]` : "";
			console.log(`  [${state}]${running} ${item.sessionId}${preset}  ${item.cwd ?? ""}`);
		}
		return;
	}

	const promptText = args[1];
	if (!promptText) {
		usage();
		process.exit(2);
	}
	let sessionId = null;
	let preset = PTC_PRESET;
	let cwd = null;
	for (let i = 2; i < args.length; i++) {
		const flag = args[i];
		const value = args[i + 1];
		if (flag === "--session" && value) {
			sessionId = value;
			i++;
		} else if (flag === "--preset" && value) {
			preset = value;
			i++;
		} else if (flag === "--cwd" && value) {
			cwd = value;
			i++;
		} else {
			usage();
			process.exit(2);
		}
	}

	const session = sessionId
		? await Session.open(client, sessionId)
		: await Session.create(client, { cwd, agentPreset: preset });

	const view = await session.converse(promptText);
	const reply = lastAssistantText(view);
	if (view.tools.length > 0) {
		console.error(`[${session.sessionId}] ${view.tools.length} 次工具调用`);
	}
	console.log(reply ?? "(无回复)");
}

main().catch((error) => {
	console.error(`dsh-tui: ${error.message}`);
	process.exit(1);
});
