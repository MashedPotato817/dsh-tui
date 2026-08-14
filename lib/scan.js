// lib/scan.js — 工作区文件/目录扫描（纯函数，注入 listDir 以保持可单测、零 fs 依赖）。
// 对标 pi-tui file-autocomplete 的 WorkspaceFileSearch：有界 BFS 遍历，产出相对路径 + 目录，
// 排除常见噪音（.git / node_modules / 隐藏目录）。fs 读取由调用方注入（UI 边界），
// 这里只做「目录树 → 扁平相对路径列表」，供 @ 补全目录下钻使用。

const SKIP_DIRS = new Set([".git", "node_modules", ".next", ".cache", "dist", "build", "target", "vendor"]);

/**
 * 有界 BFS 遍历目录，产出相对路径。
 * @param {(dir: string) => { files: string[], dirs: string[] }} listDir - 列目录并区分文件/目录。
 * @param {object} [opts]
 * @param {number} [opts.maxEntries=10_000] - 条目上限（防大仓库爆炸）。
 * @param {number} [opts.maxDepth=6] - 最大深度。
 * @param {string} [opts.rootPrefix=''] - 结果路径前缀（如 '' 相对根）。
 * @returns {{ files: string[], dirs: string[] }} files 相对路径、dirs 目录相对路径（尾带/）。
 */
export function scanWorkspace(listDir, opts = {}) {
	const maxEntries = opts.maxEntries ?? 10000;
	const maxDepth = opts.maxDepth ?? 6;
	const files = [];
	const dirs = [];
	const queue = [{ path: opts.rootPrefix ?? "", depth: 0 }];
	let count = 0;
	const push = (arr, v) => { if (count < maxEntries) { arr.push(v); count += 1; } };
	while (queue.length && count < maxEntries) {
		const { path, depth } = queue.shift();
		let listed = { files: [], dirs: [] };
		try { listed = listDir(path) || { files: [], dirs: [] }; } catch { listed = { files: [], dirs: [] }; }
		for (const fname of listed.files || []) {
			if (typeof fname !== "string" || fname === "" || fname.startsWith(".")) continue;
			push(files, path ? `${path}/${fname}` : fname);
		}
		for (const dname of listed.dirs || []) {
			if (typeof dname !== "string" || dname === "" || dname.startsWith(".")) continue;
			if (SKIP_DIRS.has(dname)) continue; // 噪音目录不下钻
			const rel = path ? `${path}/${dname}` : dname;
			push(dirs, `${rel}/`);
			if (depth < maxDepth) queue.push({ path: rel, depth: depth + 1 });
		}
	}
	return { files, dirs };
}

/** 把 { files, dirs } 合成 @ 补全候选列表（files + dirs 尾带 /，前端可区分目录下钻）。 */
export function mentionScanEntries(scan) {
	return [...scan.files, ...scan.dirs];
}
