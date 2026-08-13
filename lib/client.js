import { randomUUID } from "node:crypto";

const DEFAULT_BASE = "http://127.0.0.1:3080";

/** Mint a fresh rpcId (the initiator always mints; responses echo it). */
export function mintRpcId() {
	return `rpc-${randomUUID()}`;
}

/**
 * Minimal DSH client carrier: one unary request over HTTP.
 *
 * Implements the four-quadrant envelope contract from `dsh-host-apiproxy`:
 * the POST body is a `ClientRequest` `{ type, rpcId, method, payload }` and the
 * response is a `ServerResponse` `{ type, rpcId, result }` echoing the rpcId.
 * Business failures surface as structured errors (`code: message`).
 */
export class DshClient {
	constructor(baseUrl = DEFAULT_BASE) {
		this.baseUrl = baseUrl.replace(/\/+$/, "");
	}

	/**
	 * Perform one unary client request.
	 * @param method - the domain method, e.g. `session.list`.
	 * @param payload - the business payload (default `{}`).
	 * @returns the business value on success (`result.value`).
	 */
	async request(method, payload = {}) {
		const rpcId = mintRpcId();
		const response = await fetch(`${this.baseUrl}/api/${method}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "client-request", rpcId, method, payload })
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} from ${method}`);
		}
		const message = await response.json();
		if (message.type !== "server-response") {
			throw new Error(`unexpected response type: ${String(message.type)}`);
		}
		if (message.rpcId !== rpcId) {
			throw new Error("rpcId mismatch in server response");
		}
		if (!message.result.ok) {
			const error = message.result.error;
			const errorObject = new Error(`${error.code}: ${error.message}`);
			errorObject.code = error.code;
			throw errorObject;
		}
		return message.result.value;
	}
}
