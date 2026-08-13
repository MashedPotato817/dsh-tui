#!/usr/bin/env node
// 交互模式：Ink 渲染 + Vim 模态输入。TTY 且非 `run` 一次性调用时自动进入。
import { render } from "ink";
import React from "react";
import { DshClient } from "../lib/client.js";
import { Session } from "../lib/session.js";
import { LiveConversation } from "../lib/live.js";
import App from "../ui/components.js";
import { createVim, submitText } from "../lib/vim.js";

export async function startInteractive({ baseUrl, sessionId, preset, cwd }) {
	const client = new DshClient(baseUrl);

	// 建立会话：显式 sessionId 复用，否则新建（默认 PTC 模式）。
	const session = sessionId
		? await Session.open(client, sessionId)
		: await Session.create(client, { cwd, agentPreset: preset });

	const conv = new LiveConversation({ client, session });

	const onCommand = async (cmd) => {
		// slash 命令：以 / 开头发给 session.prompt，由 host 命令注册表执行
		//（status/new/exit 等进模型？不 —— / 开头 host 直接走命令注册表，不进模型）。
		// exit / quit 由 UI 层拦截了；这里剩下的都作为 host 命令转发。
		try {
			await conv.send(`/${cmd}`);
		} catch (error) {
			conv.state.notice = `命令出错：${error.message}`;
			conv.emit();
		}
	};

	render(
		React.createElement(App, {
			conv,
			session: { sessionId: session.sessionId, agentPreset: session.agentPreset, cwd: session.cwd },
			onCommand,
			onExit: () => {
				process.exit(0);
			}
		})
	);
}
