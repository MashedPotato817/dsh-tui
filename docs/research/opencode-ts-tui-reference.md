# OpenCode（TS 重写版）TUI 架构参考速记

> 来源：DeepWiki 对 `anomalyco/opencode` 的架构索引（2026-08 indexed）。
> 目的：作为 dsh-tui「往 Claude Code / 现代终端 Agent 靠拢」的对标锚点。
> 注：OpenCode 是独立 agent（内嵌 LLM 服务端）；dsh-tui 是连 DSH host 的客户端。
> 这里只借鉴**客户端侧 / TUI / 交互**的工程模式，不照搬其 LLM 内嵌。

## 1. 事件驱动 UI（这正是 dsh-tui 在做的，方向受验证）

- `stream.transport.ts`：`reduceSessionData` / `reduceSubagentData` 把**原始事件**（SSE 聚合）变成 UI 状态 patch。
- `useSync` hook：响应式存 session 数据；`SessionTransport` 协调 prompt turn 与全局事件订阅。
- `globalPayloadEvent(event)` → reducer → FooterPatch/StreamCommit → 请求渲染。

> ✅ dsh-tui 对应：`LiveConversation.#onFrame` + `foldEvents`（事件 → 对话视图）同构。
> 差异：OpenCode 用 SSE 聚合事件 + reducer patch；我用 mux 流帧 + fold 折叠。方向一致。

## 2. 上下文驱动自动补全（可抄）

| 触发 | 类型 | 实现 |
|---|---|---|
| `@` | Mentions：文件 / agent / 资源 | `mentionTriggerIndex`（文件补全）|
| `/` | Slash 命令 | `parseSlashCommand` 命令注册表 |
| `!` | Shell 模式 | `emptyPrompt(shell: true)` 直接执行 |
| `#` | 行范围 | `@file.ts#10-20` → `extractLineRange` |

> ✅ dsh-tui 有 `/`（slash 面板）；**缺 `@` 文件引用 + `#` 行范围 + `!` shell 模式**。
> 这块是下一步最大增量，尤以 `@` 文件补全 + `#` 行范围对代码 agent 体验影响最大。

## 3. Leader Key 系统（避免快捷键冲突）

- 默认 `ctrl+x` 作为 leader，`useBindings` hook + `OpencodeKeymapProvider`。
- 分发 session 命令：`session.share / timeline / fork / undo / redo / toggle.thinking` 等。

> dsh-tui 现用「vim 自然键 + Shift+Tab/Alt+M + Ctrl+C」。可考虑引入 leader key 承载更多系统级命令，不与 vim 编辑冲突。

## 4. Subagent 可视化

- 子 agent 状态走独立 footer 面板/标签（FooterSubagentTab）+ 权限请求面板（RunPermissionBody）。
- 可聚焦到某个 subagent 的输出。

> dsh-tui 目前单会话单 agent；DSH 有 subagent 能力（`subagent.*` API），
> 未来可加 subagent 状态面板。当前非最高优先。

## 5. Worker 隔离

- TUI 跑在 worker 进程，避免渲染阻塞 CLI 主线程（信号处理 / raw mode）。

> dsh-tui 单进程 Ink。复杂到需要隔离再引入。

## 6. 我的判断

- **架构方向已验证**：事件 reducer + 纯函数折叠 = 正确接缝。
- **差距清单**（按价值排）：① `@` 文件引用 + `#` 行范围；② `!` shell 模式；③ leader key 系统；④ subagent 面板。
- 这些都是「锦上添花」，不影响 dsh-tui 已具备的核心聊天/流式/权限/命令能力。
