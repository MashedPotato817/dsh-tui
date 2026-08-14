# 让 Codex 评审 dsh-tui 的提示词（可直接粘贴）

把下面这份 Markdown 原样作为提示词喂给 Codex CLI（`cd C:\Users\zhntd\Desktop\game\dsh-tui && codex`）或 OpenAI Codex 会话。

---

"""你是一个经验丰富的开发者，正在评审一个名为 **dsh-tui** 的开源终端客户端项目。请先通读代码，再给出**可执行**的改进建议，不要空谈。

## 项目背景
- dsh-tui 是 **DeepSeek Harness（DSH）** 的终端客户端（TUI）。它本身**不是** DSH 插件，而是一个**独立的 HTTP/Ink TCP 客户端**，通过 DSH 的 `ctx.remote` 契约连接一个在 `http://127.0.0.1:3080` 运行的 DSH host（agent 服务）。
- 定位：像 **Claude Code** 那样对话 + 像 **Vim** 那样模态输入，在两者间取平衡；同时借鉴 OpenCode / Codex 的输入补全和终端交互。
- 当前版本 0.2.15，已发布到 npm（`latest`），GitHub tag `v0.2.12~v0.2.15` 已对齐（每次 publish 后用 `npm run tag` 自动打标）。

## 关键命令
- `npm test` —— 单元飞轮（当前 135 例，全部通过）
- `npm run check` —— 语法检查
- `npm run test:live` —— 真实 host 链路（需本机开着 DSH host + 模型 key，可跳过）
- `npm run smoke:interactive` —— node-pty 真实 TTY 冒烟
- `npm run tag` —— 打并 push GitHub tag（flywheel 对齐）

## 架构（重点，请按这个评判）
- `lib/` **core 层**：纯 Node ESM、零依赖、无 UI；是可被 VSCode 集成复用的核心。每个模块配单测（`test/*.test.js`）。
- `ui/components.js`：Ink 渲染层，用 `React.createElement` 手写（无 JSX 构建），消费 `lib/` 的派生结果。
- `bin/tui.js` + `bin/interactive.js`：CLI 入口。
- `lib/types/*.d.ts` + `exports` 具名子路径（`.` / `./docs` / `./version` / `./mention`），对齐官方 `@deepseek-ai/*` 插件规范。
- 通信：client 用 `{type:"client-request", rpcId, method, payload}` 发 RPC，mux SSE + history 轮询兜底。

## 已实现的能力
- HUD 状态栏（model[1M] 上下文窗 / 成本 / token / 回合耗时 ⏱ / 内置文档计数 / 子 agent 计数 / 权限档位）
- 流式回复、会话管理（/new /resume /list）、Vim 三模态、slot 补全
- `!` shell 模式、`@` 文件引用补全（OpenCode 式）、线范围 `#10-20`
- 审批 y/Y/n、Ctrl+C 双按退出、Ctrl+L 清屏、权限档位 Shift+Tab
- 断线重连提示、pending 超时升级、工具卡片 + diff 预览

## 我要你做的
请**实际阅读代码**后回答，引用具体文件/行号。针对下面几个维度给建议，每条建议要标明**优先级（高/中/低）**和**大概工作量**：

1. **架构与可维护性**：`lib/` 纯函数分层是否有越界、职责不清、会导致 VSCode 复用时踩坑的地方？
2. **可靠性与健壮性**：mux 断连重连、pending 卡死、空回复兜底、宿主协议版本变化——哪里最危险、该怎么加固？
3. **体验**：对照 Claude Code / OpenCode / Codex，HUD 信息密度、输入补全、消息渲染、键盘心智还有哪些成熟产品已经验证、但这里缺失或做得糙的？
4. **工程规范**：对照官方 `@deepseek-ai/*` 插件（类型声明 / exports / 文档 / 发布），还有哪些该对齐？
5. **测试**：单测覆盖有没有漏掉的纯函数；`smoke:interactive` 值得补哪些断言？

最后给一份**按优先级排序的「下一轮该做什么」清单**（最多 10 项），每项一句话说明价值。

请勿修改任何文件——只做评审与建议。如果某处你拿不准，明确说「不确定」，不要编造。"""

---
