// 临时探测脚本：抓 mux SSE 线上真实格式（探测完删除）。
const rpcId = "rpc-probe-" + Math.random().toString(36).slice(2);
const res = await fetch("http://127.0.0.1:3080/api/events.mux", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ type: "client-request", rpcId, method: "events.mux", payload: {} })
});
console.log("status:", res.status, "| content-type:", res.headers.get("content-type"));
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = "";
const deadline = Date.now() + 3000;
while (Date.now() < deadline) {
	const { done, value } = await reader.read();
	if (done) break;
	buf += decoder.decode(value, { stream: true });
	if (buf.length > 0) break;
}
console.log("first bytes:");
console.log(JSON.stringify(buf.slice(0, 3000)));
reader.cancel();
