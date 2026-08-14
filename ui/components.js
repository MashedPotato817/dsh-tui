/**
 * Ink UI 组件 —— 用 React.createElement 手写（零构建，TUI 层）。
 *
 * 组件树：HUD 状态栏 / 消息列表(含流式草稿) / slash 面板 / notice / 输入框。
 * App 用 useState 持有快照 + vim 状态，useInput 处理按键，把 vim 状态机
 * 接到 LiveConversation。
 */
import { createElement as h } from "react";
import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { hudState, formatCost, contextWindowLabel, formatDuration, toolDurationLabel, formatTokens } from "../lib/hud.js";
import { buildSlashPanel } from "../lib/slash.js";
import { createVim, submitText } from "../lib/vim.js";
import { processInput } from "../lib/bridge.js";
import { nextMode, modeBadge, modeColor } from "../lib/permission.js";
import { keyOwner } from "../lib/mode.js";
/** HUD —— 无框、低对比、单行，`model[1M] · PTC`(左) + `tok · cost · ctx`(右)。
 *  运行指标只保留 essentials；docs/agents/session/cwd/CHAT/manual 都隐藏（前两者 0 时不显示，
 *  cwd/CHAT 在 Banner 与输入区已展示，session 归 /status，permission 已在输入区右侧）。 */
export function HUD({ hud }) {
	const cost = formatCost(hud.costUsd);
	const running = hud.running ? "●" : "○";
	const tok = `${formatTokens(hud.usage.input)}i/${formatTokens(hud.usage.output)}o`;
	// ctx 0% 或未知时不显示
	const ctx = hud.contextPct > 0 ? `· ctx ${hud.contextPct}%` : "";
	// 无用量/价格未知时不显示 cost
	const costSeg = cost && hud.hasUsage ? `· ${cost}` : "";
	const runningDot = h(Text, { color: hud.running ? "cyan" : "dim" }, `${running} `);
	const left = [
		runningDot,
		h(Text, { color: "gray" }, hud.model ? `${hud.modelLabel} · ` : ""),
		h(Text, {}, `${hud.mode}`)
	];
	// 右侧运行指标（去重后）：tok · cost · ctx
	const rightBits = [tok, costSeg, ctx].filter(Boolean).join(" ");
	const right = rightBits ? h(Text, { dim: true, color: "gray" }, rightBits) : null;
	return h(
		Box,
		{ flexDirection: "row", paddingX: 1 },
		...left,
		h(Box, { flexGrow: 1 }),
		right
	);
}

/** 启动 logo banner（Claude Code 顶栏心智）：版本 + 概览，跟随消息上滚消失。 */
export function Banner({ hud }) {
	let pkgVersion = "";
	try { pkgVersion = require("../package.json").version; } catch { /* 嵌入环境无版本 */ }
	const cost = formatCost(hud.costUsd);
	// 未建模前不输出占位 model（避免裸 `— · $0.0000`）；显示版本文案 + cwd。
	const modelSeg = hud.model ? hud.modelLabel : "";
	const bits = [pkgVersion ? `v${pkgVersion}` : ""];
	if (modelSeg) bits.push(modelSeg);
	if (cost) bits.push(cost);
	if (hud.cwd) bits.push(hud.cwd);
	const sub = bits.filter(Boolean).join(" · ");
	return h(
		Box,
		{ flexDirection: "column", marginBottom: 1 },
		h(Text, { bold: true, color: "magenta" }, `▐▛███▜▌  dsh-tui`),
		sub ? h(Text, { dim: true, color: "gray" }, sub) : null
	);
}

/** 助手正文轻量 Markdown 渲染：代码块/列表/标题/diff/内联粗体+code。
 *  fromLine/maxLines：行级视口裁剪（单条超长消息内部分页用）。按「已渲染视觉行」切片。 */
