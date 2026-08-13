# OpenAI Codex CLI 源码与架构调研笔记 —— 供 dsh-tui（JS/Node 终端 agent）借鉴

> **调研对象**：[github.com/openai/codex](https://github.com/openai/codex)（仓库根组织名 `codex-rs/`，前身 `codex-rs` / `openai-codex`），Rust 实现。
> **方式**：web_search + 直接抓取 `main` 分支与历史 tag 的真实源码文件核对（含字段、枚举、字符串原文）。所有结论以实际源码为准；凡是查不到的概念明确标注「查无」，不臆造。
> **特别提醒**：用户问题中猜测的若干机制（`ToolUsePolicy`、逐工具 `yes/no/read-only` 审批、`[sandbox_read_only]`、`tools` 表、`temperature/top_p/max_tokens` 键、`-a` 旗标、`[model]` 表、`[lsp]` 等）**在 Codex 里并不存在**，其中多数其实是 **Anthropic Claude Code** 的模型。已在文中逐一澄清。

---

## 0. 最重要的架构结论（先看这条）

- **三层解耦**：`core`（无头 agent 引擎，禁 `stdout/stderr` 直接输出）⇄ `protocol`（线程安全的事件/命令消息协议）⇄ `tui` / `cli`（展示 + 用户交互）。
  - `core/src/lib.rs` 第 4 行有 `#![deny(clippy::print_stdout, clippy::print_stderr)]` —— 所有用户可见输出都必须走 **TUI 或 tracing** 抽象。这对 JS 移植是强约束：agent 引擎与渲染层必须分离。
- **事件驱动而非直接调用**：UI 与 agent 之间不直接调函数，而是通过两条异步消息流：
  1. **事件流** `EventMsg`（agent → UI）：turn 生命周期、AgentMessage 增量、token 计数、exec 输出、审批请求…（见 §2.3）
  2. **命令流** `Op`（UI → agent）：提交 turn、中断、审批裁决、compact、`!cmd`、shutdown…（见 §2.4）
- **审批 = 进程级 `approval_policy` + 沙箱级 `sandbox_mode` + 命令前缀 `execpolicy`**，**没有**逐工具 `allow/ask/deny` 表（那是 Claude Code）。
- **TUI 用 ratatui + crossterm**（不是 tui-rs），streaming 用 command 动画队列做打字机效果。
- 单一 `Cargo.toml` workspace 有 **~150 个 crate / 约 60 个核心 module**，`config` 也是独立 crate。

---

## 1. 源码结构

仓库根为 `codex-rs/`（Rust workspace，`edition = 2024`）。真实 `codex-rs/Cargo.toml` 的 members 名单（节选，与本节直接相关者）：

核心 crates：

| crate (path) | 职责 |
|---|---|
| **`core`** | 无头 agent 引擎：`CodexThread` 线程、turn 编排、client 流式调用、MCP/skills/plugins、sandbox 策略 |
| **`cli`** | 命令入口 & 一次性场景：`codex exec`（无人值守）、沙箱子命令（seatbelt/landlock/windows）、login/logout |
| **`tui`** | 终端 UI：`App` + 主循环 + `ChatWidget`/`BottomPane`/`ChatComposer`/`ExecCell`，ratatui 渲染 |
| **`config`** | `config.toml` 解析、分层合并、JSON schema 生成 |
| **`protocol`** | **领域模型核心**：`EventMsg`、`Op`、`AskForApproval`、`SandboxPolicy`、`ReviewDecision`、`ResponseItem`、thread models |
| **`tools`** | 工具定义与 Responses API 原语：`ToolCall`、`ToolExecutor`、`ToolSpec`、`tool_config`、MCP 工具 |
| **`prompts`** | 系统提示词片段：`PermissionsInstructions`、`REVIEW_PROMPT`、`SUMMARIZATION_PROMPT`、实时性指令 |
| **`sandboxing` / `linux-sandbox` / `windows-sandbox-rs`** | Landlock / seccomp / Windows restricted-token 沙箱实现 |
| **`execpolicy`** | Starlark 风格命令前缀审批规则（`.codex/execpolicy/*.rules|*.star`） |
| **`rollout`** | 会话持久化（`sessions/`、`archived_sessions/` 的 JSONL rollout，含 `Cursor`、`RolloutRecorder`）|
| **`models-manager` / `model-provider-info`** | 模型/提供商 registry |
| **`agent-graph-store` / `thread-store` / `state`** | SQLite 线程/副代理状态库 |
| **`utils/*`**（`approval-presets`、`cli`、`fuzzy-match`、`output-truncation`、`stream-parser`、`cmp`…）| 大量工具 crate |
| **`app-server` + `app-server-protocol` + `app-server-client`** | 与 Codex Desktop 的 daemon RPC |

`core/src/lib.rs` 的私有模块（真实存在）：`agent`（副代理注册/角色/控制）、`agent_communication`、`client` / `client_common`、`codex_thread`、`compact*`（上下文压缩 v2/远端/token 预算）、`mcp` / `mcp_*`、`sandbox_tags` / `sandboxing`、`session` / `session_prefix`、`skills`、`unified_exec`、`exec_policy`、`exec` / `exec_env`、`hooks`、`rollout` / `rollout_budget`、`guardian`、`tasks`、`user_shell_command`、`environment_config` 等。

---

## 2. Agent 循环（turn 循环）

### 2.1 线程模型：`CodexThread`
- `core/src/codex_thread.rs`：`pub struct CodexThread` 是每个会话/线程的宿主句柄。
  - `submit(op) -> CodexResult<String>`（把 `Op` 交进服务器循环）
  - `start_or_steer_turn(request)` / `start_turn_if_idle(request)` / `steer_turn(request)` / `recover_turn_if_idle(request)` —— 统一走 `submit_turn_input_with_mode(request, TurnInputMode)`，`TurnInputMode::{StartOrSteer, StartIfIdle}`，返回 `TurnInputSubmission::{Started{turn_id} | Steered | NotSubmitted{reason}}`。
  - `shutdown_and_wait()` / `wait_until_terminated()`。
- 即：**一个 turn 是一次可提交/可打断/可步进的活动**，UI 只是提交 `TurnInputRequest` 并消费事件。
- 副代理/委派（`core/src/codex_delegate.rs`）：**每个 delegate 是独立的 `CodexThread`**，且强制 `approval_policy = "never"`（delegate 不向用户要审批）；它把**公共事件**（`agent_status` 等）转发给父会话，父会话把额外 `Op` 转发给它。即**多 agent = 多线程 + 事件级联 + Op 代理**。

### 2.2 主循环：`Session::run_turn`（真实模块名，`core/src/session/turn.rs`）
- **主循环不在 `agent.rs`**（`core/src/agent/` 实际是**多智能体/子 agent 编排**：spawn/wait/role/residency/guardian）。真正的采样循环在 `session/turn.rs`：`Session::run_turn`（L153）里是 `loop { ... run_sampling_request(...) ... }`——每次 `run_sampling_request` = **一次模型调用**，对应 Responses 的一次流式。
- **再来一轮的判定**：采样结果 `SamplingRequestResult { needs_follow_up, last_agent_message }`。工具产出/挂起输入需要继续 → `continue`（带上新 `step_context` 重新采样，即**工具输出后的重新提示**）；上下文接近满 → `should_roll_over` 触发 `run_auto_compact` 后 `continue`；`!needs_follow_up` 且 stop 钩子不拦 → `run_turn_stop_hooks` 后 `break`。
- 每次采样前重建 `StepContext`（世界状态/工具/环境），`sess.clone_history().for_prompt(...)` + `build_prompt(...)` 组装 `Prompt`；`try_run_sampling_request`（L2154）`client_session.stream(prompt)` 拿到 `ResponseStream`（mpsc），`loop { stream.next() }` 消费 `ResponseEvent`。
- 事件分支（`session/turn.rs` L2262-2701）：`OutputItemDone(item)`→最终化并产生 tool future 压入 `in_flight`（`FuturesOrdered`）、累加 `last_agent_message`、置 `needs_follow_up`；`OutputItemAdded`→emit `ItemStarted`；`*Delta`→发增量事件；`Completed{token_usage,end_turn}`→emit `TokenCount`/`TurnDiff`。
- **重试**：流错误走 `handle_retryable_response_stream_error` 背退重试（`ResponsesStreamRetryState`，`max_retries=stream_max_retries()`）。

### 2.2b 模型调用层（client）
- `core/src/client.rs`：`ModelClient`（`stream()`、`stream_responses_api()`、`stream_responses_websocket()`）；`build_responses_request`（L844）构造请求体：`model`、`instructions`（=base/system 提示）、`input`（ResponseItem 数组）、`tools`、`tool_choice:"auto"`、`parallel_tool_calls`、`reasoning`、`store:false`、`stream:true`、`include:["reasoning.encrypted_content"]`。
- **传输双通道**：WebSocket V2（表头 `responses_websockets`）或 HTTP+SSE，由 `ModelClient` 运行时判定。
- **增量累积**：SSE/WS 原始事件规整为 `ResponseEvent`（`Created`/`OutputItemAdded`/`OutputItemDone`/`OutputTextDelta`/`ToolCallInputDelta`/`Reasoning*Delta`/`Completed`…），用 `AssistantMessageStreamParsers`/`PlanModeStreamState` 逐段拼装并发 `AgentMessageContentDelta`/`ReasoningContentDelta` 给 UI。
- `core/src/client_common.rs`：`Prompt { input, tools: Arc<[ToolSpec]>, parallel_tool_calls, base_instructions: BaseInstructions, output_schema, output_schema_strict }`；`ResponseStream` = `mpsc::Receiver<Result<ResponseEvent>>`，`Drop` 触发 `consumer_dropped` 取消（**背压/取消**设计）。`wire_api` 仅 `Responses`（旧 `chat` 已移除）。
- **同一 turn 内增量追加工具输出**：用 `previous_response_id` + delta input items（client.rs）；跨请求粘性路由用 `x-codex-turn-state` 头。SSE 解析在 `codex-api/src/sse/responses.rs::spawn_response_stream`，WS 在 `codex-api/src/endpoint/responses_websocket.rs`。`ModelClient`（session 级，持 auth/provider/websocket 状态）→ `ModelClientSession`（turn 级）；`active_ws_version`（main `client.rs` L430-442）决定 WebSocket V2（beta 头 `responses_websockets`）vs HTTP SSE。
- **系统提示 = `base_instructions` + `WorldState` 片段**：`Prompt.base_instructions.text` 来自 `get_base_instructions()` → 模板 `core/templates/model_instructions/*`。现代“per-turn 指令”机制是 **`WorldState`** 的具名 `WorldStateSection`（model/personality/permissions/tools/environment/agents_md/multi_agent_mode/…），每节 `render_diff` 产出 ContextualUserFragment（`<permissions instructions>…`、`<environment_context>…`）注入对话；历史回灌时由 `event_mapping.rs` 的 `CONTEXTUAL_DEVELOPER_PREFIXES` 过滤。

### 2.3 事件流 `EventMsg`（agent → UI，`protocol/src/protocol.rs` L1284，部分变体）
- turn 生命周期：`TurnStarted`（旧 wire 名 `task_started`）、`TurnComplete`（`task_complete`）、`TurnAborted`、`ThreadRolledBack`。（主仓库源码即 `TurnStarted/TurnComplete/TurnAborted`；docs.rs 的 **重导出 crate `agcodex-protocol`** 才把它们再命名为 `TaskStarted/TaskComplete`——"task→turn"字样只出现在 re-export 层，主仓库无。）
- 内容：`AgentMessage`（带 `phase: MessagePhase`、`memory_citation`）、`UserMessage`、`AgentReasoning`、`AgentReasoningRawContent`（原始 CoT）、`AgentReasoningSectionBreak`。
- Token/使用：`TokenCount`、`TokenUsage` 明细。
- 工具/执行：`ExecCommandBegin` / `ExecCommandOutputDelta`（命令增量输出）/ `ExecCommandEnd`、`TerminalInteraction`、`PatchApplyBegin/PatchApplyUpdated/PatchApplyEnd`、`ApplyPatchApprovalRequest`、`McpToolCallBegin/End`、`WebSearchBegin/End`、`ViewImageToolCall`、`DynamicToolCallRequest/Response`、`RequestPermissions`、`RequestUserInput`、`ElicitationRequest`。
- 审批：`ExecApprovalRequest`、`GuardianAssessment`（自动评审专员把守）。
- 系统：`Error`/`Warning`/`GuardianWarning`、`StreamError`（流断开/重试通知）、`ContextCompacted`、`ModelReroute`、`SafetyBuffering`、`EnteredReviewMode/ExitedReviewMode`、`ShutdownComplete`、`SessionConfigured`、`EnvironmentConnected/Disconnected`。
- 原始透传：`RawResponseItem`、`RawResponseCompleted`、`ItemStarted`、`ItemCompleted`（供 UI 定制渲染）。

> **JS 移植启示**：把 agent 的每一步都建模成一个**可序列化的 discriminated-union 事件**（`EventMsg`），UI 只管订阅/渲染，不碰 agent 内部。这比回调地狱清晰得多。

### 2.4 命令流 `Op`（UI → agent，`protocol.rs` L540，部分变体）
`Interrupt`、`CleanBackgroundTerminals`、`TurnInput{request, mode, reply: oneshot}`、`RecoverTurn`、`ThreadSettings`、`InterAgentCommunication`、`ExecApproval{id, turn_id, decision}`、`PatchApproval{id, decision}`、`ResolveElicitation`、`UserInputAnswer`、`RequestPermissionsResponse`、`DynamicToolResponse`、`RefreshMcpServers`、`ReloadUserConfig`、`Compact`、`ThreadRollback{num_turns}`、`Review`、`ApproveGuardianDeniedAction`、`Shutdown`、`RunUserShellCommand{command}`（**`!cmd` 一行命令**）。另有 Realtime 走 `RealtimeConversation*`。

### 2.5 工具调度
- `tools` crate（`tools/src/tool_call.rs`）：
  - `ToolCall { turn_id, call_id, tool_name, model, codex_turn_metadata, truncation_policy, conversation_history, turn_item_emitter, environments, payload }`
  - `ToolEnvironment { environment_id, cwd, file_system, file_system_sandbox_context }`
  - `TurnItemEmitter` trait（`emit_started` / `emit_completed`）——**工具执行也可发布可见 turn-item**。
- `ToolExecutor` + `ToolExposure(s)`（tools 对 UI/MCP 的暴露面）、`ToolSpec` / `ToolDefinition`（转 Responses API 工具）、`json_schema::parse_tool_input_schema`、`dynamic_tool`、`mcp_tool`、`tool_config`（`ToolEnvironmentMode`、`UnifiedExecFeatureMode`）。
- core 侧：`exec_env`/`exec_policy`（Starlark 规则）、`unified_exec`、`user_shell_command`。`Shell`（`core/src/shell.rs`）负责把命令字符串用用户的 login shell 参数化执行（`derive_exec_args`）。
- **派发链路**（`core/src/tools/`）：流里的工具调用以 `ResponseItem::FunctionCall`/`CustomToolCall`/`LocalShellCall`/`WebSearchCall` 等出现 → `handle_output_item_done` → `ToolCallRuntime::handle_tool_call`（`tools/parallel.rs` L73）→ **`ToolRouter::build_tool_call`**（router.rs）把 `ResponseItem`→`ToolCall` → `dispatch_tool_call_with_terminal_outcome` → **`ToolRegistry::dispatch_any_with_terminal_outcome`**（`registry.rs` L481，按 `ToolName` 查 `RegisteredTool` handler，找不到/不匹配返回 `FunctionCallError::RespondToModel`）。派发期间先跑 **PreToolUse hooks**，执行后跑 **PostToolUse hooks**（可 `block`/附加 feedback）。
- **工具集构建**：`build_tool_router()`（spec_plan.rs）汇总 核心工具 + MCP + DynamicTool + 多 agent 工具，暴露级别分 **model-visible / hidden / deferred(tool_search)**。hooks 引擎在独立的 `codex-rs/hooks` crate（PreToolUse/PermissionRequest/PostToolUse…）。
- **统一审批流水线**：`ToolOrchestrator`（`tools/orchestrator.rs`）把 审批→选 sandbox→run→被拒重试 串成一条流水线；`sandboxing.rs` 提供 `Approvable`/`ToolRuntime`/`ExecApprovalRequirement{Skip|NeedsApproval|Forbidden}`；Guardian reviewer（`guardian/review.rs`/`review_session.rs`）低风险命令自动批准、连拒 3 次切人工（cyber 模型 1 次）。
- **并行 & 重新提示**：tool future 压入 `in_flight: FuturesOrdered`（读/写锁控制并发），采样流结束后 `drain_in_flight` 等它们完成；每个工具结果 `ToolOutput::to_response_item()` 转成 `ResponseInputItem` 写入 history，置 `needs_follow_up=true` → `run_turn` 回顶**再次采样**，直到模型给出纯 assistant 消息。
- **审批钩子位置**：审批不是“注册 tool 时的统一入口”，而是**每个工具 runtime（shell/unified_exec/apply_patch/mcp/network）按权限 profile 评估到需要批准时**，统一走 `tools/approvals.rs::request_approval`（L452）。优先级（源码注释）：**① Permission hooks（`run_permission_request_hooks`）→ ② Guardian 自动审查 或 用户交互**（`request_reviewer_approval` 按 `strict_auto_review`/MCP policy 选 Guardian/User；`request_user_approval` 发 `ExecApprovalRequest`/`RequestPermissions` 给 UI；Guardian 对低风险命令自动批准，连拒 3 次切人工）。

### 2.6 系统提示词 / 上下文
- `prompts` crate 提供**片段**：`PermissionsInstructions`、`ApprovalPromptContext`、`REVIEW_PROMPT`、`SUMMARIZATION_PROMPT`、realtime `START_INSTRUCTIONS`/`END_INSTRUCTIONS`。系统提示词由 fragment 拼装（`codex_delegate.rs` + `agent` 模块 + `tools`），并支持 `AGENTS.md`（`core/src/agents_md.rs`，默认文件名 `AGENTS.md`、本地 `AGENTS.md`）。
- context/压缩：`compact*`（token 预算、远端压缩 v2、内存摘要）；`tool_output_token_limit`、`model_context_window` 控制历史预算；`AgentMessage` 有 `phase` 与 `memory_citation`。

> 注：没有名为 `AgentConfig` / `write_system_prompt` / `TurnBegin/TurnEnd/TurnPartStateUpdate` / `LogicPump` / `LogicModel` / `CodexReasoningExtension` 的实体——这些是被 AI 生成文档误导的名称。真实等价物为：系统提示=`base_instructions`+`WorldState` 片段（§2.2b）、事件=`EventMsg`（§2.3）、推理门槛=Responses 的 `reasoning.{effort,summary,context}`（无独立阈值 token 泵）、next-turn 判定=`SamplingRequestResult.needs_follow_up`。

---

## 3. TUI / REPL

> 已本地核对 `codex-rs/tui/` 源码（无 `docs/tui.md`，依赖为 ratatui+crossterm）。

### 3.1 渲染栈
- `tui/Cargo.toml` 明确依赖 `ratatui`（`scrolling-regions` / `unstable-*` features）、`ratatui-macros`、`crossterm`（`bracketed-paste`,`event-stream`）、`pulldown-cmark`（markdown）、`syntect` + `two-face`（语法高亮）、`diffy`（diff 渲染）、`textwrap`、`arboard`（剪贴板）。
- `tui/src/tui.rs`：`pub type Terminal = CustomTerminal<CrosstermBackend<Stdout>>`，`init()` 用 `CrosstermBackend::new(stdout())`；启用 `SynchronizedUpdate`（减少撕裂）、bracketed-paste、焦点事件（非 Windows）。

### 3.2 App 结构与主循环
- `main.rs → lib.rs::run_main → run_ratatui_app`。入口处理 alt-screen / raw-mode、AppServer 会话、onboarding/update/resume。
- `app.rs` 的 `App` 结构 + **主循环**（`tokio::select!` 并发监听 4 路）：内部 `AppEvent`、当前线程 `active_thread_rx`、终端事件 `TuiEvent`、AppServer 通知流 `next_event()`。渲染由 `FrameRequester` 节流调度到 `Tui::draw()`。
- 组件：`ChatWidget`（`active_cell` 流式 + `transcript_cells` 已提交，均实现抽象 `HistoryCell`）、`BottomPane`（`ChatComposer` + 弹窗栈 `view_stack`）、`ExecCell`（工具执行卡片）、`StatusIndicator`。
- **事件订阅**：App 为每 thread 维护 `thread_event_channels: HashMap<ThreadId, ThreadEventChannel>`，`active_thread_rx` 消费当前线程缓冲事件（容量 **32768**）。投递分两类：**无损**（transcript 增量、设置更新、turn 完成——必须送达）与**尽力而为**（进度、命令输出 delta——饱和可丢弃防 UI 卡顿）。
- **事件总线 `AppEvent`**（`app_event.rs`）：UI 组件之间不直接握手，全部发 `AppEvent` 到 app 层处理（如 `FullScreenApprovalRequest(ApprovalRequest)`、`OpenApprovalsPopup`、`UpdateAskForApprovalPolicy`、各 `Consolidate*` 流合并事件、`Exit(ExitMode)`）。
- 流式合并：`ConsolidateAgentMessage` / `ConsolidateProposedPlan` 把一长串流式 `AgentMessageCell` 在流结束时**合并成单个源可复用的 `AgentMarkdownCell`**（resize 时重新渲染）。

### 3.3 输入 / 命令面板
- `ChatComposer` 的 `TextArea` + 3 种**内联补全弹窗**：`/`→CommandPopup、`@`→FileSearchPopup、`$`→SkillPopup。
- `/` slash 命令（`slash_command.rs`，真实 `pub enum SlashCommand`，strum kebab-case，枚举顺序=弹窗展示顺序）：`/model` `/ide` `/permissions` `/keymap` `/vim` `/setup-default-sandbox` `/sandbox-add-read-dir` `/experimental` `/approve`(=AutoReview：批准一次 auto-review 自动评审被拒后的重试，**不是**普通权限批准) `/memories` `/skills` `/import`(Claude Code 迁移) `/hooks` `/review` `/rename` `/new` `/archive` `/delete` `/resume` `/fork` `/app` `/init` `/compact` `/plan` `/goal` `/agent`(/multi-agents，切副代理) `/side`/`/btw` `/copy` `/export` `/raw` `/diff` `/mention` `/status` `/usage` `/debug-config` `/title` `/statusline` `/theme` `/pets`(`pet` 别名) `/mcp` `/apps` `/plugins` `/logout` `/quit`/`/exit` `/feedback` `/rollout`(debug) `/ps` `/stop`(`clean` 别名) `/clear` `/personality` `/test-approval`(debug) `/subagents` `/debug-m-drop` `/debug-m-update`。
  - 注意：**`/help`、`/cost`、`/session` 未找到**。`?` 看快捷键；用量用 `/usage`；会话管理用 `/resume` / `Ctrl+T`。
  - 官方命令文档入口：https://github.com/openai/codex/blob/main/docs/slash_commands.md （转 https://developers.openai.com/codex/cli/slash-commands ）。`docs/tui.md` **不存在**。

### 3.4 默认快捷键（`keymap.rs::built_in_defaults()`，真实绑定）
- **App**：`Ctrl+T` 打开 transcript、`Ctrl+G` 外部编辑器、`Ctrl+O` 复制、`Ctrl+L` 清屏、`Alt+R` 切换 raw 输出。
- **Chat**：`Esc` 中断 turn、`Alt+,`/`Alt+.`（或 `Shift+↓`/`↑`）调低/调高 reasoning effort、`Alt+↑`/`Alt+↓` 编辑已排队消息。
- **Composer**：`Enter` 提交、`Tab` 入队、`?`/`Shift+?` 快捷键面板、`Ctrl+R`/`Ctrl+S` 历史搜索。
- **Editor**：一般行内编辑（`Ctrl+J/M`/Enter 换行；`Ctrl+B/F/P/N` 方向；`Ctrl+A/E` 行首尾；`Ctrl+H`/`Ctrl+D` 退格/删；`Alt+Backspace` 删词…）。
- 键位可用 **`/keymap` 重映射**，配置文件有 `[tui] keymap`（`config/src/tui_keymap.rs` 的 `TuiKeymap` → `RuntimeKeymap`，支持 context/global/default 优先级 + 唯一性校验）。

### 3.5 流式输出与 Ctrl+C 退出
- 流式：`tui/src/streaming/` 的 `StreamController` + `AdaptiveChunkingPolicy`（**Smooth** 每 tick 吐 1 行 vs **CatchUp** 一次排空）驱动 **commit-animation queue**（`commit_tick.rs::run_commit_tick`）→ 打字机式的逐行提交动画；`FrameRequester::schedule_frame_in(duration)` 定时驱动重绘。
- 工具执行：`exec_cell/model.rs` 的每条 `ExecCall` 记录命令/`ParsedCommand`/输出/`duration`/`source`/`start_time`，运行时 `live_output.append_output` 就地流式累积（含退出码）。agent 消息、用户消息、diff、shell 执行都是独立 `HistoryCell`。
- Ctrl+C（`chatwidget/interaction.rs::on_ctrl_c`）：① 先让弹窗/激活 view 消费；② 若开启**双重按退出**，第一次 arm（带超时窗口 + footer 提示）、过期前再按才退出；③ **有可取消任务或 review 模式时发 `AppCommand::interrupt()`（底层 `turn_interrupt` RPC）中断 turn，而非退出**；④ 空闲才 `request_quit_without_confirmation`。Ctrl+D 仅在 composer 空且无弹窗时参与退出。异常/正常退出走 `HandleExit` → app_server shutdown → `tui.terminal.clear()` 退出 alt-screen。
- 编辑器 kill-buffer：`Ctrl+K`（删到行尾进循环剪贴板）/`Ctrl+Y`（粘贴）、`Ctrl+U` 删到行首——Emacs 风味，可借鉴。

---

## 4. 权限 / 审批

### 4.1 核心模型（非逐工具）
- `protocol/src/protocol.rs`：
  - `AskForApproval`（`approval_policy` 值）：`UnlessTrusted`(serde `untrusted`)、`OnRequest`(默认；模型自行决定何时要审批)、`Granular(GranularApprovalConfig)`、`Never`。
  - `GranularApprovalConfig { sandbox_approval, rules, skill_approval, request_permissions, mcp_elicitations }` —— **细粒度按“类别”**开关，且 true 表示该类别允许、false 表示直接拒（不弹窗）。
  - `SandboxPolicy`（模式判别联合）：`DangerFullAccess`、`ReadOnly{network_access}`、`ExternalSandbox`、`WorkspaceWrite{writable_roots, network_access, exclude_tmpdir_env_var, exclude_slash_tmp}`。
- `protocol/src/permissions.rs`：`PermissionProfile`、`FileSystemSandboxPolicy`、`WritableRoot{root, read_only_subpaths, protected_metadata_names}`（在可写根里把 `.git/`、`.codex/` 等保留只读，防止提权）。
- 内置权限画像（`utils/approval-presets/src/lib.rs::builtin_approval_presets()`，字符串原文）：
  - `read-only`「Read Only」：可读、改文件/联网需审批。
  - `auto`「Default」（= Agent 模式）：读+改工作区+跑命令；联网/改别处需审批。
  - `full-access`「Full Access」：`approval_policy=Never` + DangerFullAccess，可读可访问任意地，**官方警告 Exercise caution**。

### 4.2 审批 UI（`tui/src/bottom_pane/approval_overlay.rs`，字符串原文）
- 标题：命令 `"Would you like to run the following command?"`；网络 `"Do you want to approve network access to \"{host}\"?"`；权限画像 `"Would you like to grant these permissions?"`；文件 `"Would you like to make the following edits?"`；MCP `"{server_name} needs your approval."`。
- 选项（对应 `ReviewDecision`）：
  - 命令：`Yes, proceed` / `Yes, and don't ask again for this command in this session`(会话内记住) / `Yes, and don't ask again for commands that start with \`{prefix}\``(按前缀记住) / `No, continue without running it` / `No, and tell Codex what to do differently`。
  - 网络：`Yes, just this once` / `... allow this host for this conversation` / `... allow this host in the future` / `No, and block this host in the future`。
  - 权限：`Yes, grant these permissions for this turn` / `... for this session` / `No, continue without permissions`。
  - 文件：`Yes, proceed` / `... don't ask again for these files` / `No, and tell Codex what to do differently`。
- 早期版本（tag `31d0d7a305`）是 `user_approval_widget.rs`，标题 `"Allow command?"` / `"Allow changes?"`，选项 `Yes (y)` / `Yes, always approve this exact command for this session (a)` / `Edit or give feedback (e)` / `No, and keep going (n)` / `No, and stop for now (esc)`。

### 4.3 裁决模型 `ReviewDecision`（`protocol.rs` L3851，字符串/语义原文）
`Approved` / `ApprovedExecpolicyAmendment{proposed}`（批准并改规则）/ `ApprovedForSession` / `ApprovedMcpPolicyAmendment` / `NetworkPolicyAmendment{...}` / `Denied{rejection}` / `TimedOut` / `Abort`。
→ **这就是“审批状态机”的权威枚举**，对应“执行一次 / 本会话 / 记住(改规则) / 拒绝并继续 / 拒绝并中止”。

### 4.4 记住/持久化
- `PermissionGrantScope::{Turn, Session}`（内存级，`protocol/src/request_permissions.rs`）。
- 「按前缀记住」→ 注入 `ApprovedCommandPrefixSaved` developer 上下文片段（`core/src/context/approved_command_prefix_saved.rs`），本会话内避免再触发审批。
- 跨会话：选择“加入 execpolicy”会写入 `.rules`/`.star`（用户级 `~/.codex/execpolicy/` 或项目级 `.codex/execpolicy/`），其 `decision = "allow"|"prompt"|"forbidden"`；网络 host 写 `network_policy`。
- `codex exec`（无人值守）恒为 `approval_policy="never"`。

### 4.5 CLI 审批旗标（`utils/cli/src/shared_options.rs` / `approval_mode_cli_arg.rs`）
- `--sandbox <MODE>`（read-only / workspace-write / danger-full-access，别名 `-s`）。
- `--approve-for-me`（别名 `--not-so-yolo`）= 自动审批 + workspace-write，写出 3 条 override（`approvals_reviewer=auto_review`、`approval_policy=on-request`、`sandbox_mode=workspace-write`）。
- `--dangerously-bypass-approvals-and-sandbox`（别名 `--yolo`）：跳过全部确认且禁用沙箱，源码注释 “EXTREMELY DANGEROUS”。
- `--approval-mode untrusted|on-request|never` → `AskForApproval`。
- `--add-dir <DIR>` 追加可写根、`-C/--cd`、`-p/--profile`。
- **`--full-auto`、`-a/--ask-for-approval`、`--always-allow` 当前版查无**（`-a`/`--ask-for-approval` 是 `codex-tui` 的 CLI 里有的旧拼写；当前主入口用上述旗标）。

---

## 5. 配置（config.toml）

> 注意：`codex-rs/config.md` 与 `docs/config.md` 都是跳转/空壳页，完整参考在 [developers.openai.com/codex/config-reference](https://developers.openai.com/codex/config-reference)（Mintlify 镜像：https://mintlify.wiki/openai/codex/configuration/reference ）。

### 5.1 位置与分层
- 全局 `~/.codex/config.toml`（`CODEX_HOME` 可覆盖）；项目级 `.codex/config.toml`（`project_root_markers`，默认 `[".git"]`）。
- 配置**分层合并**（后覆盖前）：内置默认 → 全局 → 项目 → profile（`-p`）→ CLI flags → 环境变量。
- 其它：`auth.json`、`history.jsonl`、`log/`、`sessions/`、`archived_sessions/`、`skill/`、`execpolicy/`；新版状态存 SQLite（`sqlite_home`）。

### 5.2 `ConfigToml` 顶层键（`config/src/config_toml.rs`，deny_unknown_fields）
`model, review_model, model_provider, model_context_window, model_auto_compact_token_limit(_scope), approval_policy, approvals_reviewer, auto_review, shell_environment_policy, allow_login_shell, sandbox_mode, sandbox_workspace_write, default_permissions, permissions, notify, instructions, developer_instructions, include_permissions_instructions, …, model_instructions_file, compact_prompt, mcp_servers, mcp_oauth_*, model_providers, project_doc_*, tool_output_token_limit, profile(s), history, sqlite_home, log_dir, file_opener, tui, hide_agent_reasoning, show_raw_agent_reasoning, model_reasoning_effort, plan_mode_reasoning_effort, model_reasoning_summary, model_verbosity, model_catalog_json, personality, service_tier, chatgpt_base_url, responses_api_metadata, orchestrator, openai_base_url, audio, realtime, projects, web_search, tools, tool_suggest, agents, goals, memories, skills, hooks, plugins, marketplaces, features, ghost_snapshot, check_for_update_on_startup, disable_paste_burst, analytics, feedback, apps, desktop, otel, windows, notice, experimental_*..., oss_provider`

关键默认/取值：
- `model` 默认 `"o4-mini"`（示例 `gpt-4.1`/`gpt-5.1`/`gpt-5.1-codex`）。
- `approval_policy`：`untrusted`/`on-request`/`never`，或对象 `[approval_policy.reject]`（`rules`/`sandbox_approval`/`mcp_elicitations`）。
- `sandbox_mode`：`read-only`/`workspace-write`/`danger-full-access`。
- `[sandbox_workspace_write]`：`writable_roots`/`network_access`/`exclude_tmpdir_env_var`/`exclude_slash_tmp`（**只有这 4 个字段，没有 `approvals`/`commands`/`allow`/`deny`**）。
- `web_search`：`disabled`/`cached`/`live`。
- `model_reasoning_effort`：`none|minimal|low|medium|high|xhigh`；`model_reasoning_summary`：`auto|concise|detailed|none`。
- `[model]` 表不存在（`model` 是标量）；`[experimental]` 表不存在（改用了 `experimental_*` 键 + `[features]`）；`[sandbox_read_only]` 表不存在（只读是 `sandbox_mode` 的一个值）；`[lsp]` 不存在；`[approvals]`（复数表）不存在。
- **`temperature`/`top_p`/`max_tokens`/`default_encoding`/`tracing_enabled`/`output_style`/`debug` 全局键均 not found**（token 用 `model_context_window`/`model_max_output_tokens`/`model_auto_compact_token_limit`；日志用 `RUST_LOG`/`[otel]`；输出风格用 `model_verbosity`/`[tui]`）。

### 5.3 `[model_providers]`
TOML map，键为 provider id；Rust 类型 `ModelProviderInfo`（`model-provider-info/src/lib.rs`）：`name`、`base_url`、`env_key`、`env_key_instructions`、`wbearer_token`、`auth`(`ModelProviderAuthInfo`)、`aws`(SigV4)、`wire_api`（**仅 `Responses`**）、`query_params`、`http_headers`、`env_http_headers`、`request_max_retries`(默认3)、`stream_max_retries`、`stream_idle_timeout_ms`、`websocket_connect_timeout_ms`、`requires_openai_auth`、`supports_websockets`、`supports_standalone_web_search`。

```toml
model_provider = "openai"
model = "gpt-4.1"
[model_providers.openai]
name = "OpenAI"
base_url = "https://api.openai.com/v1"
env_key = "OPENAI_API_KEY"
[model_providers.deepseek]
name = "DeepSeek"
base_url = "https://api.deepseek.com"
env_key = "DEEPSEEK_API_KEY"
```
内置 Provider：OpenAI、Azure OpenAI、Anthropic、OpenRouter、Ollama、LM Studio、Together、Mistral、DeepSeek、Groq、xAI、Gemini。保留 id：`OPENAI_PROVIDER_ID`、`AMAZON_BEDROCK_PROVIDER_ID`、`OLLAMA_OSS_PROVIDER_ID`、`LMSTUDIO_OSS_PROVIDER_ID`。
- `-m/--model` 优先级最高；`-c/--config KEY=VALUE` 是**覆盖某项配置**（点号定位），并非指向配置文件。

### 5.4 当前 CLI 旗标（`codex` 主命令，新架构）
`-m/--model`、`--oss`、`--local-provider`、`--full-auto`、`--sandbox`、`--ask-for-approval`、`--dangerously-bypass-approvals-and-sandbox`、`-i/--images`、`--add-dir`、`--search`、`-C/--cwd`、`--ephemeral`、`--skip-git-repo-check`、`-p/--profile`、`-c KEY=VALUE`、`--enable/--disable <feature>`。
注意：`--config`/`-c` 的语义是**覆盖某项配置**（值为 TOML 片段，可点号定位，如 `-c model=gpt-4.1`、`-c sandbox_mode=workspace_write`），**并非**指向某个配置文件。`codex exec` 走审批 `never` + `ExecCommand*` 事件流（无人值守）；`codex debug` 是子命令（app-server 调试），无全局 `--debug` 旗标。

---

## 6. 对 JS/Node (dsh-tui) 可借鉴清单

### 6.1 架构
1. **引擎与 UI 完全解耦**（如 `core` 的 `deny print_stdout/stderr`）：agent 逻辑不碰终端；所有输出走事件。JS 可用 `ts-node`/`worker_threads` 或纯异步分层实现同样的约束。
2. **双消息流（事件流 + 命令流）解耦**：用 discriminated-union（可 JSON 序列化）事件建模每步；UI→agent 用命令总线，通过 `onechot`/回执语义（如 `TurnInput{reply: oneshot}`）保证有界等待。
3. **统一领域协议 crate**（对应 `protocol`）：把 `EventMsg`、`Op`、`AskForApproval`、`SandboxPolicy`、`ReviewDecision`、`ResponseItem` 放一个纯 TS 包，`core`/`tui`/`cli` 共享。这是一切的基础。

### 6.2 Agent 循环 & 流式
4. **turn 的三个状态机**：`Started/Steered/NotSubmitted`，外加 `Interrupt`/`RecoverTurn`/`Compact` 显式命令。JS 用 async-iterable + AbortController + 可恢复游标。
5. **Responses-API 风格 Prompt**：`{input: ResponseItem[], tools: ToolSpec[], parallel_tool_calls, base_instructions, output_schema}`；流式 `ResponseStream` 用推送管道（mpsc 迁移到 Node 的 `ReadableStream`/`AsyncIterator`），**Drop → 通知服务端取消**（背压/取消）。
6. **事件枚举直接照抄**：`TurnStarted/TurnComplete/AgentMessage(phase)/AgentReasoning/SectionBreak/TokenCount/ExecCommandBegin/OutputDelta/End/ExecApprovalRequest/…`。JS 版建议 1:1 建模，UI 层才容易做增量渲染。
6b. **多 agent 用“多线程 + 事件级联 + 父代 Op”**：delegate 以独立线程跑且 `approval_policy=never`，只把公共事件转回父会话。JS 用 `worker_threads` 或独立对象 + 事件订阅即可复刻。

### 6.3 审批状态机
7. **`ReviewDecision` 八个分支**：`Approved / ApprovedForSession / Denied{rejection} / Abort / TimedOut / ApprovedExecpolicyAmendment / ApprovedMcpPolicyAmendment / NetworkPolicyAmendment`。JS 侧据此定义审批状态机 + 待决队列（turn 挂起等 UI 回包）。
8. **三档+粒度审批**：`AskForApproval{UnlessTrusted, OnRequest, Granular, Never}`（`Never` = 静默 `exec`）。JS 甚至可先实现 `OnRequest` + `Never` 两档。
9. **审批记忆三态**：只此一次（`PermissionGrantScope::Turn`）/ 本会话（`Session`）/ 永久（写入允许规则文件）。JS 落在 `Map<Turn>` + `Map<Session>` + 持久化 JSON 即可。
10. **呈现文案**可直接参考原文（“Would you like to run…？” / “Yes, and don't ask again…” 等）。

### 6.4 TUI
11. **终端栈**：Node 侧等价物是 `blessed-react`/`ink`/`neo-blessed`/自绘（对应 ratatui+crossterm）。要点：**alt-screen + bracketed-paste + 同步更新 + focus events**（对应 crossterm 那几条 feature）。
12. **单事件总线 `AppEvent`**：组件不握手，统一发事件（含 `Exit(ExitMode)`、`ConsolidateAgentMessage`）。JS 用 EventEmitter/简单 pub-sub 即可复用这套心智。
13. **流式合并**：流结束时把一长串 `AgentMessageCell` 合并成一个“源可复用”的渲染单元（resize 重渲染）——JS 里保存原文 markdown，仅在 resize/定稿时重新 parse+渲染，性能好。
14. **打字机渐进渲染**：commit 动画队列 + 自适应 chunking（Smooth/CatchUp），别每 token 整屏重绘。
15. **Ctrl+C 语义**：有任务未完成时打断 turn（发 interrupt 而不是退出）；空闲才退出；退出分正常/立即两档。
16. **命令面板多路补全**：`/` 命令、`@` 文件、`$` skill 三套弹窗；`/import` 做 Claude Code 迁移。
17. **可重映射键位**：配置驱动 keymap（context/global/default 优先级 + 冲突校验）。

### 6.5 配置
18. **分层合并 + deny_unknown_fields**开箱即错：内置默认→全局→项目→profile→CLI→env。JS 用 json-schema 校验 + 逐层 merge。
19. **`[model_providers]` 复用**：provider 抽象（base_url/env_key/auth/wire_api/超时），天然支持 OpenAI/DeepSeek/本地等服务。
20. **沙箱分级**：JS 无法等价 OS 沙箱，但可抽象 `SandboxPolicy`（read-only/workspace-write/danger-full-access）接口，read-only 可在 JS 层拦截写操作/网络，danger-full-access 直接透传。
21. **execpolicy（命令前缀 allow/deny/prompt）** 做成独立模块，审批“记住”写这里——清晰且跨会话。

### 6.6 工程化
22. **会话持久化（rollout）**：`sessions/*.jsonl` + archived + cursor 翻页/恢复；JS 存 JSONL 最省事。
23. **工作区文档约定 `AGENTS.md`** 读取/注入/校验。
24. **诊断**：`RUST_LOG`/`[otel]` 风格结构化日志 + `debug-config` 子命令（展示当前生效的各层配置来源）。

---

## 附录 A：主要信源（URL）

- 工作区 Cargo.toml（crate 全清单）：https://github.com/openai/codex/blob/main/codex-rs/Cargo.toml
- core 模块 & 禁 stdout 约束：https://github.com/openai/codex/blob/main/codex-rs/core/src/lib.rs
- 事件/命令/审批/沙箱协议：https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs
- turns/线程 API：https://github.com/openai/codex/blob/main/codex-rs/core/src/codex_thread.rs
- client/模型调用：https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs 、client_common.rs
- tools crate：https://github.com/openai/codex/blob/main/codex-rs/tools/src/lib.rs 、tool_call.rs
- prompts crate：https://github.com/openai/codex/blob/main/codex-rs/prompts/src/lib.rs
- TUI：`codex-rs/tui/Cargo.toml`、`tui/src/app.rs`、`tui.rs`、`keymap.rs`、`slash_command.rs`、`chatwidget.rs`、`streaming/controller.rs`、`exec_cell/model.rs`、`chatwidget/interaction.rs`、`bottom_pane/approval_overlay.rs`
- CLI flag：`codex-rs/utils/cli/src/shared_options.rs`、`approval_mode_cli_arg.rs`、`codex-rs/tui/src/cli.rs`
- 配置：`codex-rs/config/src/config_toml.rs`（schema）、`config/src/types.rs`、`codex-rs/model-provider-info/src/lib.rs`
- 审批预设：`codex-rs/utils/approval-presets/src/lib.rs`
- 沙箱：`codex-rs/protocol/src/permissions.rs`、`protocol/src/protocol.rs`(SandboxPolicy)、历史 `config.md @ 80b00a193e / 0f3cc8f842`
- **主循环** `Session::run_turn`：`codex-rs/core/src/session/turn.rs`；工具派发 `core/src/tools/registry.rs`、`parallel.rs`、`orchestrator.rs`、`approvals.rs`；系统提示 `core/src/context/world_state/` + `session/world_state.rs`；hooks crate `codex-rs/hooks`。
- **Responses 传输**：`codex-rs/codex-api/src/sse/responses.rs`（SSE）、`codex-rs/codex-api/src/endpoint/responses_websocket.rs`（WS）。
- **文档/镜像**：https://developers.openai.com/codex/config-reference 、https://mintlify.wiki/openai/codex/concepts/approvals 、https://mintlify.wiki/openai/codex/configuration/reference
- **DeepWiki 架构分节**：https://deepwiki.com/openai/codex/2.1-agent-loop-system 、3.2-model-client-and-api-communication 、3.3-turn-execution-and-prompt-construction 、3.4-event-processing-and-state-management 、3.11-hooks-system 、5.5-tool-orchestration-and-approval
- **重导出命名**：https://docs.rs/agcodex-protocol/latest/agcodex_protocol/protocol/enum.EventMsg.html

## 附录 B：勘误（对比用户问题的猜测）
- ❌ 无 `ToolUsePolicy` / 逐工具 `yes/no/read-only/ask`（→ 那是 Claude Code）。
- ❌ 无 `[sandbox_read_only]`、`[approvals]`、`[model]`、`[experimental]`、`[lsp]` 表。
- ❌ 无 `temperature/top_p/max_tokens/default_encoding/tracing_enabled/output_style/debug` 全局键。
- ⚠️ `-a`/`--ask-for-approval`、`--full-auto`、`--always-allow` 为旧/社区名称；当前用 `--approve-for-me`、`--sandbox`、`--approval-mode`、`--dangerously-bypass-approvals-and-sandbox`。
- ⚠️ `[sandbox_workspace_write]` 只有 `writable_roots/network_access/exclude_tmpdir_env_var/exclude_slash_tmp`，无命令清单字段（`commands/allow/deny` 属 Claude Code）。
- 旧版 prompt 字符串 “Allow command?” 已成历史；当前为 “Would you like to …?” 系列。
- ❌ **agent-loop 误名（跨 6 个 git 标签逐文件核实不存在）**：`LogicPump` / `LogicModel` / `write_system_prompt` / `AgentConfig` / `CodexReasoningExtension` / `TurnBegin` / `TurnEnd` / `TurnPartStateUpdate` —— 均属 AI 生成文档误名。真实等价物：主循环=`Session::run_turn`；系统提示=`base_instructions`+`WorldState` 片段；事件=`EventMsg`（`TurnStarted/TurnComplete`，re-export 层 `agcodex-protocol` 才叫 `TaskStarted/TaskComplete`）；next-turn=`SamplingRequestResult.needs_follow_up`；推理门槛=Responses `reasoning.{effort,summary}`（无独立阈值 token 泵）。模型调用走 **Responses API**（HTTP-SSE / WebSocket V2），**非 ChatCompletion**。
