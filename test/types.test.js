// 单元飞轮：types 声明与运行时导出必须保持一致（防 .d.ts 与实现漂移）。
// 官方 @deepseek-ai/* 规范要求 types 随 main 一起发布；这里用「声明名 == 运行时名」做漂移守卫。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import * as api from "../lib/index.js";

// 从 lib/types/index.d.ts 里提取声明的导出名（export function / const / class）。
function declaredNames(dts) {
	const fn = [...dts.matchAll(/export function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
	const konst = [...dts.matchAll(/export (?:const|declare const)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
	const cls = [...dts.matchAll(/export class\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
	return new Set([...fn, ...konst, ...cls]);
}

test("types/index.d.ts 声明名 ⊆ 运行时导出（无漂移）", () => {
	const p = "lib/types/index.d.ts";
	assert.ok(existsSync(p), "存在 types/index.d.ts");
	const declared = declaredNames(readFileSync(p, "utf8"));
	const missing = [...declared].filter((d) => !(d in api));
	assert.deepEqual(missing, [], `声明存在但运行时缺失：${missing.join(", ")}`);
});

test("types 子路径存在且含同名导出", () => {
	for (const [file, fnName] of [["lib/types/docs.d.ts", "countProjectDocs"], ["lib/types/version.d.ts", "resolveVersion"]]) {
		const text = readFileSync(file, "utf8");
		assert.ok(text.includes(fnName), `${file} 应导出 ${fnName}`);
	}
	// 子路径运行时可 import
	assert.equal(typeof api.countProjectDocs, "function");
	assert.equal(typeof api.resolveVersion, "function");
});
