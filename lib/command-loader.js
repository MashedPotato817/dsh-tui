/**
 * 自定义命令加载（Claude Code 式）：从 `<cwd>/.claude/commands/` 和
 * `~/.claude/commands/` 读 `*.md`，解析 frontmatter 成为可用的 slash 命令。
 *
 * 每个命令 = 一个 Markdown 文件：
 *   ---
 *   description: 一句话描述
 *   argument-hint: <文件路径>
 *   allowed-tools: write,edit
 *   ---
 *   （正文 = 发送给模型的系统指令；$ARGUMENTS / $1 $2 是运行时占位符）
 *
 * 本模块只负责「发现 + 解析元数据 + 读取正文」，执行由调用方拼进 prompt。
 * fs/路径可注入，便于测试。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_FILE_KB = 64;

/** 解析 frontmatter（`---` 包裹的 YAML 子集：key: value）。失败返回 {}。 */
export function parseFrontmatter(text) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (!m) return {};
	const out = {};
	for (const line of m[1].split("\n")) {
		const mm = /^([a-zA-Z][\w-]*)\s*:\s*(.*)$/.exec(line);
		if (mm) out[mm[1]] = mm[2].trim();
	}
	return out;
}

/** 从一个命令目录发现命令；返回 [{name, description, hint, allowedTools, body, source, priority}]。 */
export function listCommandsFromDir(dir, { source = "user" } = {}) {
	const out = [];
	let names;
	try {
		names = readdirSync(dir);
	} catch {
		return out;
	}
	for (const f of names) {
		if (!f.toLowerCase().endsWith(".md")) continue;
		try {
			const full = join(dir, f);
			const stats = statSync(full);
			if (!stats.isFile()) continue;
			if (stats.size > MAX_FILE_KB * 1024) continue; // 防超大文件
			const body = readFileSync(full, "utf8");
			const meta = parseFrontmatter(body);
			const name = f.replace(/\.md$/i, "");
			const description = meta.description ?? "";
			const hint = meta["argument-hint"] ?? "";
			const allowedTools = (meta["allowed-tools"] ?? "")
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			out.push({ name, description, hint, allowedTools, body, source });
		} catch {
			/* 单个坏文件跳过 */
		}
	}
	return out;
}

/**
 * 发现全部自定义命令：项目级 + 个人级（~/.claude/commands）。
 * @param {{ cwd?: string, projectHome?: string, home?: string }} opts
 */
export function loadCustomCommands({
	cwd = ".",
	home = homedir(),
	projectDir = cwd
} = {}) {
	const fromProject = listCommandsFromDir(join(projectDir, ".claude", "commands"), { source: "project" });
	const fromUser = listCommandsFromDir(join(home, ".claude", "commands"), { source: "user" });
	// 项目级优先，same-name 去重
	const map = new Map();
	for (const c of fromUser) map.set(c.name, c);
	for (const c of fromProject) map.set(c.name, c); // 覆盖个人级
	return [...map.values()];
}
