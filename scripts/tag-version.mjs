#!/usr/bin/env node
// scripts/tag-version.mjs — 让 npm 版本与 GitHub tag 对齐（飞轮嵌合度关键一环）。
// 用法：node scripts/tag-version.mjs            # 读 package.json version，打对应 tag（不存在才打）
//       node scripts/tag-version.mjs --push     # 打 tag 并 push 到 origin
// 目的：每次 publish 后跑它，确保 GitHub 的 vX.Y.Z tag 与 npm latest 指向同一 commit，
//       别人从任一处安装/查看拿到的都是同一版本，issue/PR 反馈才不会对到旧版本。
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("../package.json", import.meta.url);
const version = JSON.parse(readFileSync(root, "utf8")).version;
const tag = `v${version}`;

// 已存在同内容 tag → 幂等返回
try {
	execSync(`git rev-parse --verify ${tag}`, { stdio: "inherit" });
	console.log(`tag ${tag} 已存在，跳过`);
	process.exit(0);
} catch {
	/* 不存在，继续打 */
}

execSync(`git tag ${tag}`, { stdio: "inherit" });
console.log(`已打 tag ${tag}（指向 ${execSync("git rev-parse --short HEAD").toString().trim()}）`);

if (process.argv.includes("--push")) {
	for (let i = 0; i < 5; i++) {
		try {
			execSync(`git push origin ${tag}`, { stdio: "inherit" });
			console.log(`已 push ${tag} 到 origin`);
			process.exit(0);
		} catch {
			if (i === 4) { console.error("push 失败（TLS 抖动多次重试无果）"); process.exit(1); }
			console.log("push 失败，重试…");
		}
	}
}