function MarkdownBody({ text, fromLine = 0, maxLines = Infinity }) {
	// 已定稿消息用有界缓存解析，避免每秒 `now` 重绘时重复 parse 长正文（pi-tui 行缓存思路）。
	const blocks = cachedParseMarkdown(text);
	const rows = [];
	blocks.forEach((b, bi) => {
		if (b.type === "code") {
			rows.push(
				h(Box, { key: `c${bi}`, paddingLeft: 2, width: "100%" },
					h(Text, { backgroundColor: "#16161e", color: "#d4d4d4" }, String(b.content || "")))
			);
		} else if (b.type === "heading") {
			rows.push(
				h(Box, { key: `h${bi}`, paddingLeft: 2 },
					h(Text, { bold: true, color: b.level <= 2 ? "white" : "gray" }, String(b.content || "")))
			);
		} else if (b.type === "list") {
			(b.items || []).forEach((item, ii) => {
				const marker = b.ordered ? `${b.items.length > 1 ? `${ii + 1}.` : "  "}` : "·";
				rows.push(
					h(Box, { key: `l${bi}_${ii}`, paddingLeft: 4 },
						h(Text, { color: "gray", bold: true }, `${marker} `),
						...inlineText(item))
				);
			});
		} else if (b.type === "diff") {
			const dl = String(b.content || "").split("\n");
			dl.forEach((l, li) => {
				const color = l.startsWith("+") ? "green" : l.startsWith("-") ? "red" : "dim";
				rows.push(
					h(Box, { key: `d${bi}_${li}`, paddingLeft: 4 },
						h(Text, { color }, l))
				);
			});
		} else {
			// text（可能含多行，逐行缩进到 "●" 之后）
			const tl = String(b.content || "").split("\n");
			tl.forEach((l, li) => {
				// 第一行挂到 ● 锚点；后续行缩进
				rows.push(
					h(Box, { key: `t${bi}_${li}`, paddingLeft: li === 0 ? 2 : 4 },
						...inlineText(l))
				);
			});
		}
	});
	// 行级裁剪：只保留 [fromLine, fromLine+maxLines) 的视觉行（供长消息内部分页）。
	const sliced = rows.slice(Math.max(0, fromLine), Math.max(0, fromLine) + (Number.isFinite(maxLines) ? maxLines : Infinity));
	// 首行前放 ● 锚点（仅当从消息头开始渲染），被裁剪后首行锚点略去以免误导。
	if (sliced.length && fromLine <= 0) {
		sliced[0] = h(Box, { key: "anchor-row" },
			h(Text, { color: "magenta", bold: true }, "● "),
			h(Box, { flexDirection: "column" }, sliced[0])
		);
	}
	return h(Box, { flexDirection: "column" }, ...sliced);
}

function inlineText(line) {
	return inlineFragments(String(line)).map((f, i) =>
		h(Text, { key: i, bold: f.kind === "bold", backgroundColor: f.kind === "code" ? "#16161e" : undefined, color: f.kind === "code" ? "#d4d4d4" : f.kind === "bold" ? "white" : undefined }, f.content)
	);
}

function MessageRow({ message, currentNow = null, fromLine = 0, maxLines = Infinity }) {
	const { role, text, pending, injected } = message;
	// 转义外部文本里可能注入的控制字符（ESC/BEL/NUL 等），防破坏布局/终端转义。
	const body = sanitizeControlChars(String(text || ""));
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
		// pending 状态分级：stuck(≥60s 未落定，警告可重发) > 超时(>8s 仍在处理) > 正常
		let suffix = "";
		let warn = false;
		if (pending && message.stuck) {
			suffix = "（发消息可能未生效 — Enter 重发 / Esc 放弃）";
			warn = true;
		} else if (pending) {
			const elapsed = currentNow - (message.time || message.sentAt || 0);
			if (elapsed > 8000) { suffix = `（仍在处理… ${Math.round(elapsed / 1000)}s）`; warn = true; }
		}
		// 用户消息：整行暗灰背景横条（对标 Claude Code），只在开头保留很暗的 `>`，
		// 让用户输入与 assistant 正文自然分组；pending 用状态前缀提示。
		// 行级视口：对边界消息裁掉 fromLine 之前的原始行（用户消息一般短，线性切分足够）。
		const clippedBody = fromLine > 0
			? body.split("\n").slice(Math.max(0, fromLine)).join("\n")
			: body;
		const badge = pending ? (warn ? "⚠" : "⟳") : ">";
		const bg = "#333333";
		return h(
			Box,
			{ key: undefined, width: "100%", paddingX: 1, backgroundColor: bg },
			h(Text, { bold: true, color: warn ? "red" : "green" }, `${badge} `),
			h(Text, { color: warn ? "#ff7777" : undefined }, clippedBody),
			suffix ? h(Text, { color: warn ? "#ff7777" : "#bbbbbb" }, `  ${suffix}`) : null
		);
	}
	// assistant：小圆点作为轮次锚点，正文走轻量 Markdown 渲染（code/列表/标题/diff/inline，
	// Claude Code 风格），避免直接显示原始标记。
	if (!body) {
		return h(
			Box,
			{},
			h(Text, { color: "magenta", bold: true }, "● "),
			h(Text, { dim: true, color: "gray" }, "（已收到回复，但模型未生成文本内容）")
		);
	}
	return h(MarkdownBody, { text: body, fromLine, maxLines });
}

