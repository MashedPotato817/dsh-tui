// 单元飞轮：应答策略 — question/approval → client-response payload。
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerQuestions, answerApproval, hasPlanReview, declinePlan } from "../lib/policy.js";

const q = (id = "q1", options = [{ label: "是" }, { label: "否" }]) => ({
	id,
	question: "继续？",
	options
});

test("answerQuestions：普通问询默认选第一个选项", () => {
	const payload = answerQuestions("session-1", [q("a"), q("b", [{ label: "x" }, { label: "y" }])]);
	assert.equal(payload.sessionId, "session-1");
	assert.deepEqual(payload.answer.answers, [
		{ id: "a", selected: ["是"] },
		{ id: "b", selected: ["x"] }
	]);
});

test("answerQuestions：多选问题也选第一个（保守）", () => {
	const payload = answerQuestions("s", [{ ...q("m"), multiSelect: true }]);
	assert.equal(payload.answer.answers[0].selected[0], "是");
});

test("answerApproval：默认拒绝，白名单允许", () => {
	const denial = answerApproval("s", { approvalId: "ap-1", toolName: "write" }, {});
	assert.deepEqual(denial, { sessionId: "s", approvalId: "ap-1", outcome: "rejected" });

	const allowed = answerApproval("s", { approvalId: "ap-1", toolName: "write" }, { allowTools: ["write"] });
	assert.equal(allowed.outcome, "allowed-once");
});

test("hasPlanReview：识别 plan-review 意图", () => {
	assert.equal(hasPlanReview([{ intent: { kind: "plan-review", approve: "批准" } }]), true);
	assert.equal(hasPlanReview([q("x")]), false);
	assert.equal(hasPlanReview([]), false);
});

test("declinePlan：对 plan-review 选非 approve 选项（=不批准）", () => {
	const payload = declinePlan("s", [{ id: "plan", intent: { kind: "plan-review", approve: "批准" }, options: [{ label: "批准" }, { label: "拒绝" }] }]);
	assert.equal(payload.answer.answers[0].selected[0], "拒绝");
});
