#!/usr/bin/env node
// dsh-tui — 命令行入口
//   dsh-tui                          # TTY: 交互 TUI（Ink + Vim）
//                                     # 非 TTY / 管道: 列出会话
//   dsh-tui run <prompt>             # 一次性调用（PTC 会话 → 打印回复）
//     --session <id> --preset <id> --cwd <dir>
import { DshClient } from "../lib/client.js";
import { Session, PTC_PRESET } from "../lib/session.js";
import { lastAssistantText } from "../lib/fold.js";
import { startInteractive } from "./interactive.js";

const baseUrl = process.env.DSH_URL ?? "http://127.0.0.1:3080";
const client = new DshClient(baseUrl);

function usage() {
	console.error("usage: dsh-tui [run <prompt> [--session <id>] [--preset <id>] [--cwd <dir>]]|[--version]");
}

async function listSessions() {
	const { items } = await client.request("session.list");
	console.log(`Connected to ${baseUrl} — ${items.length} session(s):`);
	for (const item of items) {
		const state = item.blank ? "blank" : "used ";
		const running = item.running ? " (running)" : "";
		const preset = item.agentPreset ? `  [${item.agentPreset}]` : "";
		console.log(`  [${state}]${running} ${item.sessionId}${preset}  ${item.cwd ?? ""}`);
	}
}

function parseRunArgs(args) {
	const promptText = args[1];
	if (!promptText) {
		usage();
		process.exit(2);
	}
	const opts = { sessionId: null, preset: PTC_PRESET, cwd: null };
	for (let i = 2; i < args.length; i++) {
		const flag = args[i];
		const value = args[i + 1];
		if (flag === "--session" && value) {
			opts.sessionId = value;
			i++;
		} else if (flag === "--preset" && value) {
			opts.preset = value;
			i++;
		} else if (flag === "--cwd" && value) {
			opts.cwd = value;
			i++;
		} else {
			usage();
			process.exit(2);
		}
	}
	return { promptText, opts };
}

async function main() {
	const args = process.argv.slice(2);

	if (args[0] === "--version" || args[0] === "-v") {
		console.log(process.env.npm_package_version ?? "0.1.0");
		return;
	}

	if (args[0] === "run") {
		const { promptText, opts } = parseRunArgs(args);
		const session = opts.sessionId
			? await Session.open(client, opts.sessionId)
			: await Session.create(client, { cwd: opts.cwd, agentPreset: opts.preset });
		const view = await session.converse(promptText);
		if (view.tools.length > 0) {
			console.error(`[${session.sessionId}] ${view.tools.length} 次工具调用`);
		}
		console.log(lastAssistantText(view) ?? "(无回复)");
		return;
	}

	// 无子命令：TTY → 交互 TUI；否则列出会话。
	if (process.stdout.isTTY && process.stdin.isTTY) {
		await startInteractive({ baseUrl, sessionId: null, preset: PTC_PRESET, cwd: null });
	} else {
		await listSessions();
	}
}

main().catch((error) => {
	console.error(`dsh-tui: ${error.message}`);
	process.exit(1);
});
