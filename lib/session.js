/**
 * 会话模型：DSH host 上一个会话的客户端视图。
 *
 * milestone 2 的核心：把 session.create / session.prompt / session.history
 * 封装成「建会话 → 发消息 → 等轮结束 → 折叠视图」的最小闭环。
 * 任何 UI（Ink 界面、CLI 一次性调用、VSCode 侧栏）都只依赖这一层。
 */
import { foldEvents } from "./fold.js";

/**
 * PTC 模式 = DSH `code` agent preset：
 * 具备标准模式全部能力，并通过 Code Mode SDK 呈现工具 —— 模型写一个
 * TypeScript 程序由 run_code 执行，多步操作一次往返。TUI 默认用它建会话。
 */
export const PTC_PRESET = "code";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Session {
	/**
	 * @param {import("./client.js").DshClient} client - 载体（或实现 request(method, payload) 的替身）。
	 * @param {string} sessionId - host 上持久化的会话 id。
	 * @param {{ agentPreset?: string|null, cwd?: string|null }} [meta]
	 */
	constructor(client, sessionId, { agentPreset = null, cwd = null } = {}) {
		this.client = client;
		this.sessionId = sessionId;
		this.agentPreset = agentPreset;
		this.cwd = cwd;
	}

	/** 列出 host 上全部会话（updatedAt 降序）。 */
	static async list(client) {
		const { items } = await client.request("session.list", {});
		return items;
	}

	/**
	 * 新建会话，默认 PTC 模式（agentPreset: "code"），可用 opts.agentPreset 覆盖。
	 * @param {import("./client.js").DshClient} client
	 * @param {{ cwd?: string, agentPreset?: string, sessionId?: string }} [opts]
	 */
	static async create(client, { cwd, agentPreset = PTC_PRESET, sessionId } = {}) {
		const payload = {};
		if (cwd) payload.cwd = cwd;
		if (agentPreset) payload.agentPreset = agentPreset;
		if (sessionId) payload.sessionId = sessionId;
		const { sessionId: id, agentPreset: resolved } = await client.request("session.create", payload);
		return new Session(client, id, { agentPreset: resolved ?? agentPreset, cwd });
	}

	/** 复用 host 上已存在的会话（找不到抛 session-not-found）。 */
	static async open(client, sessionId) {
		const items = await Session.list(client);
		const found = items.find((item) => item.sessionId === sessionId);
		if (!found) {
			const error = new Error(`session not found: ${sessionId}`);
			error.code = "session-not-found";
			throw error;
		}
		return new Session(client, sessionId, {
			agentPreset: found.agentPreset ?? null,
			cwd: found.cwd ?? null
		});
	}

	/** 读一页历史（事件页按消息边界对齐；不带动 agent，读存储）。 */
	async history({ beforeSeq, maxMessages } = {}) {
		const payload = { sessionId: this.sessionId };
		if (beforeSeq !== undefined) payload.beforeSeq = beforeSeq;
		if (maxMessages !== undefined) payload.maxMessages = maxMessages;
		return this.client.request("session.history", payload);
	}

	/** 发送一条文本消息（mode: queue=排队发送 / steer=插队引导）。 */
	async prompt(text, { mode = "queue" } = {}) {
		return this.client.request("session.prompt", {
			sessionId: this.sessionId,
			mode,
			content: [{ type: "text", text }]
		});
	}

	/**
	 * 最小闭环：发消息 → 轮询 history 直到本轮的 turn/end → 返回折叠视图。
	 *
	 * 以 prompt 前的 lastSeq 为基线，只认基线之后出现的 turn/end（避免复用时
	 * 把旧轮当作本轮）。turn 以 error 结束会抛出 turn-error；超时抛 turn-timeout。
	 *
	 * @param {string} text - 要发送的文本。
	 * @param {{ timeoutMs?: number, pollMs?: number }} [opts]
	 * @returns {Promise<{messages, tools, turn, lastTurnEnd, lastSeq, accepted: true}>}
	 */
	async converse(text, { timeoutMs = 120_000, pollMs = 500 } = {}) {
		const before = await this.history({ maxMessages: 1 });
		const baseSeq = before.events.length
			? Math.max(...before.events.map((entry) => entry.event.seq))
			: -1;

		const res = await this.prompt(text);
		if (res.command) {
			// 以 / 开头的消息走 host 命令注册表，不进模型 —— 折叠当前页即可返回。
			const view = foldEvents(before.events);
			return { ...view, accepted: true, command: res.command, turnEnd: view.lastTurnEnd };
		}

		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const page = await this.history({ maxMessages: 64 });
			const view = foldEvents(page.events);
			const turnEnd = view.lastTurnEnd;
			if (turnEnd && view.lastSeq > baseSeq) {
				const reason = turnEnd.reason;
				if (reason && reason.kind === "error") {
					const error = new Error(
						`turn error: ${(reason.error && reason.error.message) || "unknown"}`
					);
					error.code = "turn-error";
					error.reason = reason;
					throw error;
				}
				return { ...view, accepted: true, turnEnd };
			}
			await sleep(pollMs);
		}

		const error = new Error(`turn not finished within ${timeoutMs}ms`);
		error.code = "turn-timeout";
		throw error;
	}
}
