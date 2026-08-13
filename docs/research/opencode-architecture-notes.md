# OpenCode（sst/opencode）源码架构研究笔记

> 面向 dsh-tui（JS/Node 实现的 DeepSeek Harness 终端客户端）的移植参考。
> 本笔记基于**真实源码**撰写，所有文件路径均为 clone 下来的 Go 版本实际存在的源文件。

## ⚠️ 重要事实更新：仓库已重写（Go → TypeScript）

你必须先知道这一点，否则方向会错：

- **原名 sst/opencode 的仓库现在已经改名/迁移到 `anomalyco/opencode`**（GitHub 自动重定向）。
- 其 `main`/`dev` 分支目前已经是**用 TypeScript 重写的新版本**（SST monorepo 风格：`packages/`、`sdks/`、`sst.config.ts`、`CONTEXT.md` 等），**不再有 Go 代码**。我本地 clone 后检查 `dev` 分支确认 **0 个 `.go` 文件**；原来的 `internal/`、`cmd/` 结构已消失，改成了 `packages/app`、`packages/core`、`packages/tui`、`packages/server`、`packages/sdk` 等。
- 你研究目标所指的 **"Go 语言、bubbletea TUI、internal/ 包结构" 版本，是旧版本**，仍保留在 git tag `v0.0.52`（commit 日期 2025-05-22，commit message "switch default to claude sonnet 4"，go.mod 声明 `module github.com/sst/opencode`，go 1.24.0）。

**因此本笔记基于 tag `v0.0.52` 的真实 Go 源码撰写**（我用 `git checkout v0.0.52` 在本地完整检出了那一版）。如果你平时看到的最新版 OpenCode 文档/DeepWiki 描述的是 TS 版，注意区分。

