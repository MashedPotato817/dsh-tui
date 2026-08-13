/**
 * Ink UI 组件 —— 用 React.createElement 手写（零构建，TUI 层）。
 *
 * 组件树：HUD 状态栏 / 消息列表(含流式草稿) / slash 面板 / notice / 输入框。
 * App 用 useState 持有快照 + vim 状态，useInput 处理按键，把 vim 状态机
 * 接到 LiveConversation。
 */
import { createElement as h } from "react";
import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, Static } from "ink";
import { hudState, formatCost } from "../lib/hud.js";
import { buildSlashPanel } from "../lib/slash.js";
import { createVim, submitText } from "../lib/vim.js";
import { processInput } from "../lib/bridge.js";
import { nextMode, modeBadge, modeColor } from "../lib/permission.js";

/** HUD 一行：`● model | PTC | ⏸ manual | $0.12 | 1.2ki/3o | sessionId cwd` */
export function HUD({ hud }) {
	const cost = formatCost(hud.costUsd);
	const running = hud.running ? "●" : "○";
	const tok =
		`${(hud.usage.input || 0).toLocaleString()}i/${(hud.usage.output || 0).toLocaleString()}o`;
	const ctx = hud.contextPct !== null && hud.contextPct !== undefined
		? ` | ctx ${hud.contextPct}%`
		: "";
	return h(
		Box,
		{ borderStyle: "single", borderColor: "gray", paddingX: 1 },
		h(Text, { color: "cyan", bold: true }, ` ${running} ${hud.model} | ${hud.mode}`),
		h(Text, { color: hud.permColor || "gray", bold: true }, ` ${hud.permBadge || "⏸ manual"} `),
		h(Text, { color: "dim" }, `${cost ? ` | ${cost}` : ""} | ${tok}t${ctx}`),
		h(Box, { marginLeft: 1 }, h(Text, { color: "dim" }, ` ${hud.sessionId} ${hud.cwd || ""}`))
	);
}

function MessageRow({ message }) {
	const { role, text, pending, injected } = message;
	const body = String(text || "");
	// 注入上下文（agent-instructions / plugin 的运行时说明）不是日常对话，
	// 弱化显示并折叠成一行，避免污染会话视图。
	if (injected) {
		const oneLine = body.replace(/\s+/g, " ").trim();
		if (!oneLine) return null;
		const clipped = oneLine.length > 60 ? oneLine.slice(0, 60) + "…" : oneLine;
		return h(
			Box,
			{ key: undefined },
			h(Text, { dim: true, color: "gray" }, `· ${clipped}`)
		);
	}
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
	// live 尾（pending 乐观行 / 注入上下文 / 流式草稿）用常规重绘区。
	const live = messages.filter((m) => m.pending || m.injected);
	const rows = live.map((m, i) => h(MessageRow, { key: i, message: m }));
	if (streaming && streaming.text) {
		rows.push(h(Box, { key: "stream" }, h(Text, { dim: true, color: "magenta" }, "◉ "), h(Text, { dim: true }, String(streaming.text))));
	}
	return h(Box, { flexDirection: "column" }, ...rows);
}