export function ConversationList({ messages, streaming, now, viewport }) {
	// 行级视口：viewport = { startMsg, startLine }（windowViewport 产出）。
	// startLine 仅在边界（最上面那条）生效，实现单条长消息内部分页。
	// 修复根因：旧实现按消息条数/整条截断，一条超长消息会把输入区顶走或整片消失。
	const startMsg = viewport ? viewport.startMsg : Math.max(0, messages.length - 60);
	const startLine = viewport ? (viewport.startLine || 0) : 0;
	const visible = startMsg > 0 ? messages.slice(startMsg) : messages;
	const rows = visible.map((m, i) => {
		const isBoundary = i === 0;
		return h(MessageRow, {
			key: typeof m.seq === "number" && m.seq >= 0 ? m.seq : `idx-${startMsg + i}`,
			message: m,
			currentNow: now,
			fromLine: isBoundary ? startLine : 0,
			maxLines: Infinity
		});
	});
	if (streaming && streaming.text) {
		rows.push(h(Box, { key: "stream" }, h(Text, { color: "cyan", bold: true }, "● "), h(Text, { dim: true }, sanitizeControlChars(String(streaming.text)))));
	}
	return h(Box, { flexDirection: "column" }, ...rows);
}

/** 落定历史（保留导出兼容；现由 ConversationList 统一渲染，此组件作为 alias 用普通渲染）。 */
export function SettledList({ messages }) {
	const settled = messages.filter((m) => typeof m.seq === "number" && m.seq >= 0 && !m.injected);
	return h(Box, { flexDirection: "column" }, settled.map((m) => h(MessageRow, { key: m.seq, message: m })));
}

