// 单元飞轮：异步 FIFO 模态队列（单焦点、先进先出、优先、AbortSignal 取消）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createModalQueue } from "../lib/queue.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

test("FIFO：单焦点串行执行，先进先出", async () => {
	const q = createModalQueue();
	const order = [];
	q.enqueue("a", async () => { order.push("a"); await tick(); });
	q.enqueue("b", async () => { order.push("b"); await tick(); });
	q.enqueue("c", async () => { order.push("c"); await tick(); });
	// 每项 5ms×3，逐一轮转；充足等待以覆盖全部 settle + queueMicrotask 轮转
	await tick(); await tick(); await tick(); await tick(); await tick();
	assert.deepEqual(order, ["a", "b", "c"], "应按入队顺序串行执行");
	assert.equal(q.hasPending(), false);
});

test("单焦点：active 进行时可再入队，但直到它完成才轮到下一个", async () => {
	const q = createModalQueue();
	let releaseSlow;
	const slow = q.enqueue("slow", () => new Promise((res) => { releaseSlow = res; }));
	await tick();
	assert.equal(q.activeId(), slow.id, "第一项持有焦点");
	q.enqueue("fast", () => {});
	await tick();
	assert.equal(q.queuedCount(), 1, "active 未完成时下一项在排队不执行");
	releaseSlow();
	await slow.result;
	await tick();
	assert.equal(q.hasPending(), false);
});

test("queueMicrotask 轮转：active 完成自动激活下一个（不等入队方手动）", async () => {
	const q = createModalQueue();
	const run = [];
	q.enqueue("x", async () => { run.push("x"); await tick(); });
	q.enqueue("y", async () => { run.push("y"); await tick(); });
	await tick();
	await tick();
	assert.deepEqual(run, ["x", "y"], "完成后应自动 pump 下一个");
});

test("优先级：同类优先插队，但不抢占正在执行项", async () => {
	const q = createModalQueue();
	const order = [];
	let releaseSlow;
	// n-slow 先入队并立即持有焦点（无法被抢占）
	q.enqueue("n-slow", () => new Promise((res) => { releaseSlow = res; }));
	await tick();
	assert.equal(q.activeId() !== null, true, "第一项持有焦点");
	// active 进行中入队：高优先 p1/p2 与普通 n2，仅对排队项按优先排序
	q.enqueue("n2", async () => { order.push("n2"); }, { priority: 0 });
	q.enqueue("p2", async () => { order.push("p2"); }, { priority: 1 });
	q.enqueue("p1", async () => { order.push("p1"); }, { priority: 1 });
	releaseSlow();
	await tick(); await tick(); await tick(); await tick(); await tick();
	assert.deepEqual(order, ["p2", "p1", "n2"], "同优先 FIFO、高优先前置于普通");
	assert.equal(q.hasPending(), false);
});

test("enqueue 返回 cancel：取消未开始项，不阻塞后续", async () => {
	const q = createModalQueue();
	const slow = q.enqueue("slow", () => new Promise((res) => setTimeout(res, 20)));
	const doomed = q.enqueue("doomed", () => {});
	await tick();
	assert.equal(q.activeId(), slow.id);
	doomed.cancel();
	await slow.result;
	await assert.rejects(doomed.result, /aborted/i, "被取消项应 reject AbortError");
	await tick();
	assert.equal(q.hasPending(), false, "被取消项不阻塞后续");
});
