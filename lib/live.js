/**
 * LiveConversation：会话的实时视图。
 *
 * 数据流：history 页做基线折叠（权威） → mux SSE 流增量折叠（实时）。
 * 增量按 seq 去重，assistant/chunk 不进消息列表而是累积成「流式草稿」，
 * assistant/message 到达时草稿落定进消息。UI 只消费 onState 推来的快照。
 *
 * 纯业务层：不依赖 React/Ink，测试用 fake client + fake stream 直接喂。
 */
import { foldEvents } from "./fold.js";
import { MuxStream } from "./stream.js";

/** 初始视图快照。 */
export function initialState() {
	return {
		messages: [],
		tools: [],
		turn: 0,
		lastTurnEnd: null,
		lastSeq: -1,
		streaming: null, // { text, usage } — 未落定的 assistant 草稿
		running: false,
		model: null, // 最新 request/header 里的模型
		pendingQuestions: [],
		queue: [],
		jobs: [],
		notice: null, // 临时提示（slash 命令结果等）
		connected: false,
		error: null
	};
}

/** 按 seq 去重合并新事件（事件按 seq 严格递增，batch 内保持顺序）。 */
function mergeBySeq(events, minSeq) {
	const fresh = [];
	for (const event of events) {
		if (typeof event.seq === "number" && event.seq > minSeq) fresh.push(event);
	}
	fresh.sort((a, b) => a.seq - b.seq);
	return fresh;
}

export class LiveConversation {
	/**
	 * @param {object} deps
	 * @param {import("./client.js").DshClient} deps.client
	 * @param {import("./session.js").Session} deps.session
	 * @param {MuxStream} [deps.stream]
	 * @param {(state: object) => void} [deps.onState]
	 */
	constructor({ client, session, stream, onState }) {
		this.client = client;
		this.session = session;
		this.stream = stream ?? new MuxStream(client.baseUrl);
		this.onState = onState ?? (() => {});
		this.state = initialState();
		this.ac = new AbortController();
		this._draftBlocks = new Map(); // index → { type, text, name?, id? }
		this._draftUsage = null;
	}

	/** 视图快照（浅拷贝，React 可直接 setState）。 */
	snapshot() {
		return { ...this.state };
	}

	emit() {
		this.onState(this.snapshot());
	}

	/**
	 * 打开会话：拉 history 基线折叠，然后消费 mux 流直到 close()。
	 * 流断开会重连（退避重试），每次重连后重新拉基线（since 在 v1 未实现）。
	 */
	async open() {
		await this.#baseline();
		this.emit();
		this.#consume().catch(() => {}); // 内部已容错，不向上抛
	}

