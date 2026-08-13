#!/usr/bin/env node
// dsh-tui — milestone 1: connect to a DSH host and list sessions.
import { DshClient } from "../lib/client.js";

const baseUrl = process.env.DSH_URL ?? "http://127.0.0.1:3080";
const client = new DshClient(baseUrl);

const { items } = await client.request("session.list");
console.log(`Connected to ${baseUrl} — ${items.length} session(s):`);
for (const item of items) {
	const state = item.blank ? "blank" : "used ";
	const running = item.running ? " (running)" : "";
	console.log(`  [${state}]${running} ${item.sessionId}  ${item.cwd ?? ""}`);
}
