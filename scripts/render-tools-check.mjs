import { renderToString } from "ink";
import React from "react";
import { ToolCards } from "../ui/components.js";
const now = Date.now();
const tools = [
  { seq: 1, callId: "a", name: "run_code", args: JSON.stringify({ code: "const pd = await tools.pwsh({ command: 'ls' })" }), status: "running", startedAt: now - 4000 },
  { seq: 2, callId: "b", name: "write", args: JSON.stringify({ file_path: "test-tui-check.txt", content: "tui ok" }), status: "done", startedAt: now - 3000, finishedAt: now - 1000 },
  { seq: 3, callId: "c", name: "read", args: JSON.stringify({ path: "ui/components.js" }), status: "error" }
];
const out = renderToString(React.createElement(ToolCards, { tools })).split("\n").filter((l) => l.trim()).join(" | ");
console.log(out);