参考 URL：
- 仓库当前主分支（TS 版）：https://github.com/anomalyco/opencode
- 旧 Go 版 tag 可直接浏览：例如 https://github.com/anomalyco/opencode/blob/v0.0.52/internal/tui/page/logs.go
- pkg.go.dev 索引了旧 Go 包：https://pkg.go.dev/github.com/sst/opencode
- DeepWiki 对本项目的分析（混合新旧两版，需甄别）：[Architecture Overview](https://deepwiki.com/sst/opencode/1.2-architecture-overview)、[Permission System](https://deepwiki.com/sst/opencode/5.2-permission-system)、[TUI State Management](https://deepwiki.com/sst/opencode/6.3-tui-state-management)

---

## 1. 项目结构与模块分层（Go 版 v0.0.52）

### 顶层入口
- `main.go`：仅 15 行。`defer logging.RecoverPanic(...)` 兜底 + `cmd.Execute()`。

### `cmd/`（cobra CLI）
- `cmd/root.go`（全部关键布线都在这）：
  - CLI 框架 `spf13/cobra`，配置框架 `spf13/viper`。
  - flags：`-d/--debug`、`-c/--cwd`、`-p/--prompt`（非交互单次执行）、`-f/--output-format`(text/json)、`-q/--quiet`、`--allowedTools`/`--excludedTools`（工具白/黑名单，二选一）。
  - 非交互模式（`--prompt`）走 `handleNonInteractiveMode`，**不启动 TUI**；交互模式则启动 bubbletea。
  - 启动顺序：初始化 slog logger（带 SessionID 的 handler）→ `config.Load()` → `discovery.IntegrateLSPServers(cwd)`（LSP 自动发现）→ `db.Connect()`（SQLite，自动跑 migration）→ `app.New(ctx, conn)` → `zone.NewGlobal()`（`lrstanley/bubblezone` 用于鼠标区点击）→ `tea.NewProgram(tui.New(app), tea.WithAltScreen())`。
  - `setupSubscriptions()`：把 **5 个 service 的 pubsub 事件（logging/sessions/messages/permissions/status）桥接成 `tea.Msg`，通过 `program.Send(msg)` 注入 TUI**。这是"后端服务 ↔ TUI"解耦的核心通道。

### `internal/` 包分层（共 25 个子包）

| 子包 | 职责 |
|---|---|
| `app` | 应用组装层。持有 `Sessions/Messages/History/Permissions/Status/Logs` 各大 service + `PrimaryAgent` + `LSPClients`；`New()` 里调用各 `InitService()`；`PrimaryAgent = agent.NewAgent(...)` |
| `db` | SQLite 持久层（`sqlc` 生成，含 `db/sql`、`db/migrations`） |
| `session` | Session 实体 + CRUD service（SQLite + pubsub 广播） |
| `message` | Message 实体 + 分段 Parts 序列化（`Parts []ContentPart`，多态 JSON）+ CRUD service |
| `history` | 文件历史版本跟踪（`File{Path,Version,Content}`，用于 sidebar 显示"修改的文件 + diff"） |
| `logging` | 日志 service |
| `status` | 状态消息 service（供状态栏的 info/warn/error 队列） |
| `permission` | **权限审批 service（重点研究，见 §4）** |
| `pubsub` | **泛型事件总线 Broker[T]（重点研究，见 §5 移植点）** |
| `llm` | LLM 层。含 `provider/`（anthropic/openai/gemini/azure/bedrock/vertexai 多实现）、`agent/`（多轮 Agent 循环）、`models/`（模型目录）、`prompt/`（系统提示词）、`tools/`（工具实现） |
| `llm/tools` | 工具：`bash`、`file`、`write`、`edit`、`patch`、`view`、`glob`、`grep`、`ls`、`fetch`、`batch`、`lsp_*`（code_action/definition/diagnostics/doc_symbols/references/workspace_symbols） |
| `llm/tools/shell` | 持久化 shell 会话（环境变量、cwd 跨命令保留） |
| `completions` | 文件/文件夹补全（rg/fzf/doublestar 多档降级策略） |
| `tui` | 整个 bubbletea 前端（见 §2） |
| `lsp` | LSP 客户端（`lsp/protocol`、`lsp/discovery`、`lsp/watcher` 文件监听） |
| `diff`、`format`、`fileutil`、`status`、`version` | 工具类 |

---

## 2. TUI 实现（bubbletea + lipgloss）

### 技术栈（go.mod 真实依赖）
- `charmbracelet/bubbletea v1.3.4`
- `charmbracelet/bubbles v0.21.0`（用到了 `textarea`、`viewport`、`key` 等）
- `charmbracelet/lipgloss v1.1.0`（样式与布局）
- `lrstanley/bubblezone`（鼠标区域）
- `github.com/charmbracelet/x/ansi`（字符串截断/宽度）
- 主题：`internal/tui/theme` + `lipgloss`

### 顶层模型 `internal/tui/tui.go`（appModel）
- **"一页一个 tea.Model" 的页面路由**：`pages map[PageID]tea.Model`，当前只有 `ChatPage` 与 `LogsPage`，`moveToPage`/`moveToPageUnconditional` 切换（agent busy 时禁止切页）。
- 维护一堆布尔开关 + 对应 dialog 组件：`showPermissions/showHelp/showQuit/showSessionDialog/showCommandDialog/showModelDialog/showInitDialog/showFilepicker/showThemeDialog/showMultiArgumentsDialog/showToolsDialog`。
- **所有 dialog 通过 `layout.PlaceOverlay()` 居中叠加在页面之上**——这是典型的"模态弹层"模式。
- `View()` 用 `lipgloss.JoinVertical(page, statusBar)` 拼成最终画面，再按需叠加各覆层。
- 内置了两个注册命令：`init`（生成 CONTEXT.md 记忆文件）与 `compact_conversation`（压缩会话）。
- 键盘映射集中管理（`keys = keyMap{...}`），如 `ctrl+s` 切换会话、`ctrl+k` 命令、`ctrl+f` 文件选择、`ctrl+o` 换模型、`ctrl+t` 换主题、`f9` 工具列表、`ctrl+c` 退出、`ctrl+_` 帮助。

### 主聊天页 `internal/tui/page/chat.go`
- 布局用 `layout.NewSplitPane(WithLeftPanel(messagesContainer), WithBottomPanel(editorContainer))`：**SplitPane 支持 left/mid/right/bottom 多面板**。
- `messages` 容器 渲染消息流；`editor` 容器（带顶边框）是底部输入框。
- 会话切换时 `setSidebar()` 把 `chat.NewSidebarCmp(app)` 作为**右侧面板**塞进 SplitPane（`SetRightPanel`），展示：logo/版本/仓库/cwd、当前 Session、LSP 列表、**修改文件清单（+上加 -下减）**。
- `/` 键 → `showCompletionDialog = true`，把 `completionDialog.View()` 用 `PlaceOverlay` 叠在编辑器正上方（输入框补全弹层）。
- `SendMsg` 处理：无 session 则先 `Sessions.Create` 建会话，再 `PrimaryAgent.Run()` 启动生成；`esc` 键 → `PrimaryAgent.Cancel(sessionID)` 中断当前生成。

### 输入框 `internal/tui/components/chat/editor.go`
- 基于 `bubbles/textarea`：`>` 提示符 + 多行输入。
- 特性：
  - **消息历史上下翻**（↑/↓ 在首/末行时导航 history，支持当前草稿暂存恢复）。
  - **外部编辑器**：`ctrl+e` → 写临时文件 → `os.Getenv("EDITOR")`（默认 nvim）`tea.ExecProcess` 打开，保存后读回作为消息。
  - **图片粘贴**：`ctrl+v` 从剪贴板取图片作为附件（最多 5 个），`ctrl+r` 进入删除附件模式。
  - Enter 发送；若行尾是 `\` 则转义为换行。

### 补全弹窗（slash/file 补全）
- Slash 命令入口在 `/`，实现见 `internal/completions/files-folders.go`：
  - **文件/文件夹补全**用 `rg` + `fzf` 管道（null 分隔输出），`rg`/`fzf` 缺失时逐级降级到"rg+fuzzy"→"fzf+doublestar glob"→"纯 doublestar+fuzzy"。
- 补全交互组件 `internal/tui/components/dialog/complete.go`：
  - `CompletionDialog` 内含一个隐藏 `textarea`（用于捕获输入） + `SimpleList` 列表，`GetChildEntries(query)` 按需刷新；`Tab/Enter` 确认选择 → 发出 `CompletionSelectedMsg{SearchString, CompletionValue}`，editor 收到后 `strings.Replace` 回填。
- 命令菜单 `internal/tui/components/dialog/commands.go`：`Command{ID,Title,Description,Handler}` 的列表，Enter 触发 `Handler`。

### 状态栏 `internal/tui/components/core/status.go`
- 一条 bar：左侧 help 提示（`ctrl+? help`，busy 时变 `? help`）、中间 token/成本（`Tokens: 1.1M (85%), Cost: $3.20`）、LSP 诊断计数（错误/警告/信息/提示，图标+数字）、当前模型名。
- **状态消息队列**：`StatusCmp` 内部维护一个 `queue []StatusMessage` + TTL（默认 4s），信息级消息普通入队轮播，critical 消息插队到队首；由 `tea.Tick(time.Second)` 驱动清理。

### 权限对话框 `internal/tui/components/dialog/permission.go`
- 三种操作：`Allow(a)` / `Allow for session(s)` / `Deny(d)`，左右/`Tab` 切换焦点，Enter/空格确认；view 用 `viewport`。
- **按工具类型渲染不同内容**：`bash` → 语法高亮命令行；`edit`/`write`/`patch` → `diff.FormatDiff` 渲染成彩色 diff；`fetch` → URL。diff/markdown 渲染带缓存。

---

## 3. Agent Loop（核心，`internal/llm/agent/agent.go`）

### 数据结构
- `AgentEvent{message, err}`：通过 `<-chan AgentEvent` 异步返回给调用方（TUI 的 `PrimaryAgent.Run(...)`）。

### 主循环 `processGeneration`
1. `prepareMessageHistory`：取会话；**若已有 summary**，则只取 summary 时间戳之后的 message，并在前面垫一条 assistant summary 消息（分层压缩）；否则拉全量。
2. 新会话切成 `triggerTitleGeneration`（异步用 titleProvider 小模型生成标题，`Agents[title].MaxTokens=80`）。
3. `for {}` 循环：
   - 每次迭代前检查 `ctx.Done()`（支持取消）。
   - **自动压缩判断** `EstimateContextWindowUsage`：`usage = (PromptTokens+CompletionTokens)/ContextWindow`，若 `>=90%` 或 `current+maxTokens > contextWindow` 则触发 `CompactSession`（同步，最多 30s 超时），压缩后**重新 prepare 消息历史再继续**。
   - `streamAndHandleEvents(ctx, sessionID, messages)`：流式拿到 assistant 消息 + 工具结果。
   - 判断 `agentMessage.FinishReason() == FinishReasonToolUse` 且有 `toolResults` → `messages = append(messages, agentMessage, *toolResults)`，`continue` 进入下一轮（**工具调用后带着结果继续回合**）。
   - 否则 return。

### 流式输出 `streamAndHandleEvents`
- 先创建一条空的 assistant `Message`（入库），随后 `eventChan := provider.StreamResponse(ctx, msgHistory, tools)`。
- 把 `sessionID`、`messageID` 通过 `context.WithValue` 塞进 ctx，供工具读取。
- 按事件类型逐条累加并**每次都调用 `messages.Update()` 写入 DB + pubsub 广播**（这样 TUI 能实时刷新）：
  - `EventThinkingDelta` → `AppendReasoningContent`
  - `EventContentDelta` → `AppendContent`
  - `EventToolUseStart` → `AddToolCall`
  - `EventToolUseStop` → `FinishToolCall`
  - `EventComplete` → 设置 toolCalls/finishReason + `TrackUsage`
  - `EventError` → 上报
- 流结束后若 `FinishReason == ToolUse` 且有 toolCalls：`executeToolCalls` 逐个 `tool.Run(ctx, ToolCall{ID,Name,Input})`，构造 `ToolResult` 消息返回。

### 工具执行 `executeToolCalls`
- 按 `ctx.Done()` 检查（取消则后续工具全部标为 canceled）。
- 工具不存在 → 错误 ToolResult。
- **权限拒绝特判**：`errors.Is(toolErr, permission.ErrorPermissionDenied)` → 该工具返回 "Permission denied"，并取消剩余所有工具调用并整体返回（不再继续回合）。

### 成本/用量
- `TrackUsage`：`cost = cached_in/1e6*缓存输入 + cached_out/1e6*缓存输出 + in/1e6*输入 + out/1e6*输出`，累加到 session。

### provider 层（`internal/llm/provider/`）
- 每个 provider 一个文件，抽象 `Provider.StreamResponse` / `SendMessages`，返回 `ProviderEvent`（思考增量/内容增量/工具开始/工具结束/完成/错误）。
- OpenAI/Anthropic 特有参数：OpenAI 传 `reasoning_effort`；Anthropic 用 `WithAnthropicShouldThinkFn` 自定义 think 控制。

---

## 4. 权限/审批系统（`internal/permission/permission.go`）

**核心：一个内存中的 `permissionService` 单例 + 异步 channel 应答。**

### 关键 API
- `Request(ctx, CreatePermissionRequest) bool`：**阻塞**直到用户决定，返回是否授权。
- `Grant/Deny`：对指定 request 发送 `true/false` 到其对应 channel，回填等待的 `Request`。
- `GrantPersistant`：**"记住本会话"** —— 把该 permission 追加到 `sessionPermissions[sessionID]`，同时应答 `true`。
- `AutoApproveSession` / `IsAutoApproved`：整会话一键信任。

### 判定顺序（`Request` 内）
1. 若 `autoApproveSessions[sessionID]` → 直接放行。
2. **会话级持久授权命中**：遍历 `sessionPermissions[sessionID]`，条件是 **`ToolName` + `Action` 相等** 且 **请求路径 == 已存路径 或以 `路径+分隔符` 为前缀**（即**目录前缀/其后代自动匹配**）。命中 → 放行。
3. 否则创建 `PermissionRequest{ID: uuid, ...}`，把应答 channel 存进 `pendingRequests sync.Map`，`broker.Publish(EventPermissionRequested, req)`（TUI 收到后弹权限对话框），然后 **`select` 阻塞等 `respCh <- bool` 或用 `ctx.Done()` 超时返回 false**。

### 事件（pubsub）
`permission_requested` / `permission_granted` / `permission_denied` / `permission_persisted`。

### 工具侧如何触发（以 `bash` 为例，`internal/llm/tools/bash.go`）
- **banned 命令列表**（`alias/curl/wget/nc/telnet/lynx/...`）+ **安全只读命令白名单**（`ls/echo/pwd/git status/git log/...`）。
- 若命令不在安全只读名单里 → `permissions.Request(..., Action:"execute", Params:BashPermissionsParams{Command})` → 返回 `false` 则工具返回 `permission.ErrorPermissionDenied`。
- 也就是说：**低危只读命令免审批，其余默认交人审批**。读/写文件工具（`file/write/edit/patch`）同理各自走 `Request`，dialog 按工具类型渲染 diff。

> 注意：v0.0.52 的权限是基于"会话 + 路径前缀"的**内存级记住**，**没有持久化到磁盘/opencode.json 的分档（read/file/edit/bash）阈值配置**（那是一部分其他工具/新版的设计）。本版对应能落地的抽象是：`allow | allow for session | deny` 三档 + AutoApprove 整会话。

---

## 5. opencode.json 配置 schema（`internal/config/config.go`）

实际文件名是 **`.opencode.json`**（viper 的 `SetConfigName(".opencode")` + `SetConfigType("json")`），是 JSON 不是 YAML。加载顺序：先读全局（`$HOME` → `$XDG_CONFIG_HOME/opencode` → `$HOME/.config/opencode`），再 `viper.MergeConfigMap` **用工作目录下的 `.opencode.json` 覆盖**；同时 `OPENCODE_*` 环境变量优先级最高。

完整结构（带 json tag）：
```go
type Config struct {
  Data         Data    `json:"data"`                      // { directory }，默认 ".opencode"，即数据/DB 目录
  WorkingDir   string  `json:"wd,omitempty"`
  MCPServers   map[string]MCPServer `json:"mcpServers,omitempty"` // {command,env,args,type:stdio|sse,url,headers}
  Providers    map[ModelProvider]Provider `json:"providers,omitempty"` // { apiKey, disabled }
  LSP          map[string]LSPConfig `json:"lsp,omitempty"` // { enabled, command, args, options }
  Agents       map[AgentName]Agent  `json:"agents,omitempty"` // { model, maxTokens, reasoningEffort }
  Debug        bool     `json:"debug,omitempty"`
  DebugLSP     bool     `json:"debugLSP,omitempty"`
  ContextPaths []string `json:"contextPaths,omitempty"`     // 默认抓取 CLAUDE.md/CONTEXT.md/opencode.md/.cursorrules 等作为上下文
  TUI          TUIConfig `json:"tui"`                       // { theme, customTheme }
  Shell        ShellConfig `json:"shell,omitempty"`         // { path, args }
}

// Agent 有三个预定义名字
AgentPrimary = "primary"; AgentTask = "task"; AgentTitle = "title"
```

要点：
- `Providers` 内建多个 provider（anthropic/openai/gemini/groq/openrouter/xai/azure/bedrock/vertexai），API key 可从 env `*_API_KEY` 自动注入。
- `Agents`：`primary`（主对话）、`task`（子任务，用于 Bash 内的子 agent/harness）、`title`（自动起标题，maxTokens 强制 80）。
- `validateAgent`：模型不合法/无对应 key 的 provider 时**自动回退默认模型**；`maxTokens>ContextWindow/2` 时砍半；OpenAI 支持 reasoning 时补 `reasoningEffort: medium`。
- 提供 `config.UpdateAgentModel`、`config.UpdateTheme` 等运行期改写配置文件的函数（TUI 里换模型 `ctrl+o` 就写回 `.opencode.json`）。

---

## 6. 值得 Node/JS 移植借鉴的点

以下设计**可以直接映射到 JS**（尤其用 Ink / React 或手写 ANSI 渲染时）：

| OpenCode 设计 | JS 移植建议 |
|---|---|
| **pubsub 泛型 Broker**（`internal/pubsub/broker.go`） | 复制成本极低：一个 `EventEmitter`/微型 event bus，定义 `log/session/message/permission/status` 五类事件。这是把"服务业务"与"UI 渲染"解耦的根基。 |
| **服务注册表 + `Subscribe` 桥接到 TUI**（`cmd/root.go setupSubscriptions`） | JS：让每个 service 都是 `EventEmitter`，TUI 用 `program.send(event)`（Ink 的 `ink.useInput`/immutable state）去订阅。后端不依赖 Ink 类型。 |
| **session + message 双层实体**（Session 持 Summary/token/成本，Message 持 `Parts []ContentPart` 多态分段） | JS：用一致的 `ContentPart{t: 'text'|'reasoning'|'toolCall'|'toolResult'|'finish'}` 结构，天然方便渲染与序列化。 |
| **Agent 循环 `processGeneration`** | JS 的 async generator 即可实现：`for await (event of provider.stream())` 累加 message，`continue` 处理工具回合；配合手动/自动 compact。 |
| **provider 抽象成事件流** | JS：每个 provider 返回 `AsyncIterable<ProviderEvent>`，统一 `EventThinkingDelta/ContentDelta/ToolUseStart/Stop/Complete/Error`，天然对接 streaming/SSE。 |
| **权限三档 + 路径前缀会话记住** | JS：`allow | allowForSession(sessionId) | deny`；记住表是一个 `Map<sessionId, PermissionRequest[]>`，命中规则用路径前缀。可近乎逐行照搬，无需依赖类型。 |
| **工具参数类型断言触发不同审批展示** | JS：工具返回 `{ needsPermission, params }`，UI 按 `toolName` 渲染（bash 命令高亮 / edit 渲染 diff）。 |
| **SplitPane 多面板布局 + PlaceOverlay 弹层** | Ink：可用 flexbox 近似 left/bottom 面板；`PlaceOverlay` 就是"居中绝对定位浮层"。 |
| **命令补全 dialog（隐藏输入 textarea + SimpleList + 回填 Replace）** | Ink：`/` 打开补全 → 一个受控输入 + 列表，选择后回填 `value.replace(searchString, completionValue, 1)`。逻辑与 UI 完全解耦，可照搬。 |
| **文件补全多级降级（rg+fzf → fzf+doublestar → fuzzy）** | JS：Node 可直接用 `fast-glob`/`fdir` 列出文件做 fuzzy，或用 `fzf` 子进程；保留"探测工具存在→降级"的分支。 |
| **状态栏队列 + TTL（critical 插队）** | JS：`Map`/数组 + `setTimeout`，信息轮播、critical 置顶。 |
| **外部编辑器集成（`tea.ExecProcess` 打开 $EDITOR）** | JS：Ink 里 `spawnSync` 或 `ink` 提供的方法打开临时文件 + `$EDITOR`，读回后回填。 |
| **模型目录（`models.SupportedModels` 带 contextWindow/cost/CanReason）** | JS：一份静态 JSON 目录即可，驱动 context-window 百分比与成本计算、reasoning 开关。 |
| **自动压缩阈值**（`>=90%` 或 `current+maxTokens>contextWindow`） | 逐行照搬，配合 deepseek 的长上下文参数。 |

### 移植的几条具体建议（针对 DeepSeek Harness / dsh-tui）
1. **先把 pubsub + session/message 结构定下来**，UI 只消费事件——这是 opencode 最值得学的一点，能让 TUI 与后台彻底解耦。
2. **provider 统一成 `AsyncIterable<ProviderEvent>`**，DeepSeek 走 OpenAI 兼容端点，Anthropic/其他可后续插。
3. **复制权限三档模型**，缺失才问，路径前缀记住本会话；比逐条问体验好得多。
4. **照搬 agent 主循环的"工具回合 append 后 continue"结构** + compact。

---

## 参考链接
- 仓库当前（TS 重写版）：https://github.com/anomalyco/opencode
- 旧 Go 版 tag 浏览：https://github.com/anomalyco/opencode/blob/v0.0.52/internal/llm/agent/agent.go 等（把路径换成任意 `internal/...` 文件）
- Go 包索引：https://pkg.go.dev/github.com/sst/opencode
- DeepWiki 分析（新旧混合，需甄别）：
  - [Architecture Overview](https://deepwiki.com/sst/opencode/1.2-architecture-overview)
  - [Permission System](https://deepwiki.com/sst/opencode/5.2-permission-system)
  - [TUI State Management](https://deepwiki.com/sst/opencode/6.3-tui-state-management)
  - [Core V2 Architecture](https://deepwiki.com/sst/opencode/4.7-core-v2-architecture)

---

## ⚠️ 诚实说明（查不到的/存疑点）
- 本笔记**全部基于 Go 版 v0.0.52 真实源码**；TS 新版我虽 clone 见到了结构，但**未深入读其 package/core 内部逻辑**，因此凡谈"新版 schema/权限分档"的地方均未断言，只提了存在差异。
- config 部分：旧版里没有独立的 `permissions` 配置段；若你的目标是"权限分档可配置"，旧版不支持，需要自己设计或参考 TS 新版（`packages/opencode` 可能有，未验证）。
- TUI 未逐行读 `messages.go`（消息流渲染细节），但主要布局/交互已覆盖。
