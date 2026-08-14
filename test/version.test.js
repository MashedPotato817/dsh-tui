import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVersion } from "../lib/version.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("resolveVersion 返回真实 package.json 版本（CLI --version 回退的正确来源）", () => {
	const pkg = require("../package.json");
	assert.ok(resolveVersion(pkg).length > 0);
	assert.equal(resolveVersion(pkg), pkg.version);
});

test("resolveVersion 缺字段用 fallback", () => {
	assert.equal(resolveVersion(null, "0.0.0"), "0.0.0");
	assert.equal(resolveVersion({}, "9.9.9"), "9.9.9");
	assert.equal(resolveVersion({ version: "" }, "1.2.3"), "1.2.3");
});
