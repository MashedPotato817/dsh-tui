// 单元飞轮：工作区扫描 scanWorkspace（有界 BFS，注入 listDir，纯函数）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanWorkspace, mentionScanEntries } from "../lib/scan.js";

// 内存树：每个节点是 { [name]: {_dir: bool, ...children} }
function makeListDir(root) {
	// 返回 listDir(dir) => { files, dirs }；dir 以 '/' 拆。
	return (dir) => {
		const parts = dir ? dir.split("/") : [];
		let node = root;
		for (const p of parts) { node = node?.[p]; if (node == null) return { files: [], dirs: [] }; }
		const files = [];
		const dirs = [];
		for (const k of Object.keys(node)) {
			if (k.startsWith(".")) continue;
			if (node[k] && typeof node[k] === "object") dirs.push(k);
			else files.push(k);
		}
		return { files, dirs };
	};
}

test("scanWorkspace：扁平相对路径 + 目录尾 /，跳过隐藏/噪音", () => {
	const root = {
		"src": { "a.ts": null, "utils": { "h.ts": null } },
		"README.md": null,
		".git": { "config": null },
		"node_modules": { "pkg": null }
	};
	const s = scanWorkspace(makeListDir(root));
	assert.ok(s.files.includes("src/a.ts"));
	assert.ok(s.files.includes("src/utils/h.ts"));
	assert.ok(s.files.includes("README.md"));
	assert.ok(!s.files.some((f) => f.includes(".git")), "应排除隐藏 .git");
	assert.ok(!s.files.some((f) => f.startsWith("node_modules/")), "应不下钻 node_modules");
	assert.deepEqual(s.dirs, ["src/", "src/utils/"], "应只收集可下钻目录");
});

test("scanWorkspace：预算上限截断，不无限膨胀", () => {
	const wide = {};
	for (let i = 0; i < 1500; i++) wide[`f${i}.ts`] = null;
	const s = scanWorkspace(makeListDir(wide), { maxEntries: 200 });
	assert.ok(s.files.length <= 200, `应被预算截断，实际 ${s.files.length}`);
});

test("mentionScanEntries：files + dirs 合并", () => {
	const s = { files: ["a.ts"], dirs: ["src/"] };
	assert.deepEqual(mentionScanEntries(s), ["a.ts", "src/"]);
});

test("scanWorkspace：listDir 抛错/返回空时安全", () => {
	const s = scanWorkspace(() => { throw new Error("denied"); });
	assert.deepEqual(s.files, []);
	assert.deepEqual(s.dirs, []);
});
