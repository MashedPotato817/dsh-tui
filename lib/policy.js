/**
 * 应答策略：把可应答帧（question/approval requested）折成 client-response。
 *
 * TUI 没有完整的交互式提问 UI，默认采用安全策略：
 * - question：普通问询自动选第一个选项；plan-review 意图默认拒绝（decline）。
 *   策略可注入（dialoguePolicy）覆盖，供未来交互式抉择。
 * - approval：默认拒绝工具调用（allowed-once 需显式策略）。白名单工具
 *   （allowTools）自动放行。
 *
 * 每个函数返回 client-response 的 result.value，供 client.respond(rpcId, {ok:true,value})。
 */

/** 从 question items 生成应答 payload。 */
export function answerQuestions(sessionId, questions, policy = {}) {
	const picker = policy.pickQuestion ??
		((q) => {
			if (q.options && q.options.length > 0) return q.options[0].label;
			return "";
		});
	const answers = questions.map((q) => {
		const selected = q.options && q.options.length > 0 ? [picker(q)] : [];
		return { id: q.id, selected };
	});
	return { sessionId, answer: { answers } };
}

/** 从 approval 帧生成应答 payload（默认 rejected）。 */
export function answerApproval(sessionId, approval, policy = {}) {
	const allow =
		policy.allowTools &&
		Array.isArray(policy.allowTools) &&
		policy.allowTools.includes(approval.toolName);
	return {
		sessionId,
		approvalId: approval.approvalId,
		outcome: allow ? "allowed-once" : "rejected"
	};
}

/**
 * 判断一个 question 集是否含 plan-review 意图（这些应保守拒绝/decline）。
 */
export function hasPlanReview(questions) {
	return Array.isArray(questions) && questions.some((q) => q.intent && q.intent.kind === "plan-review");
}

/** 构造 plan-review 的 decline 应答：选非 approve 命名的第一个选项（即不批准）。 */
export function declinePlan(sessionId, questions) {
	return answerQuestions(sessionId, questions, {
		pickQuestion: (q) => {
			if (!q.options || q.options.length === 0) return "";
			const approve = q.intent && q.intent.kind === "plan-review" ? q.intent.approve : null;
			// 跳过被 approve 命名的那个 option（它是「批准」），选下一个作为 decline
			const notApprove = approve
				? q.options.find((o) => o.label !== approve)
				: null;
			return (notApprove ?? q.options[0]).label;
		}
	});
}
