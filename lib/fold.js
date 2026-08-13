/**
 * 事件折叠：把会话事件页（session.history / mux 流帧）折成对话视图。
 *
 * 这是客户端「共享 fold」的 TUI 最小实现（milestone 2 的事件接缝）：
 * 纯函数、无状态 —— 任何事件源（history 页、SSE 帧、live 轮询）都可以喂给它，
 * 得到同一份对话视图，UI 层只消费 view，不直接摸事件。
 *
 * 输入：HistoryEntry[]（`{ event, view? }`），或裸 SessionEvent（兼容两种喂法）。
 * 输出：`{ messages, tools, turn, lastTurnEnd, lastSeq }`。
 *
 * 折叠规则（与 host 派生历史同构的最小集）：
 * - `user/message` / `assistant/message` → messages（提取全部 text 块，按行连接）。
 * - `tool/call` → tools（callId + name，供 HUD 显示工具调用计数）。
 * - `turn/start` / `turn/end` → 推进 turn、记录 lastTurnEnd（含 reason）。
 * - 未知 / 可忽略事件安全跳过（merge-extensible 词汇增长的兜底）。
 */

/** 从 ContentBlock[] 中提取可见文本（text 块连接；reasoning 等不计入）。 */
function textOf(content) {
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block && block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

/**
 * 折叠一页事件。
 * @param {Array<{event?: object, ...}|object>} entries - history 页（HistoryEntry[]）或裸事件数组。
 */
export function foldEvents(entries = []) {
	const messages = [];
	const tools = [];
	let turn = 0;
	let lastTurnEnd = null;
	let lastSeq = -1;
	let model = null;

	for (const entry of entries) {
		const event = entry && entry.event ? entry.event : entry;
		if (!event || typeof event.type !== "string") continue;
		if (typeof event.seq === "number" && event.seq > lastSeq) lastSeq = event.seq;
		const data = event.data ?? {};

		switch (event.type) {
			case "turn/start": {
				if (typeof data.turn === "number" && data.turn > turn) turn = data.turn;
				break;
			}
			case "turn/end": {
				lastTurnEnd = { turn: data.turn ?? turn, reason: data.reason ?? null, seq: event.seq };
				break;
			}
			case "request/header": {
				// 记录本轮请求用的模型（HUD 显示用；config 里 provider/model 是权威）
				const config = data.header && data.header.config;
				if (config && typeof config.model === "string") model = config.model;
				break;
			}
			case "user/message": {
				messages.push({
					role: "user",
					seq: event.seq,
					time: event.time,
					text: textOf(data.content)
				});
				break;
			}
			case "assistant/message": {
				messages.push({
					role: "assistant",
					seq: event.seq,
					time: event.time,
					text: textOf(data.message && data.message.content),
					usage: data.usage ?? null
				});
				break;
			}
			case "tool/call": {
				tools.push({ seq: event.seq, callId: data.callId, name: data.name });
				break;
			}
			default:
				// tool/result、assistant/chunk、todo/write、request/header、未知事件：
				// 飞轮阶段不渲染工具卡片，安全跳过，不影响折叠。
				break;
		}
	}

	return { messages, tools, turn, lastTurnEnd, lastSeq, model };
}

/** 取折叠视图的最后一条 assistant 消息（无则 null）。 */
export function lastAssistantText(view) {
	if (!view) return null;
	for (let i = view.messages.length - 1; i >= 0; i--) {
		if (view.messages[i].role === "assistant") return view.messages[i].text;
	}
	return null;
}
