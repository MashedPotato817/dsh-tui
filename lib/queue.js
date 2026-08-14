// lib/queue.js — 异步 FIFO 模态队列（纯逻辑、可注入 timer/信号、可单测）。
// 对标 pi-tui overlay-manager TuiOverlayManager：同一时刻只有一项拥有焦点/执行，
// 先来先服务（FIFO），关闭后 queueMicrotask 轮转下一项，AbortSignal 贯穿取消。
// 纯实现不绑定 UI：队列项是「异步工作单元」，UI 回调在真正要执行时被调用。
// 供后续对话框/审批/问题弹窗接 modal 队列用（Batch 3 架构）。

export function createModalQueue({ now = Date.now } = {}) {
	const queue = [];
	let active = null;
	let nextId = 1;

	return {
		/**
		 * 入队一项工作；返回它的 Promise（完成时 resolve，被取消时 reject AbortError）。
		 * @param {string} what - 描述（调试/日志）。
		 * @param {(signal: AbortSignal) => Promise<void>} run - 当它轮到且获得焦点时执行。
		 * @param {object} [opts]
		 * @param {number} [opts.priority=0] - 越大越优先（同优先级 FIFO）。
		 * @returns {{ id: number, result: Promise<void>, cancel: () => void }}
		 */
		enqueue(what, run, opts = {}) {
		const id = nextId++;
		const controller = new AbortController();
		const result = new Promise((resolve, reject) => {
			queue.push({ id, what, run, signal: controller.signal, priority: opts.priority ?? 0, resolve, reject });
			queue.sort((a, b) => b.priority - a.priority || a.id - b.id); // 优先＋FIFO
			pump();
		});
		return { id, result, cancel: () => controller.abort() };
	},
	/** 当前持有焦点的工作 id（无则 null）。 */
	activeId() { return active ? active.id : null; },
	/** 排队中（不含 active）数量。 */
	queuedCount() { return queue.length; },
	/** 是否仍有激活或排队项。 */
	hasPending() { return !!active || queue.length > 0; },
};

	function pump() {
		if (active) return; // 单焦点，已有激活项
		if (queue.length === 0) return;
		const item = queue.shift();
		active = item;
		const { signal, run, resolve, reject } = item;
		// 已取消（入队后又被 cancel）→ 直接拒绝，并轮转下一项
		if (signal.aborted) {
			active = null;
			reject(signal.reason ?? new Error("Aborted"));
			pump();
			return;
		}
		signal.addEventListener("abort", () => {
			if (active === item) { active = null; reject(signal.reason ?? new Error("Aborted")); pump(); }
		}, { once: true });
		// 执行工作；完成后 queueMicrotask 轮转下一项（不阻塞）
		Promise.resolve()
			.then(() => run(signal))
			.then(
				() => { if (active === item) { active = null; resolve(); queueMicrotask(() => pump()); } },
				(e) => { if (active === item) { active = null; reject(e); queueMicrotask(() => pump()); } }
			);
	}
}
