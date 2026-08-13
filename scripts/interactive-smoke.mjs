// 交互 TUI 冒烟：用 node-pty 在真实 pseudo-terminal 里跑 bin/tui.js，
// 喂按键驱动 Ink UI，验证「渲染 → Vim 输入 → 发送 → 收到流式回复」端到端。
import { spawn } from "node-pty";

const cwd = "C:/Users/zhntd/Desktop/game/dsh-tui";
// node-pty on Windows needs the absolute path to node.exe
const pty = spawn(process.execPath, ["bin/tui.js"], {
	name: "xterm-256color",
	cols: 120,
	rows: 30,
	cwd,
	env: { ...process.env, DSH_URL: "http://127.0.0.1:3080" }
});

let buffer = "";
let done = false;

function typeSeq(keys, delay = 80) {
	let i = 0;
	const timer = setInterval(() => {
		if (i < keys.length) { pty.write(keys[i]); i++; }
		else clearInterval(timer);
	}, delay);
}

// 收集输出直到出现 expected 或超时
function waitFor(expected, timeoutMs) {
	return new Promise((resolve) => {
		const deadline = Date.now() + timeoutMs;
		const check = setInterval(() => {
			if (buffer.includes(expected)) { clearInterval(check); resolve(true); }
			else if (Date.now() > deadline) { clearInterval(check); resolve(false); }
		}, 100);
	});
}

pty.onData((data) => { buffer += data; });

// 阶段的输出标记
async function run() {
	try {
		// 1. 等到 HUD 渲染（含 model/PTC）
		const hud = await waitFor("PTC", 15000);
		console.log("HUD rendered:", hud);
		await new Promise((r) => setTimeout(r, 800));

		// 2. 进 insert 模式输入一句话
		pty.write("i");
		await new Promise((r) => setTimeout(r, 200));
		pty.write("只回一个字：妥");
		await new Promise((r) => setTimeout(r, 300));

		// 3. Enter 发送
		pty.write("\r");
		console.log("sent prompt, waiting for reply...");

		// 4. 等回复出现（妥）
		const replied = await waitFor("妥", 120000);
		console.log("got reply:", replied);
		await new Promise((r) => setTimeout(r, 1000));

		// 5. 输出最终 buffer 摘要（去掉控制字符）
		const clean = buffer.replace(/[\x00-\x1f\x7f]/g, "").trim();
		console.log("--- final screen (clean) ---");
		console.log(clean.slice(-800));

		done = true;
		pty.write("\x03"); // Ctrl+C / 或 :q
		await new Promise((r) => setTimeout(r, 500));
	} catch (e) {
		console.error("ERROR:", e.message);
		done = true;
	}
	pty.kill();
}

run();
process.on("exit", () => { if (!done) pty.kill(); });
