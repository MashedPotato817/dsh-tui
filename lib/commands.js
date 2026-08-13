/**
 * 客户端命令路由：区分本地 TUI 命令与 host 注册表命令。
 *
 * TUI 的 `/` 输入里有一部分是客户端自管的（new/resume/exit 等），
 * 其余交给 host 命令注册表（经 session.prompt 以 `/...` 发出，host 执行）。
 * onCommand 接收解析后的 action，UI 据此切换会话/退出。
 */
import { BUILTIN_COMMANDS } from "./slash.js";

/** 本地 TUI 命令：不进模型，客户端直接处理。 */
export const LOCAL_COMMANDS = {
	new: { description: "新建会话" },
	resume: { description: "恢复最近会话" },
	exit: { description: "退出 TUI" },
	quit: { description: "退出 TUI" },
	list: { description: "列出会话" },
	clear: { description: "清空客户端记忆" },
	help: { description: "查看可用命令" }
};

/** 把一条 `/cmd args` 解析成 { name, args }；非 / 开头返回 null。 */
export function parseSlash(input) {
	const text = input.trim();
	if (!text.startsWith("/")) return null;
	const rest = text.slice(1).trim();
	if (!rest) return { name: "", args: "" };
	const [name, ...argParts] = rest.split(/\s+/);
	return { name: name.toLowerCase(), args: argParts.join(" ") };
}

/**
 * 判断一个 slash 命令是否为本地 TUI 命令。
 * @param {string} name - 命令名（不含 /）。
 */
export function isLocalCommand(name) {
	return Object.prototype.hasOwnProperty.call(LOCAL_COMMANDS, name);
}

/**
 * 派发一条 slash 命令。返回
 *   { local: true, action: 'exit' }            → 退出
 *   { local: true, action: 'new' }             → 新建会话
 *   { local: true, action: 'resume' }          → 恢复最近
 *   { local: true, action: 'list' }            → 列出会话
 *   { local: false, name, args }               → host 命令，UI 应转向 session.prompt
 *   { local: true, action: 'noop', notice }    → 提示但不切换
 *
 * @param {string} input - 输入（含 /）。
 * @param {{ client}} ctx
 */
export function routeSlash(input) {
	if (typeof input !== "string") return null;
	const parsed = parseSlash(input);
	if (!parsed) return null;
	if (!parsed.name) return { local: true, action: "noop", notice: "空命令" };
	if (parsed.name === "exit" || parsed.name === "quit") return { local: true, action: "exit" };
	if (parsed.name === "new") return { local: true, action: "new" };
	if (parsed.name === "resume") return { local: true, action: "resume" };
	if (parsed.name === "list") return { local: true, action: "list" };
	if (parsed.name === "clear") return { local: true, action: "clear", notice: "已清空客户端会话记忆" };
	if (parsed.name === "help" || parsed.name === "?") return { local: true, action: "help", name: parsed.name };
	// 其余疑似 host 命令
	return { local: false, name: parsed.name, args: parsed.args, text: input.trim().slice(1) };
}

/** 合并 BUILTIN + LOCAL，供 SlashPanel 展示。 */
export function allCommands() {
	const groups = { core: BUILTIN_COMMANDS.map((c) => c.name) };
	const cmds = [
		...BUILTIN_COMMANDS,
		...Object.entries(LOCAL_COMMANDS).map(([name, c]) => ({
			name,
			description: c.description,
			scope: "local"
		}))
	];
	// name 去重（exit 出现在 builtin 和 local）
	return Array.from(new Map(cmds.map((c) => [c.name, c])).values());
}