export function SlashPanel({ panel }) {	if (!panel || panel.items.length === 0) return null;
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

/** 流错误横幅（P1 #7）：snapshot.error 之前不渲染，真实错误会表现成「没有输出」。 */
export function ErrorBanner({ error }) {
	if (!error) return null;
	return h(
		Box,
		{ borderStyle: "round", borderColor: "red", paddingX: 1 },
		h(Text, { color: "red", bold: true }, `✗ 错误：${String(error)}`),
		h(Text, { color: "gray" }, "  （可 Ctrl+C 中断后重发，或退出重进）")
	);
}

/** @引用文件补全面板（OpenCode 心智）：展示当前 `@xxx` 的候选文件，Tab/方向键选择。 */
export function MentionPanel({ candidates, active = 0 }) {
	if (!candidates || candidates.length === 0) return null;
	const items = candidates.map((c, i) => {
		const sel = i === active;
		return h(
			Box,
			{ key: c.file, paddingX: 1 },
			h(Text, { backgroundColor: sel ? "#4c8dff" : undefined, color: sel ? "black" : undefined, bold: sel }, `@${c.file}`)
		);
	});
	return h(Box, { borderStyle: "round", borderColor: "cyan", flexDirection: "column", marginTop: 1 }, ...items);
}

export function CommandInput({ vim }) {
	const text = submitText(vim);
	const insert = vim.mode === "insert";
	// 对标 Claude Code：输入区用上下两条细线（去绿矩形框、大号 INSERT 徽标），
	// 保留 Vim 模态但弱化：insert=`>`、normal=`:`，permission/mode 放右侧。
	const prompt = insert ? h(Text, { color: "green", bold: true }, "> ") : h(Text, { color: "yellow", bold: true }, ": ");
	const modeTag = insert
		? h(Text, { dim: true, color: "green" }, " insert")
		: h(Text, { dim: true, color: "yellow" }, " NORMAL");
	const cursorInsert = insert ? h(Text, {}, text + "▌") : h(Text, {}, text);
	return h(
		Box,
		{
			flexDirection: "column",
			// 只保留上下边框细线，去掉左右/矩形框（Claude Code 输入区分隔线风格）
			borderStyle: "single",
			borderColor: "gray",
			borderLeft: false,
			borderRight: false,
			paddingX: 1
		},
		h(
			Box,
			{ flexDirection: "row" },
			prompt,
			cursorInsert,
			h(Box, { flexGrow: 1 }),
			modeTag
		)
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

/** 工具卡片：把最近的工具调用渲染成折叠卡片（名称 + 状态 + 参数摘要 + diff 摘要）。
 *  `show`: 'collapsed'（默认，单行摘要）| 'expanded'（含 diff 预览）| 'hidden'（不渲染，连空行都不留）。 */
export function ToolCards({ tools, limit = 5, show = "collapsed" }) {
	if (!tools || tools.length === 0) return null;
	if (show === "hidden") return null;
	const recent = tools.slice(-limit);
	const rows = [];
	recent.forEach((t) => {		let badge, color;
		if (t.status === "running") {
			badge = "◐"; color = "cyan";
		} else if (t.status === "error") {
			badge = "✗"; color = "red";
		} else {
			badge = "✓"; color = "green";
		}
		// 工具迭代耗时（Claude Code 底部 "✻ Sautéed for 3s" / Codex ExecCell duration）。
		// 仅对已落定（done/error）的工具显示；running 工具没有确定结束时刻，
		// 若用 Date.now() 会累计成误导性的巨值（如 (4m 2s)）。→ 修复：running 不显示时长。
		const durLabel = t.status === "running"
			? null
			: toolDurationLabel(t.startedAt, t.finishedAt ?? undefined);
		// 工具参数压缩成单行摘要（Claude Code 风格，不外露大段 JSON）。
		const summary = toolSummary(t);
		rows.push(
			h(
				Box,
				{ key: t.callId, paddingX: 1 },
				h(Text, { color, bold: true }, `${badge} `),
				h(Text, { color: t.status === "done" ? "dim" : undefined, bold: t.status !== "done" }, `${summary}`),
				durLabel ? h(Text, { dim: true, color: "gray" }, `  ${durLabel}`) : null
			)
		);
		// diff 预览：仅 expanded 模式展示（collapsed 保持单行干净）。若工具结果带了 diff meta。
		if (show === "expanded" && t.diffMeta) {
			const dl = diffLinesFrom(t.diffMeta);
			const stats = diffStats(dl);
			if (stats.add || stats.del) {
				const guard = guardDiff(dl);
				rows.push(
					h(Box, { key: `${t.callId}-diff`, paddingX: 3 },
						h(Text, { color: stats.add ? "green" : "dim" }, `  ${diffSummary(stats)}`),
						guard.ok
							? diffPreviewLines(t.diffMeta).map((l, i) =>
									h(Box, { key: `${t.callId}-d${i}`, paddingX: 3 },
										h(Text, { color: l.startsWith("+") ? "green" : l.startsWith("-") ? "red" : "dim" }, l)
									)
								)
							: h(Text, { dim: true, color: "gray" }, `  (diff 过大，已折叠 ${dl.length} 行)`)
					)
				);
			}
		}
	});
	return h(
		Box,
		{ flexDirection: "column", maxHeight: 10 },
		...rows
	);
}

/** 取 diff 的前几行（add/del 优先，最多 6 行）用于卡片内预览。 */
function diffPreviewLines(meta) {
	const lines = diffLinesFrom(meta);
	const classified = classifyDiffLines(lines);
	const interesting = classified
		.filter((c) => c.tag === "add" || c.tag === "del")
		.map((c) => c.text);
	return interesting.slice(0, 6);
}

/** 快捷键帮助面板（`?` 触发，Claude Code 心智模型）。 */
export function HelpPanel() {
	const rows = [
		["i / A / o", "进入 insert 输入"],
		["ESC", "退出 insert；normal 下再按 ESC 清空输入"],
		["Enter", "发送"],
		["Shift+Enter / Ctrl+J", "多行输入换行"],
		["↑ / ↓（insert）", "召回最近发过的消息（历史）"],
		[":", "命令模式（:w 提交 :cancel 停止 :q 退出）"],
		["/", "斜杠命令（含 /status）"],
		["!cmd", "当作 shell 命令交给 agent（OpenCode 式）"],
		["@file", "引用文件（目录下钻，#10-20 行范围）"],
		["PgUp / PgDn", "上翻 / 下翻历史（应用内 viewport）"],
		["End", "回到底部并恢复跟随"],
		["Shift+Tab", "权限档位"],
		["Ctrl+C", "中断（运行中）/ 双按退出"],
		["Ctrl+L", "清屏"],
		["Ctrl+O", "工具卡循环：折叠 / 展开(diff) / 隐藏"],
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
		{ borderStyle: "round", borderColor: "cyan", flexDirection: "column", maxHeight: 8 },
		h(Text, { bold: true, color: "cyan" }, " 待处理队列"),
		...rows
	);
}

/** 子代理面板（Codex/Claude Code subagent 可视化）：显示主会话 fork 出的子代理。 */
export function SubagentDock({ subagents }) {
	if (!subagents || subagents.length === 0) return null;
	const rows = subagents.map((s) =>
		h(
			Box,
			{ key: s.sessionId, paddingX: 1 },
			h(Text, { color: s.running ? "cyan" : "dim" }, s.running ? "◐" : "◼"),
			h(Text, { dim: true }, `  ${String(s.sessionId).slice(0, 16)}${s.summary ? ` — ${s.summary}` : ""}`)
		)
	);
	return h(
		Box,
		{ borderStyle: "round", borderColor: "magenta", flexDirection: "column", maxHeight: 8 },
		h(Text, { bold: true, color: "magenta" }, " 子代理"),
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
	// 默认进入 insert 模态 → 打开即能直接打字（对标 Claude Code/Codex）；ESC 回 vim normal。
	const [vim, setVim] = useState(() => ({ ...createVim(), mode: "insert", insertFirst: true }));
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
	// 项目内置文档计数标签（Claude Code "1 CLAUDE.md"）
	const [docsLabel, setDocsLabel] = useState("");
	// cwd 文件列表（供 @ 引用补全；OpenCode 心智）
	const [cwdFiles, setCwdFiles] = useState([]);
	// 工具卡三态（Ctrl+O 循环）：collapsed → expanded → hidden（对标 pi-tui ToolCardVisibility）
	const [toolView, setToolView] = useState("collapsed");
	// @ 引用候选当前选中下标
	const [mentionActive, setMentionActive] = useState(0);
	// 每秒刷新时钟（pending 超时提示用）
	const [now, setNow] = useState(() => Date.now());
	// 应用级 follow-tail：scrollLines>0 表示用户上翻离开了底部（followTail=false），
	// 此时 streaming/工具/计时不得把阅读锚点拉回；End/Ctrl+End 归零回到底部。
	// 单位是「视觉行」，支持在单条超长消息内部按行分页（而不仅是整条消息）。
	const [scrollLines, setScrollLines] = useState(0);
	// 终端尺寸（columns/rows）：用于按视觉行预算裁剪消息区，长历史不顶走输入区；resize 会触发重渲染。
	const { columns, rows } = useWindowSize();

	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, []);

	// 项目文档计数 + 文件/目录列表（供 @ 引用补全，含嵌套路径以支持目录下钻）：
	// 仅在 cwd 变化时用有界 BFS 扫一次，避免每帧重读。
	useEffect(() => {
		const cwd = (liveSession && liveSession.cwd) || "";
		if (!cwd) { setDocsLabel(""); setCwdFiles([]); return; }
		let cancelled = false;
		try {
			const { readdirSync } = require("node:fs");
			const { join } = require("node:path");
			const topNames = readdirSync(cwd, { encoding: "utf8" });
			// @ 目录下钻：注入 fs 的 listDir（返回 { files, dirs }），产出嵌套相对路径。
			const listDir = (relDir) => {
				const full = relDir ? join(cwd, relDir) : cwd;
				const out = { files: [], dirs: [] };
				let ents;
				try { ents = readdirSync(full, { withFileTypes: true }); } catch { return out; }
				for (const e of ents) {
					if (e.name.startsWith(".")) continue;
					if (e.isDirectory()) out.dirs.push(e.name);
					else out.files.push(e.name);
				}
				return out;
			};
			if (!cancelled) {
				setDocsLabel(projectDocsLabel(topNames));
				const scan = scanWorkspace(listDir, { maxEntries: 4000, maxDepth: 5 });
				setCwdFiles([...scan.files, ...scan.dirs]);
			}
		} catch { if (!cancelled) { setDocsLabel(""); setCwdFiles([]); } }
		return () => { cancelled = true; };
	}, [liveSession && liveSession.cwd]);

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
		// 启动 history 轮询兜底：mux 断帧时回复仍能从 history 到达。
		if (typeof conv.startHistorySync === "function") conv.startHistorySync();
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

	// 周期刷新子代理面板（只读状态板；无该方法（如测试/嵌入）则跳过）。
	useEffect(() => {
		if (typeof conv.refreshSubagents !== "function") return;
		conv.refreshSubagents().catch(() => {});
		const t = setInterval(() => conv.refreshSubagents().catch(() => {}), 5000);
		return () => clearInterval(t);
	}, [conv]);

	const hud = hudState({ view: snapshot, session: liveSession, now });

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
		const hasPendingApproval = snapshot.pendingApprovals && snapshot.pendingApprovals.length > 0;
		if (hasPendingApproval && !key.ctrl) {
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
		// 批准是模态：未点 y/Y/n 时，吞掉其余普通键，避免审批弹窗时把字符输进输入框
		// （Claude Code 审批卡同款「模态锁定」）。全局键（Ctrl+C 中断、Ctrl+L 清屏等）在其下处理。
		if (hasPendingApproval && !key.ctrl && !key.meta && !key.alt && !key.escape) {
			// 仍允许 Tab/方向键导航审批列表？当前只答第一项，故直接吞掉防键入。
			return;
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
		// Codex 式 Ctrl+L 清屏：清终端滚动区，不清对话历史。
		if (key.ctrl && (input === "l" || input === "L")) {
			try { process.stdout.write("\x1b[2J\x1b[H"); } catch { /* 非 TTY 静默 */ }
			return;
		}
		// pi-tui/Claude Code 式工具卡三态循环：Ctrl+O 在 collapsed → expanded → hidden 间切换。
		if (key.ctrl && (input === "o" || input === "O")) {
			setToolView((v) => (v === "collapsed" ? "expanded" : v === "expanded" ? "hidden" : "collapsed"));
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
		// 应用级历史翻页（不依赖 WT 原生 scrollback）：PageUp/PageDown 按「视觉行页」翻，End 回底部。
		// scrollLines>0 表示离开底部；新内容到达不会拉回（followTail=false 语义）。
		const pageLines = Math.max(3, Math.floor((rows || 30) / 2)); // 一页≈半个消息区高，行级粒度
		if (key.pageUp) { setScrollLines((o) => o + pageLines); return; }
		if (key.pageDown) { setScrollLines((o) => Math.max(0, o - pageLines)); return; }
		if ((key.end) || (key.ctrl && key.end)) { setScrollLines(0); return; }

		const currentText = submitText(vim);
		// @ 文件引用补全面板导航（OpenCode 心智）：Tab/方向键循环，Enter 把选中文件插入输入。
		const curMention = detectIntent(currentText);
		const curMentionCands = curMention.kind === "mention" ? buildMentionCandidates(curMention.rest, cwdFiles, 8) : [];
		if (curMentionCands.length > 0) {
			if (key.tab && !key.shift) { setMentionActive((a) => (a + 1) % curMentionCands.length); return; }
			if (key.downArrow) { setMentionActive((a) => (a + 1) % curMentionCands.length); return; }
			if (key.upArrow) { setMentionActive((a) => (a - 1 + curMentionCands.length) % curMentionCands.length); return; }
			if (key.return) {
				const sel = curMentionCands[((mentionActive % curMentionCands.length) + curMentionCands.length) % curMentionCands.length];
				if (sel) {
					// 用整 token 替换语义插入（含空格自动 quoted：`@"path"`，对标 pi-tui）。
					const ref = mentionRef(sel.file);
					setVim({ ...vim, lines: [ref], cursor: { row: 0, col: ref.length }, pending: "" });
				}
				return;
			}
		}
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

		// 用全局 mode 状态机决定 ↑/↓ 归属：补全面板态归 panel，否则对话态才允许历史召回。
		// 这是 lib/mode.js keyOwner 的应用——让键位归属表成为单一决策源。
		const uiModeStr = curMentionCands.length || (buildSlashPanel(submitText(vim), allCommandsFn(customCommands), { active: slashActive })?.items?.length > 0) ? "complete" : "chat";
		// Claude Code 心智：编辑输入时（insert、单行 buffer）用 ↑/↓ 召回最近发过的消息。
		// KeyOwner 判定 ↑ 归 history/global 时才触发；补全面板打开时归 panel 不触发。
		if ((key.upArrow || key.downArrow) && vim.mode === "insert" && vim.lines.length === 1) {
			const owner = keyOwner(uiModeStr, { key: key.upArrow ? "up" : "down" });
			if (owner === "global" || owner === "history") {
				const r = navigateHistory(history, key.upArrow ? "up" : "down", submitText(vim));
				setHistory(r.history);
				if (r.text !== null) {
					setVim({ ...createVim(), mode: "insert", insertFirst: true, lines: [r.text], cursor: { row: 0, col: r.text.length } });
				}
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
			// OpenCode 式 `!cmd` shell 模式：明确标注为 shell 命令，交给 agent/host 执行。
			if (text.trim().startsWith("!")) {
				const cmd = text.trim().slice(1);
				if (cmd) {
					setHistory((h) => pushHistory(h, text));
					conv.send(`运行 shell 命令：${cmd}`).catch(() => {});
				}
				setVim({ ...createVim(), mode: "insert" });
				return;
			}
			if (text.trim()) {
				setHistory((h) => pushHistory(h, text));
				conv.send(text).catch(() => {});
			}
			// 发送后清空输入框，回到空 insert（对标 Claude Code：发送即清屏）
			setVim({ ...createVim(), mode: "insert" });
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
	// @ 文件引用补全（OpenCode 心智）：输入以 @ 开头时按当前输入过滤 cwd 文件。
	const mentionIntent = detectIntent(text);
	const mentionCandidates = mentionIntent.kind === "mention"
		? buildMentionCandidates(mentionIntent.rest, cwdFiles, 8)
		: [];
	// 回合耗时入消息流（Claude Code `✻ Worked for 8s`）：仅当一回合刚完成且有时钟时显示，
	// 避免一直占着 HUD；运行时 HUD 已不再重复显示 ⏱（item ④ 已去掉）。
	const workedLabel = (() => {
		if (snapshot.running) return null;
		if (!snapshot.turnStartTime || !snapshot.lastTurnEnd) return null;
		// 用回合真实结束时间 turnEndedAt 计算时长（旧实现用会继续增长的 now，导致已完成回合的数字每秒上涨）。
		const endAt = snapshot.turnEndedAt ?? now;
		const dur = formatDuration(endAt - snapshot.turnStartTime);
		// 追加分相计时（Thinking/Response/Tools），如 `✻ Worked for 8s · Thinking 2.0s`
		const phase = snapshot.phaseTiming ? ` · ${snapshot.phaseTiming}` : "";
		return dur ? `✻ Worked for ${dur}${phase}` : snapshot.phaseTiming;
	})();

	// 运行中阶段反馈（P1 #6）：不暴露私有思维链，只显示安全阶段 + 已耗时。
	// reasoning-delta → thinking；text-delta → responding；tool-call → tools。
	const PHASE_LABEL = { thinking: "思考", responding: "生成", tools: "工具执行" };
	const runningPhaseLabel = (() => {
		if (!snapshot.running) return null;
		const phase = snapshot.activePhase;
		const elapsed = snapshot.turnStartTime ? formatDuration(now - snapshot.turnStartTime) : "";
		const label = phase ? PHASE_LABEL[phase] ?? phase : "运行中";
		const spinner = snapshot.running ? "◐" : "";
		return `${spinner} ${label}${elapsed ? ` · ${elapsed}` : ""}（Ctrl+C 中断）`;
	})();

	// 计算消息区可视预算：终端高 − 固定元素（banner/hud/input/worked/docks/余量），
	// 再用 windowViewport 得到「行级窗口」起始消息 + 消息内起始行。修 root cause：
	// 消息条数/整条截断改为行级视口截断，单条超长消息内也可分页。
	const docksRows =
		((snapshot.pendingApprovals && snapshot.pendingApprovals.length ? 3 + snapshot.pendingApprovals.length : 0) +
			((snapshot.tools && snapshot.tools.length ? Math.min(snapshot.tools.length, 5) + 1 : 0)) +
			((snapshot.queue && snapshot.queue.length ? Math.min(snapshot.queue.length, 3) + 1 : 0)) +
			((snapshot.subagents && snapshot.subagents.length ? Math.min(snapshot.subagents.length, 3) + 1 : 0)));
	// 流式正文也纳入固定高度预算（避免增长中的正文把输入区顶走）。
	const streamRows = snapshot.streaming && snapshot.streaming.text
		? Math.ceil(displayWidth(snapshot.streaming.text) / Math.max(1, columns - 6))
		: 0;
	const msgBudget = messageBudget(rows || 30, {
		banner: 2,
		hud: 1,
		input: 2,
		worked: workedLabel ? 1 : 0,
		stream: streamRows,
		phase: runningPhaseLabel ? 1 : 0,
		docks: docksRows,
		margin: 2
	});
	// 行级视口：windowViewport 产出 { startMsg, startLine }；贴底(scrollLines=0)跟随最新尾部，
	// scrollLines>0 则按视觉行上翻（支持单条长消息内部分页）。绝不返回空窗口。
	const viewport = windowViewport(snapshot.messages, msgBudget, columns || 80, scrollLines);

	return h(
		Box,
		{ flexDirection: "column", flexGrow: 1 },
		// 消息区：全部消息 + 流式草稿（普通渲染，一次可见，不用 <Static> 以避免漏显）。
		h(Box, { flexDirection: "column", flexGrow: 1, minHeight: 2 },
			h(Banner, { hud }),
			runningPhaseLabel
				? h(Box, { key: "running-phase", paddingX: 1 }, h(Text, { color: "cyan", bold: true }, runningPhaseLabel))
				: null,
			ConversationList({ messages: snapshot.messages, streaming: snapshot.streaming, now, viewport }),
			workedLabel
				? h(Box, { key: "worked", marginTop: 1 }, h(Text, { dim: true, color: "gray" }, workedLabel))
				: null,
			scrollLines > 0
				? h(Box, { key: "follow-hint", marginTop: 1 },
						h(Text, { dim: true, color: "cyan" }, "↓ 上面还有历史 · End 回到底部"))
				: null,
			snapshot.messages.length === 0 && !(snapshot.streaming && snapshot.streaming.text)
				? h(Box, { key: "empty", flexDirection: "column", marginTop: 1 },
						h(Text, { dim: true }, "开始对话 — 直接输入并按 Enter 发送。"),
						h(Text, { dim: true, color: "gray" }, "/ 命令 · @ 文件引用 · ! shell 命令 · i/a/o 输入 · ESC 回 normal · Ctrl+C 中断/双按退出 · ? 帮助"))
				: null
		),
		showHelp ? h(HelpPanel, {}) : null,
		snapshot.reconnecting
			? h(Box, { borderStyle: "round", borderColor: "yellow" }, h(Text, { bold: true, color: "yellow" }, ` ⏳ 正在重连… ${snapshot.reconnecting.n}/${snapshot.reconnecting.max}`))
			: null,
		h(PendingApprovals, { approvals: snapshot.pendingApprovals }),
		h(ToolCards, { tools: snapshot.tools, show: toolView }),
		h(QueueDock, { queue: snapshot.queue }),
		h(SubagentDock, { subagents: snapshot.subagents }),
		mentionCandidates.length > 0 ? h(MentionPanel, { candidates: mentionCandidates, active: mentionActive }) : null,
		h(SlashPanel, { panel: slashPanel }),
		h(Notice, { notice: snapshot.notice }),
		h(ErrorBanner, { error: snapshot.error }),
		// HUD 放在输入框上方（贴近底部）——用户从最底部输入，HUD 常驻可见
		h(HUD, { hud }),
		h(CommandInput, { vim })
	);
}

// slash 面板命令源：内置 + 本地 + 自定义
import { createRequire } from "node:module";
import { allCommands as allCommandsFn } from "../lib/commands.js";
import { loadCustomCommands } from "../lib/command-loader.js";
import { createHistory, pushHistory, navigateHistory } from "../lib/history.js";
import { diffLinesFrom, classifyDiffLines, diffStats, diffSummary, guardDiff } from "../lib/diff.js";
import { deriveMode, modeLabel } from "../lib/ui-mode.js";
import { projectDocsLabel } from "../lib/docs.js";
import { detectIntent, buildMentionCandidates, mentionRef } from "../lib/mention.js";
import { toolSummary } from "../lib/tool-summary.js";
import { cachedParseMarkdown, inlineFragments } from "../lib/markdown.js";
import { windowViewport, messageBudget, displayWidth } from "../lib/viewport.js";
import { sanitizeControlChars } from "../lib/safety.js";
import { scanWorkspace } from "../lib/scan.js";

const require = createRequire(import.meta.url);
