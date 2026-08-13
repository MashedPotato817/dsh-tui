import test from "node:test";
import assert from "node:assert/strict";
import { DshClient, mintRpcId } from "../lib/client.js";

test("mintRpcId produces a fresh rpc- prefixed id", () => {
	const a = mintRpcId();
	const b = mintRpcId();
	assert.match(a, /^rpc-/);
	assert.notEqual(a, b);
});

test("request sends the ClientRequest envelope and returns the business value", async () => {
	let captured;
	const client = new DshClient("http://example.test");
	global.fetch = async (url, options) => {
		captured = { url, options };
		const body = JSON.parse(options.body);
		return {
			ok: true,
			json: async () => ({
				type: "server-response",
				rpcId: body.rpcId,
				result: { ok: true, value: { items: [1, 2] } }
			})
		};
	};

	const value = await client.request("session.list");
	assert.deepEqual(value, { items: [1, 2] });

	assert.equal(captured.url, "http://example.test/api/session.list");
	assert.equal(captured.options.method, "POST");
	assert.match(captured.options.headers["content-type"], /application\/json/);

	const envelope = JSON.parse(captured.options.body);
	assert.equal(envelope.type, "client-request");
	assert.equal(envelope.method, "session.list");
	assert.match(envelope.rpcId, /^rpc-/);
	assert.deepEqual(envelope.payload, {});
});

test("request throws a structured error on business failure", async () => {
	const client = new DshClient("http://example.test");
	global.fetch = async (_url, options) => {
		const body = JSON.parse(options.body);
		return {
			ok: true,
			json: async () => ({
				type: "server-response",
				rpcId: body.rpcId,
				result: { ok: false, error: { code: "session-not-found", message: "no such session", details: { sessionId: "x" } } }
			})
		};
	};

	await assert.rejects(
		() => client.request("session.history", { sessionId: "x" }),
		(error) => error.code === "session-not-found" && /no such session/.test(error.message)
	);
});

test("request rejects on HTTP errors and rpcId mismatch", async () => {
	global.fetch = async () => ({ ok: false, status: 500 });
	const client = new DshClient("http://example.test");
	await assert.rejects(() => client.request("session.list"), /HTTP 500/);

	global.fetch = async () => ({
		ok: true,
		json: async () => ({ type: "server-response", rpcId: "different", result: { ok: true, value: {} } })
	});
	await assert.rejects(() => client.request("session.list"), /rpcId mismatch/);
});
