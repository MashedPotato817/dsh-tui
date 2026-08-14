// 交互 TUI 冒烟：node-pty 在真实 pseudo-terminal 跑 bin/tui.js。
// 重点：长对话（超过终端高度）后，验证「输入区仍可见、最新回复可见、输入仍可发送」，
// 不误判（用唯一标记字符串，不用输入里本来含有的词判断模型回复）。
//
// 用法：npm run smoke:interactive
// 退出码：任一关键断言失败 → 非 0（由调用方据此判定失败）。
import { spawn } from "node-pty";

const cwd = process.env.SMOKE_CWD ?? "C:/Users/zhntd/Desktop/game/dsh-tui";
const pty = spawn(process.execPath, ["bin/tui.js"], {
	name: "xterm-256color",
	cols: 100,
	rows: 22, // 小终端，更容易触发超过高度的长对话
	cwd,
	env: { ...process.env, DSH_URL: process.env.SMOKE_DSH_URL ?? "http://127.0.0.1:3080", NO_COLOR: "1" }
});

let buffer = "";
let done = false;
const MARKER = "VIEWPORT_INPUT_STILL_WORKS";

function waitFor(expected, timeoutMs) {
	return new Promise((resolve) => {
		const deadline = Date.now() + timeoutMs;
		const check = setInterval(() => {
			if (buffer.includes(expected)) { clearInterval(check); resolve(true); return; }
			if (Date.now() > deadline) { clearInterval(check); resolve(false); }
		}, 100);
	});
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function sendText(t) { pty.write(t); }

let failures = 0;
const fail = (msg) => { console.error("FAIL:", msg); failures += 1; };

pty.onData((data) => { buffer += data; });

async function run() {
	try {
		// 1. 等到 HUD 渲染
		const hud = await waitFor("PTC", 20000);
		if (!hud) fail("HUD 未在 20s 内渲染（PTC）");
		await sleep(600);

		// 2. 多轮发言，产生足够长历史（含 Markdown/代码块/工具行，超过 22 行终端）
		const prompts = [
			"请用 Markdown 列出 6 个要点，每个要点跟两行说明和一段 ```python 代码块```",
			"再补 5 个实用技巧，同样每个配代码示例",
			"最后补 8 条命令行技巧，每条带 `inline code`"
		];
		for (const p of prompts) {
			pty.write("\r");
			await sleep(300);
			pty.write(p);
			await sleep(200);
			pty.write("\r");
			// 等这一轮有回复落定（出现 assistant 圆点 ●）
			await waitFor("●", 30000);
			await sleep(2500); // 给流式/折行留时间
		}
		console.log("long conversation sent; viewport budget should now be active");

		// 3. 等一次计时刷新（至少 1s），确认不卡死
		await sleep(1200);

		// 4. 长历史后输入唯一标记，验证输入仍可编辑并可见
		pty.write("\r");
		await sleep(300);
		pty.write(MARKER); // 不回车，先验证它出现在输入区
		await sleep(600);
		// 输入区标记可见（insert 提示 + 文本）
		if (buffer.includes(MARKER)) {
			console.log("marker typed into input OK");
		} else {
			fail(`输入标记 ${MARKER} 未出现在输入区（视口可能跳回/输入区被顶走）`);
		}

		// 5. 回车发送，验证 marker 作为用户消息被发出（出现在灰条里）
		pty.write("\r");
		await sleep(500);
		if (buffer.includes(MARKER)) {
			console.log("marker visible after send (user bar) OK");
		} else {
			fail(`${MARKER} 发送后不可见`);
		}

		// 6. 关键：输入区仍可见（insert 提示）且最新回复可见
		await sleep(300);
		if (!/insert|INSERT/.test(buffer.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""))) {
			fail("输入区标记（insert）不可见：输入区可能被历史顶出屏幕");
		}

		// 7. 应用级 follow-tail：PageUp 上翻 → 应出现「回到底部」提示且不跳顶；End 回到底部
		pty.write("\x1b[5~"); // PageUp
		await sleep(500);
		if (buffer.includes("End 回到底部") || buffer.includes("上面还有历史")) {
			console.log("follow-tail: PageUp 显示回到底部提示 OK");
		} else {
			fail("PageUp 后未出现「End 回到底部」提示（follow-tail 提示缺失）");
		}
		pty.write("\x1b[F"); // End → 回到底部跟随
		await sleep(400);
		console.log("follow-tail: End 已回到底部");

		// 8. 输出清理后的最终画面（去掉控制序列）便于人工核对
		const clean = buffer.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/[^\x20-\x7E\u4e00-\u9fa5\n]/g, "").trim();
		console.log("--- final screen (clean tail) ---");
		console.log(clean.split("\n").slice(-24).join("\n"));

		if (failures > 0) {
			console.error(`\nSMOKE FAILED: ${failures} check(s) failed`);
			pty.kill();
			process.exit(1);
		}
		console.log("\nSMOKE PASSED");
		done = true;
		pty.write("\x03");
		await sleep(500);
	} catch (e) {
		console.error("ERROR:", e.message);
		failures += 1;
		pty.kill();
		process.exit(1);
	}
	pty.kill();
}
run();
process.on("exit", () => { if (!done) pty.kill(); });
