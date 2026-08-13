/**
 * slash 面板：输入以 / 开头时，派生可用的命令列表供选择。
 * 纯函数，只做过滤 + 高亮切分，UI 消费它渲染。
 */
export const BUILTIN_COMMANDS = [
	{ name: "status", description: "查看会话状态", scope: "core" },
	{ name: "new", description: "新建会话", scope: "core" },
	{ name: "resume", description: "恢复上次会话", scope: "core" },
	{ name: "exit", description: "退出 TUI", scope: "core" }
];

/** 把命令按段命名空间（/git status → group "git"）。 */
export function commandGroup(name) {
	return name.includes(" ") ? name.split(" ")[0] : name;
}

/**
 * 按输入文本过滤并排序命令。空输入只回传入命令本身（让调用方注入 host 命令）。
 * @param {string} query - 当前输入（不含 /，或含都没关系）。
 * @param {Array<{name:string,description?:string}>} commands - 候选命令。
 * @returns {Array<{name:string,description?:string, matchStart:number, matchEnd:number}>}
 */
export function filterCommands(query, commands) {
	const q = query.replace(/^\//, "").toLowerCase();
	if (!q) {
		return commands.map((c) => ({ ...c, matchStart: 0, matchEnd: 0 }));
	}
	const scored = [];
	for (const cmd of commands) {
		const lower = cmd.name.toLowerCase();
		const idx = lower.indexOf(q);
		if (idx === -1) continue;
		// 前缀匹配优先
		const score = lower.startsWith(q) ? 0 : 1;
		scored.push({
			...cmd,
			matchStart: idx,
			matchEnd: idx + q.length,
			_score: score
		});
	}
	scored.sort((a, b) => a._score - b._score || a.name.localeCompare(b.name));
	return scored.map(({ _score, ...rest }) => rest);
}

/** 把过滤结果渲染成面板行（供 Ink 组件消费）：{name, activeIndex, matches} */
export function buildSlashPanel(input, commands, { active } = {}) {
	if (!input.startsWith("/")) return null;
	const query = input.slice(1);
	const filtered = filterCommands(query, commands);
	if (filtered.length === 0) return null;
	return {
		items: filtered,
		active: active
	};
}
