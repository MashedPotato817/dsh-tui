/**
 * 客户端会话记忆：把「最近一次会话」持久化到本机 JSON 文件。
 *
 * 让 TUI 能记住上次用的会话，`dsh-tui` 或 `/resume` 自动恢复，而不是每次开新。
 * 纯 Node 文件 IO；路径可注入（测试用内存/临时路径）。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

const DEFAULT_PATH = `${homedir()}/.dsh/dsh-tui-recent.json`;

/** 读最近会话记忆；无则返回 null。文件损坏/不存在 → 容错返回 null。 */
export function readRecent(filePath = DEFAULT_PATH) {
	try {
		const raw = readFileSync(filePath, "utf8");
		const data = JSON.parse(raw);
		if (data && typeof data.sessionId === "string") return data;
		return null;
	} catch {
		return null;
	}
}

/**
 * 记下最近会话。
 * @param {string} sessionId
 * @param {{ cwd?: string, agentPreset?: string, recordedAt?: number }} [meta]
 */
export function writeRecent(sessionId, { cwd, agentPreset, recordedAt = Date.now() } = {}, filePath = DEFAULT_PATH, fs = { mkdirSync, writeFileSync }) {
	const dir = dirname(filePath);
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch {
		/* 目录建不出也继续尝试写 */
	}
	const payload = { sessionId, cwd: cwd ?? "", agentPreset: agentPreset ?? "", recordedAt };
	try {
		fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
		return payload;
	} catch {
		return null; // 写失败不致命
	}
}

/** 清除最近会话记忆。 */
export function clearRecent(filePath = DEFAULT_PATH) {
	try {
		writeFileSync(filePath, "", "utf8");
	} catch {
		/* ignore */
	}
}
