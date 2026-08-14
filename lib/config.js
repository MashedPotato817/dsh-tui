/**
 * dsh-tui 配置：读 `~/.dsh/dsh-tui.yml`（或注入路径），合并默认值。
 *
 * 对齐 OpenCode(.opencode.json) / Codex(config.toml) 的「可配置默认」理念：
 * 用户可覆盖默认权限档位、审批模式、价格表、自定义命令目录。
 * 纯函数 + 可注入 fs/路径，便于测试。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PERMISSION_MODES } from "./permission.js";
import { DEFAULT_PRICES } from "./hud.js";

const DEFAULT_PATH = () => join(homedir(), ".dsh", "dsh-tui.yml");

/** 默认配置。 */
export function defaultConfig() {
	return {
		approvalMode: "interactive", // 'interactive' | 'auto'
		defaultPermissionMode: PERMISSION_MODES.MANUAL,
		editableTools: [], // acceptEdits 档自动放行的编辑工具
		allowTools: [], // 保留给自定义自动审批策略；bypass 本身表示全部放行
		allowBypassPermissions: false, // 危险档默认不加入 Shift+Tab 循环
		customCommandsDirs: [], // 额外自定义命令目录（默认 .claude/commands + ~/.claude/commands）
		prices: {}, // 覆盖价格表（模型参数插入 DEFAULT_PRICES）
		maxToolOutputLines: 6
	};
}

/** 从路径读配置；文件缺失/损坏返回默认。 */
export function loadConfig(filePath = DEFAULT_PATH(), { read = readFileSync } = {}) {
	let raw;
	try {
		raw = read(filePath, "utf8");
	} catch {
		return defaultConfig();
	}
	try {
		return parseConfig(raw);
	} catch {
		return defaultConfig();
	}
}

/**
 * 解析 YAML 子集（dsh-tui 配置只需 key: value + 嵌套 + 内联数组/对象，不引入完整 YAML 依赖）。
 * 块状列表 `- item` 不在支持范围（数组请用内联 `[a, b]`）。
 * @returns {object} 合并默认后的配置。
 */
export function parseConfig(text) {
	const base = defaultConfig();
	if (typeof text !== "string" || !text.trim()) return base;

	const root = {};
	const stack = [{ indent: -1, obj: root }];
	for (const rawLine of text.split("\n")) {
		const line = rawLine.replace(/#.*$/, "").trimEnd();
		if (!line.trim()) continue;
		const indent = line.length - line.trimStart().length;
		const content = line.trim();
		if (content.startsWith("- ")) continue; // 块状列表不支持，跳过
		const pair = /^([\w.-]+):\s*(.*)$/.exec(content);
		if (!pair) continue;
		const [, key, valStr] = pair;
		while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
		const target = stack[stack.length - 1].obj;
		const value = parseValue(valStr);
		target[key] = value === null ? {} : value;
		if (value === null) stack.push({ indent, obj: target[key] });
	}
	return { ...base, ...normalize(root) };
}

function parseValue(s) {
	const v = s.trim();
	if (v === "") return null;
	if (v === "true") return true;
	if (v === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
	if (v.startsWith("[") || v.startsWith("{")) {
		try { return JSON.parse(v); } catch { return v; }
	}
	return v;
}

/** 规范化：把 `prices` 合并进默认价格表。 */
function normalize(cfg) {
	const out = { ...cfg };
	if (cfg.prices && typeof cfg.prices === "object") {
		out.prices = { ...DEFAULT_PRICES, ...cfg.prices };
	}
	return out;
}

/** 把配置映射为 LiveConversation 的用户断言（approvalMode / 权限档位初值等）。 */
export function configToRuntime(cfg = defaultConfig()) {
	return {
		approvalMode: cfg.approvalMode === "auto" ? "auto" : "interactive",
		permissionMode: cfg.defaultPermissionMode ?? PERMISSION_MODES.MANUAL,
		editableTools: cfg.editableTools ?? [],
		allowTools: cfg.allowTools ?? [],
		allowBypassPermissions: cfg.allowBypassPermissions === true
	};
}