	async #baseline() {
		const page = await this.session.history({ maxMessages: 128 });
		const view = foldEvents(page.events);
		this.state = {
			...this.state,
			messages: view.messages,
			tools: view.tools,
			turn: view.turn,
			lastTurnEnd: view.lastTurnEnd,
			lastSeq: view.lastSeq,
			model: view.model ?? this.state.model,
			connected: true
		};
	}

	async #consume() {
		let attempts = 0;
		for (;;) {
			if (this.ac.signal.aborted) return;
			try {
				for await (const frame of this.stream.frames({ signal: this.ac.signal })) {
					attempts = 0;
					this.#onFrame(frame);
				}
				return; // 流自然结束（服务端关闭）
			} catch (error) {
				if (this.ac.signal.aborted) return;
				attempts += 1;
				if (attempts > 6) {
					this.state.error = `mux 流重连失败：${error.message}`;
					this.emit();
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 250 * 2 ** attempts)));
				try {
					await this.#baseline(); // 重连后重新对齐基线
					this.emit();
				} catch {
					// 基线失败也继续重试
				}
			}
		}
	}

	#onFrame(frame) {
		if (frame.sessionId && frame.sessionId !== this.session.sessionId) return;
		switch (frame.type) {
			case "session/subscribed": {
				if (frame.lastSeq > this.state.lastSeq) {
					this.state.lastSeq = frame.lastSeq;
					this.emit();
				}
				break;
			}
			case "session/event": {
				this.#onEvent(frame.event);
				break;
			}
			case "question/requested": {
				this.state.pendingQuestions = [...this.state.pendingQuestions, ...frame.questions];
				this.emit();
				break;
			}
			case "question/resolved": {
				this.state.pendingQuestions = this.state.pendingQuestions.filter(
					(q) => q.rpcId !== frame.questionRpcId
				);
				this.emit();
				break;
			}
			case "session/queue": {
				this.state.queue = frame.items;
				this.emit();
				break;
			}
			case "session/jobs": {
				this.state.jobs = frame.jobs;
				this.emit();
				break;
			}
			case "stream/error": {
				this.state.error = `${frame.error.code}: ${frame.error.message}`;
				this.emit();
				break;
			}
			default:
				break;
		}
	}

	#onEvent(event) {
		if (event.type === "assistant/chunk") {
			this.#applyChunk(event.data.chunk);
			return; // chunk 不参与折叠
		}
		if (event.type === "assistant/message") {
			// 草稿落定：chunk 流的最终值以 assistant/message 为准，清空流式草稿
			this._draftBlocks.clear();
			this._draftUsage = null;
			this.state.streaming = null;
		}
		if (event.type === "turn/start") this.state.running = true;
		if (event.type === "turn/end") this.state.running = false;

		const fresh = mergeBySeq([event], this.state.lastSeq);
		if (fresh.length === 0) return;
		this.state.lastSeq = Math.max(this.state.lastSeq, event.seq);

		if (event.type === "user/message") {
			// 用真实事件替换乐观回显行（FIFO：先发先到，替换最早那条 pending）
			const view = foldEvents([{ event }]);
			const optimistic = this.state.messages.findIndex((m) => m.pending);
			if (optimistic !== -1) {
				this.state.messages[optimistic] = { ...view.messages[0] };
				this.emit();
				return;
			}
			this.state.messages = [...this.state.messages, ...view.messages];
			this.emit();
			return;
		}

		const view = foldEvents([{ event }]);
		if (view.messages.length) this.state.messages = [...this.state.messages, ...view.messages];
		if (view.tools.length) this.state.tools = [...this.state.tools, ...view.tools];
		if (view.turn > this.state.turn) this.state.turn = view.turn;
		if (view.lastTurnEnd) this.state.lastTurnEnd = view.lastTurnEnd;
		if (view.model) this.state.model = view.model;
		this.emit();
	}

	#applyChunk(chunk) {
		const draft = this._draftBlocks;
		switch (chunk.type) {
			case "block-start": {
				draft.set(chunk.index, { type: chunk.blockType, text: "" });
				break;
			}
			case "text-delta": {
				const block = draft.get(chunk.index) ?? { type: "text", text: "" };
				block.text += chunk.text;
				draft.set(chunk.index, block);
				break;
			}
			case "reasoning-delta": {
				const block = draft.get(chunk.index) ?? { type: "reasoning", text: "" };
				block.text += chunk.text;
				draft.set(chunk.index, block);
				break;
			}
			case "tool-call-delta": {
				const block = draft.get(chunk.index) ?? { type: "tool-call", id: chunk.id, name: "", arguments: "" };
				block.id = chunk.id;
				if (chunk.name) block.name = chunk.name;
				block.arguments = (block.arguments ?? "") + (chunk.argumentsDelta ?? "");
				draft.set(chunk.index, block);
				break;
			}
			case "block-end": {
				draft.set(chunk.index, { type: chunk.block.type, text: chunk.block.text ?? "" });
				break;
			}
			case "usage": {
				this._draftUsage = chunk.usage;
				break;
			}
			case "finish":
				break;
			default:
				break;
		}
		this.state.streaming = this.#draftView();
		this.emit();
	}

	#draftView() {
		const text = [...this._draftBlocks.values()]
			.filter((block) => block.type === "text" && block.text)
			.map((block) => block.text)
			.join("\n");
		if (!text && !this._draftUsage) return null;
		return { text, usage: this._draftUsage ?? null };
	}

	/**
	 * 发送一条消息。普通消息乐观回显 user 行；/ 开头走 host 命令注册表（不乐观回显，
	 * 命令结果放进 notice）。
	 */
	async send(text) {
		const isCommand = text.startsWith("/");
		if (!isCommand) {
			this.state.messages = [
				...this.state.messages,
				{ role: "user", seq: -1, time: Date.now(), text, pending: true }
			];
			this.state.notice = null;
			this.emit();
		}
		try {
			const res = await this.session.prompt(text);
			if (res.command) {
				this.state.notice = res.command.text ?? `已执行 ${text}`;
				this.emit();
			}
			return res;
		} catch (error) {
			this.state.messages = this.state.messages.filter((m) => m.seq !== -1 || !m.pending);
			this.state.notice = `发送失败：${error.message}`;
			this.emit();
			throw error;
		}
	}

	close() {
		this.ac.abort();
	}
}
