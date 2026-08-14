// lib/version.js — 读取包版本（纯函数，零依赖）
// 说明：CLI 直接运行时 `process.env.npm_package_version` 不存在（仅在 npm scripts 内注入），
// 因此必须回退到实际 package.json。返回解析后的版本字符串或 fallback。

export function resolveVersion(pkgJson, fallback = "0.0.0") {
	if (pkgJson && typeof pkgJson.version === "string" && pkgJson.version.length > 0) {
		return pkgJson.version;
	}
	return fallback;
}
