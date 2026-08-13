/**
 * Ink UI 组件 —— 用 React.createElement 手写（零构建，TUI 层）。
 *
 * 组件树：HUD 状态栏 / 消息列表(含流式草稿) / slash 面板 / notice / 输入框。
 * App 用 useState 持有快照 + vim 状态，useInput 处理按键，把 vim 状态机
 * 接到 LiveConversation。
 */
import { createElement as h } from "react";
import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { hudState, formatCost } from "../lib/hud.js";
import { buildSlashPanel, BUILTIN_COMMANDS } from "../lib/slash.js";
import { createVim, submitText } from "../lib/vim.js";
import { processInput } from "../lib/bridge.js";

/** HUD 一行：`● model | PTC | $0.12 | 1.2ki/3o | sessionId cwd` */
export function HUD({ hud }) {
	const cost = formatCost(hud.costUsd);
	const running = hud.running ? "●" : "○";
	const tok =
		`${(hud.usage.input || 0).toLocaleString()}i/${(hud.usage.output || 0).toLocaleString()}o`;
	return h(
		Box,
		{ borderStyle: "single", borderColor: "gray", paddingX: 1 },
		h(Text, { color: "cyan", bold: true }, ` ${running} ${hud.model} | ${hud.mode}`),
		h(Text, { color: "dim" }, `${cost ? ` | ${cost}` : ""} | ${tok}t`),
		h(Box, { marginLeft: 1 }, h(Text, { color: "dim" }, ` ${hud.sessionId} ${hud.cwd || ""}`))
	);
}

function MessageRow({ message }) {
	const { role, text, pending } = message;
	const body = String(text || "");
	if (role === "user") {
		return h(
			Box,
			{ key: undefined },
			h(Text, { bold: true, color: "green" }, pending ? "⟳ " : "❯ "),
			h(Text, {}, body)
		);
	}
	return h(
		Box,
		{},
		h(Text, { bold: true, color: "magenta" }, "◉ "),
		h(Text, {}, body)
	);
}

export function ConversationList({ messages, streaming }) {
	const rows = messages.map((m, i) => h(MessageRow, { key: i, message: m }));
	if (streaming && streaming.text) {
		rows.push(
			h(
				Box,
				{ key: "stream" },
				h(Text, { dim: true, color: "magenta" }, "◉ "),
				h(Text, { dim: true }, String(streaming.text))
			)
		);
	}
	if (rows.length === 0) {
		rows.push(h(Text, { key: "empty", dim: true }, "( 空会话 — 按 i 输入，Enter 发送，/ 命令 )"));
	}
	return h(Box, { flexDirection: "column" }, ...rows);
}

export function SlashPanel({ panel }) {
	if (!panel || panel.items.length === 0) return null;
	const items = panel.items.map((item, i) => {
		const active = i === panel.active;
		return h(
			Box,
			{ key: item.name, paddingX: 1 },
			h(
				Text,
				{ backgroundColor: active ? "#4c8dff" : undefined, color: active ? "black" : undefined, bold: active },
				`/${item.name}`
			),
			h(Text, { color: "dim" }, `  ${item.description || ""}`)
		);
	});
	return h(Box, { borderStyle: "round", borderColor: "blue", flexDirection: "column", marginTop: 1, minWidth: 12 }, ...items);
}

export function Notice({ notice }) {
	if (!notice) return null;
	return h(Box, { borderStyle: "round", borderColor: "yellow", paddingX: 1 }, h(Text, {}, String(notice)));
}

export function CommandInput({ vim }) {
	const text = submitText(vim);
	const insert = vim.mode === "insert";
	return h(
		Box,
		{ borderStyle: "single", borderColor: insert ? "green" : "cyan", paddingX: 1 },
		h(Text, { color: insert ? "green" : "yellow", bold: true }, insert ? " INSERT " : " NORMAL "),
		h(Text, {}, ` ${text}${insert ? "▌" : ""}`)
	);
}

/**
 * 主 App 组件。
 * @param {object} props
 * @param {import("../lib/live.js").LiveConversation} props.conv
 * @param {{ session: object, onCommand: (cmd: string) => void, onExit: () => void }} props
 */
export default function App({ conv, session, onCommand, onExit }) {
	const [snapshot, setSnapshot] = useState(() => conv.snapshot());
	const [vim, setVim] = useState(() => createVim());
	const [slashActive, setSlashActive] = useState(0);
	const [overlay, setOverlay] = useState(null); // 'slash' | null

	useEffect(() => {
		conv.onState = (state) => setSnapshot({ ...state });
		conv.open().catch((error) => {
			setSnapshot((s) => ({ ...s, notice: `连接失败：${error.message}` }));
		});
		return () => conv.close();
	}, [conv]);

	const hud = hudState({ view: snapshot, session });

	useInput((input, key) => {
		const result = processInput(vim, input, key);
		setVim(result.state);

		if (result.action === "submit") {
			const text = submitText(result.state);
			if (text.trim()) {
				conv.send(text).catch(() => {});
			}
		} else if (result.action === "run-command") {
			const command = result.command ?? "";
			if (command === "q" || command === "quit") onExit();
			else if (command === "w") {
				// 命令行编辑模式的提交（与 insert Enter 相同语义）
				const text = submitText(result.state);
				if (text.trim()) conv.send(text).catch(() => {});
			} else {
				onCommand(command);
			}
		}
	});

	const text = submitText(vim);
	const slashPanel = !snapshot.notice
		? buildSlashPanel(text, BUILTIN_COMMANDS, { active: slashActive })
		: null;

	return h(
		Box,
		{ flexDirection: "column", height: "100%" },
		h(HUD, { hud }),
		h(Box, { flexDirection: "column", flexGrow: 1, minHeight: 4 }, ConversationList({ messages: snapshot.messages, streaming: snapshot.streaming })),
		h(SlashPanel, { panel: slashPanel }),
		h(Notice, { notice: snapshot.notice }),
		h(CommandInput, { vim })
	);
}