/** 落定历史的 <Static> 区：每行稳定 key=seq，新增才渲染。 */
export function SettledList({ messages }) {
	const settled = messages.filter((m) => typeof m.seq === "number" && m.seq >= 0 && !m.injected);
	return h(Static, {
		items: settled,
		children: (m) => h(MessageRow, { key: m.seq, message: m })
	});
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

export function PendingApprovals({ approvals }) {
	if (!approvals || approvals.length === 0) return null;
	const rows = approvals.map((a) =>
		h(
			Box,
			{ key: a.approvalId, paddingX: 1 },
			h(Text, { bold: true, color: "yellow" }, `⏳ 工具 `),
			h(Text, { bold: true }, `${a.toolName}`),
			h(Text, { dim: true }, `   [y]允许一次  [Y]本会话允许  [n]拒绝`)
		)
	);
	return h(
		Box,
		{ borderStyle: "round", borderColor: "yellow", flexDirection: "column" },
		h(Text, { bold: true, color: "yellow" }, " 等待批准"),
		...rows
	);
}

/** 工具卡片：把最近的工具调用渲染成折叠卡片（名称 + 状态 + 参数摘要）。 */
export function ToolCards({ tools, limit = 5 }) {
	if (!tools || tools.length === 0) return null;
	const recent = tools.slice(-limit);
	const rows = recent.map((t) => {
		let badge, color;
		if (t.status === "running") {
			badge = "◐"; color = "cyan";
		} else if (t.status === "error") {
			badge = "✗"; color = "red";
		} else {
			badge = "✓"; color = "green";
		}
		return h(
			Box,
			{ key: t.callId, paddingX: 1 },
			h(Text, { color, bold: true }, `${badge} `),
			h(Text, { bold: true }, `${t.name}`),
			t.args ? h(Text, { dim: true }, `  ${t.args}`) : null
		);
	});
	return h(
		Box,
		{ flexDirection: "column" },
		...rows
	);
}

/** 快捷键帮助面板（`?` 触发，Claude Code 心智模型）。 */
export function HelpPanel() {
	const rows = [
		["i / A / o", "进入 insert 输入"],
		["ESC", "退出 insert / 中断回合"],
		["Enter", "发送"],
		["Shift+Enter / Ctrl+J", "多行输入换行"],
		[":", "命令模式（:w 提交 :cancel 停止 :q 退出）"],
		["/", "斜杠命令"],
		["Shift+Tab", "权限档位"],
		["Ctrl+C", "中断（运行中）/ 双按退出"],
		["?", "此帮助"],
		["y / Y / n", "审批：允许一次 / 本会话 / 拒绝"]
	].map(([k, v]) =>
		h(Box, { key: k, paddingX: 1 }, h(Text, { bold: true, color: "cyan" }, ` ${k}`), h(Text, { dim: true }, `  ${v}`))
	);
	return h(
		Box,
		{ borderStyle: "round", borderColor: "blue", flexDirection: "column" },
		h(Text, { bold: true, color: "blue" }, " 快捷键"),
		...rows
	);
}

/** 消息队列 Dock（Codex/OpenCode 队列面板）：展示排队中的待处理消息。 */
export function QueueDock({ queue }) {	if (!queue || queue.length === 0) return null;
	const textOf = (message) =>
		(message.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
	const rows = queue.map((item) => {
		const preview = textOf(item.message);
		const clipped = preview.length > 60 ? preview.slice(0, 60) + "…" : preview;
		const tag = item.placement === "steering" ? "▸" : "◷";
		return h(
			Box,
			{ key: item.id, paddingX: 1 },
			h(Text, { dim: true }, `${tag} `),
			h(Text, { dim: true }, clipped || "(无文本)")
		);
	});
	return h(
		Box,
		{ borderStyle: "round", borderColor: "cyan", flexDirection: "column" },
		h(Text, { bold: true, color: "cyan" }, " 待处理队列"),
		...rows
	);
}

/**
 * 主 App 组件。
 * @param {object} props
 * @param {import("../lib/live.js").LiveConversation} props.conv
 * @param {{ session: object, onCommand: (cmd: string) => void, onExit: () => void }} props
 */
export default function App({ conv, session, onCommand, onExit, getSession }) {
	const [snapshot, setSnapshot] = useState(() => conv.snapshot());
	const [vim, setVim] = useState(() => createVim());
	const [slashActive, setSlashActive] = useState(0);
	// 让 HUD 跟随会话切换
	const [liveSession, setLiveSession] = useState(() => (getSession ? getSession() : session));
	// Ctrl+C 双按退出计时（Claude Code 安全退出双保险）
	const lastCtrlC = useRef(0);
	// 自定义命令（.claude/commands/*.md）
	const [customCommands, setCustomCommands] = useState([]);
	// 快捷键帮助面板（`?` 空输入触发，Claude Code 心智模型）
	const [showHelp, setShowHelp] = useState(false);
	// 命令历史（normal 模态 j/k 翻历史）
	const [history, setHistory] = useState(() => createHistory());

	useEffect(() => {
		try {
			setCustomCommands(loadCustomCommands({ projectDir: liveSession.cwd || session.cwd }));
		} catch {
			setCustomCommands([]);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		conv.onState = (state) => setSnapshot({ ...state });
		conv.open().catch((error) => {
			setSnapshot((s) => ({ ...s, notice: `连接失败：${error.message}` }));
		});
		return () => conv.close();
	}, [conv]);

	useEffect(() => {
		if (!getSession) return;
		const t = setInterval(() => {
			const cur = getSession();
			setLiveSession((prev) => (prev && prev.sessionId === cur.sessionId ? prev : cur));
		}, 300);
		return () => clearInterval(t);
	}, [getSession]);

	const hud = hudState({ view: snapshot, session: liveSession });

	useInput((input, key) => {
		// `?`（normal 模态）切换快捷键帮助面板（Claude Code 心智模型）。
		if (input === "?" && vim.mode === "normal") {
			setShowHelp((s) => !s);
			return;
		}
		if (showHelp && key.escape) {
			setShowHelp(false);
			return;
		}
		// 命令历史：normal 模态下 j=上一条 / k=下一条（readline 式翻历史）。
		if (vim.mode === "normal" && (input === "j" || input === "k")) {
			const r = navigateHistory(history, input === "j" ? "up" : "down", submitText(vim));
			setHistory(r.history);
			if (r.text !== null) {
				// 用历史文本填充单行输入
				setVim({ ...vim, lines: [r.text], cursor: { row: 0, col: String(r.text).length }, pending: "" });
			}
			return;
		}
		// 审批交互：有挂起批准时，y/Y/n 处理第一个（Claude Code/Codex 式审批卡片）。
		if (snapshot.pendingApprovals && snapshot.pendingApprovals.length > 0 && !key.ctrl) {
			const pending = snapshot.pendingApprovals[0];
			if (input === "y") {
				conv.answerApproval(pending, "allowed-once");
				return;
			}
			if (input === "Y") {
				conv.answerApproval(pending, "allowed-session");
				return;
			}
			if (input === "n") {
				conv.answerApproval(pending, "rejected");
				return;
			}
		}
		// Claude Code 式 Ctrl+C：运行中 → 中断当前回合；空闲 → 800ms 内双按退出。
		if (key.ctrl && (input === "c" || input === "C")) {
			if (snapshot.running) {
				conv.cancelTurn();
				return;
			}
			const now = Date.now();
			if (now - lastCtrlC.current < 800) {
				onExit();
				return;
			}
			lastCtrlC.current = now;
			conv.state.notice = "再按 Ctrl+C 退出";
			conv.emit();
			return;
		}
		// Claude Code 式权限档位循环：Shift+Tab（Windows 终端也可 Alt+M）。
		if (key.shift && key.tab) {
			const next = nextMode(conv.permissionMode);
			conv.setPermissionMode(next);
			conv.state.notice = `权限档位：${modeBadge(next)}（${modeColor(next)}）`;
			conv.emit();
			return;
		}
		if (key.meta && (input === "m" || input === "M")) {
			const next = nextMode(conv.permissionMode);
			conv.setPermissionMode(next);
			conv.state.notice = `权限档位：${modeBadge(next)}`;
			conv.emit();
			return;
		}
		// Claude Code 式中断：回合运行中按 Esc 直接停止生成，而不是只在模式间切换。
		// 仅当正在运行（流式/思考）时 Esc 触发取消；空闲时 Esc 仍是退出 insert 的常规键。
		if (key.escape && snapshot.running) {
			conv.cancelTurn();
			return;
		}

		const currentText = submitText(vim);
		// slash 命令面板导航：输入以 / 开头且命中命令时，Tab/方向键循环选择，
		// Enter/Tab 选中执行（Claude Code 式可发现性补全）。
		const activePanel = buildSlashPanel(currentText, allCommandsFn(customCommands), { active: slashActive });
		if (activePanel && activePanel.items.length > 0) {
			if (key.tab && !key.shift) {
				setSlashActive((a) => (a + 1) % activePanel.items.length);
				return;
			}
			if (key.downArrow) {
				setSlashActive((a) => (a + 1) % activePanel.items.length);
				return;
			}
			if (key.upArrow) {
				setSlashActive((a) => (a - 1 + activePanel.items.length) % activePanel.items.length);
				return;
			}
		}

		const result = processInput(vim, input, key);
		setVim(result.state);

		if (result.action === "submit") {
			const text = submitText(result.state);
			// slash 面板可见时 Enter 选中当前命令执行
			const panel = buildSlashPanel(text, allCommandsFn(customCommands), { active: slashActive });
			if (panel && panel.items.length > 0 && text.startsWith("/")) {
				const item = panel.items[slashActive % panel.items.length];
				if (item.name) onCommand(item.name);
				return;
			}
			if (text.trim()) {
				setHistory((h) => pushHistory(h, text));
				conv.send(text).catch(() => {});
			}
		} else if (result.action === "run-command") {
			const command = result.command ?? "";
			if (command === "q" || command === "quit") {
				onExit();
			} else if (command === "cancel" || command === "c") {
				conv.cancelTurn();
			} else {
				onCommand(command);
			}
		}
	});

	const text = submitText(vim);
	const slashPanel = buildSlashPanel(text, allCommandsFn(customCommands), { active: slashActive });

	return h(
		Box,
		{ flexDirection: "column", height: "100%" },
		h(HUD, { hud }),
		// 落定历史用 <Static>（永不重绘）；live 尾（pending/注入/流式草稿）用常规重绘区。
		h(SettledList, { messages: snapshot.messages }),
		h(Box, { flexDirection: "column", flexGrow: 1, minHeight: 2 },
			ConversationList({ messages: snapshot.messages, streaming: snapshot.streaming }),
			snapshot.messages.length === 0 && !(snapshot.streaming && snapshot.streaming.text)
				? h(Text, { key: "empty", dim: true }, "( 空会话 — 按 i 输入，Enter 发送，/ 命令 )")
				: null
		),
		showHelp ? h(HelpPanel, {}) : null,
		h(PendingApprovals, { approvals: snapshot.pendingApprovals }),
		h(ToolCards, { tools: snapshot.tools }),
		h(QueueDock, { queue: snapshot.queue }),
		h(SlashPanel, { panel: slashPanel }),
		h(Notice, { notice: snapshot.notice }),
		h(CommandInput, { vim })
	);
}

// slash 面板命令源：内置 + 本地 + 自定义
import { allCommands as allCommandsFn } from "../lib/commands.js";
import { loadCustomCommands } from "../lib/command-loader.js";
import { createHistory, pushHistory, navigateHistory } from "../lib/history.js";
