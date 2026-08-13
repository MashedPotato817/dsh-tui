# Claude Code（终端 Agent CLI）交互设计逆向笔记

> 目的：为「一个类似 Claude Code 的 TUI 客户端」提供可借鉴清单。
> 资料基于官方文档（[code.claude.com/docs](https://code.claude.com/docs)）与社区逆向工程仓库。
> 约定标注：
> - ✅ **值得借鉴**：可安全抄进自有 TUI 的模式/交互细节（属于「怎么做成好用」的部分）。
> - 🔒 **闭源不可直接抄**：涉及 Anthropic 私有逻辑 / 服务端能力 / 商标 / 商业策略的部分，只能借概念，须换用自有实现。

---

## 0. 总览：Claude Code 技术栈（逆向结论）

社区通过对 npm 包 source-map 逆向得出（[jung-wan-kim/claude-code-reverse-engineering](https://github.com/jung-wan-kim/claude-code-reverse-engineering)）：

- 规模：约 1,900 文件 / 512,000+ LOC，TypeScript Strict，用 **Bun** 打包。
- 渲染栈：**React 19 + 自研 Ink fork**（自定义 react-reconciler）+ **Yoga(WASM) flexbox 布局**。
- TUI 层 = React 组件树 → 自定义 reconciler → Yoga 计算布局 → ANSI diff 输出（双缓冲，帧节流 ~16ms）。
- 核心引擎：45+ 工具、QueryEngine、流式执行器、成本追踪器。
- 扩展层：MCP、插件、Skills、Hooks、LSP。
- 权限层：7 种权限模式、23 项 Bash 安全检查、路径校验、auto-mode 分类器。

这一架构是理解「为什么交互如此流畅」的底层：它把浏览器那套「组件化 + 布局 + diff 渲染」搬到终端。

---

## 1. 权限 / 审批模型（Permission Model）

### 1.1 分级档位（重点：这是你要抄的核心理念之一）

逆向源码（`PermissionMode.ts`）给出精确枚举。外部可见有 **5 挡**，官方文档现在描述 7 种（多了 internal 的 `auto` 与 `bubble`）：

| 模式 | 终端标识 | 颜色 | 无需询问即可执行 | 说明 |
|---|---|---|---|---|
| **default（Manual）** | 灰色 `⏸ manual mode on` | text | 仅读取 | 每个写操作都弹出审批；启动时默认 |
| **plan** | `⏸ plan mode on` | planMode | 读 + classifier 批准的命令（若 auto 可用）| 只探索不改代码，产出 plan 供批准 |
| **acceptEdits** | `⏵⏵ accept edits on` | autoAccept | 读 + 文件编辑 + 常见文件系统命令 | 边写边让你事后 diff 审查 |
| **auto** | `⏵⏵ auto mode on` | warning | 几乎一切，后台分类器把关 | 需要账号/模型资格，服务端能力 |
| **dontAsk** | `⏵⏵ don't ask on` | error | 仅预批准的属具 | 锁定式 CI/脚本 |
| **bypassPermissions** | `⏵⏵ bypass permissions on` | error | 一切（除硬安全项）| 仅限隔离容器/VM |

内部还有 `bubble` 模式（fork agent 把审批决策冒泡给父 agent）——这是一个**值得借鉴**的多 agent 权限代理机制。

> ✅ **借鉴**：模式**枚举化 + 每个模式有明确的状态徽标 + 专属配色**。用户随时知道当前处于哪个安全档。
> ✅ **借鉴**：**模式决定「哪些工具自动放行」，而不是逐条手点**。把「读/写/执行/网络」映射到档位，是最自然的交互模型。

### 1.2 切换方式（快捷键 / 命令 / 启动参数）

- **会话中**：`Shift+Tab` 循环 `default → acceptEdits → plan`（加上已启用的可选档，顺序为 plan → bypassPermissions → auto）。
  - `auto`：账号达标时出现；切到此模式下个模式时**无需再确认**。
  - `bypassPermissions`：须先以 `--permission-mode bypassPermissions` / `--dangerously-skip-permissions` / settings 开启；`--allow-dangerously-skip-permissions` 只加入循环不默认启用。`dontAsk` 不加入循环（用 flag 设置）。
  - Windows 上 Node/Bun runtime 未启用 VT input 模式时，用 `Alt+M` 代替。
- **命令**：`/permissions` 查看/改权限；`/plan` 前缀单条 prompt 进入 plan。
- **启动**：`claude --permission-mode plan`；持久默认：settings.json `"permissions": { "defaultMode": "acceptEdits" }`。
- `default` 在 CLI 里标签叫 **Manual**，但 config 值仍是 `default`（hooks/SDK 用），CLI 也接受 `--permission-mode manual` 作别名。

> ✅ **借鉴**：**单一快捷键循环 + 命令 + flag + 配置文件**四个入口都落到同一个 enum。命令分类据此一致性。
> ⚠️ 注意：模式切换**不能通过「在聊天里打字让 agent 授权」**，只能通过上面这些明确控件——防止 prompt injection 自抬权限。这一点很值得抄。（官方明确写道 "The mode is set through these controls, not by asking Claude in chat."）

### 1.3 一个命令/文件如何被归类到不同档（核心可抄逻辑）

逆向给出 12 步「权限决策流水线」`hasPermissionsToUseToolInner()`（[03-permission-security.md](https://github.com/jung-wan-kim/claude-code-reverse-engineering/blob/main/docs/03-permission-security.md)）。任何工具调用都会经过它：

```
1a  整工具 deny 规则        → deny（立即）
1b  整工具 ask 规则         → ask（Bash+沙箱豁免除外）
1c  各工具自带 checkPermissions()  → allow/deny/ask/passthrough
      · BashTool: 子命令分析 + 路径校验 + sed 检查
      · FileEditTool: 路径安全 + 工作目录校验
1d  工具实现返回 deny        → deny（如 bash 危险子命令）
1e  requiresUserInteraction → 强制弹窗（即使 bypass）
1f  内容级 ask 规则          → 强制弹窗（bypass 也免疫），如 Bash(npm publish:*)
1g  安全项（safetyCheck）    → 强制弹窗（bypass 也免疫）
      · .git/、.claude/、.vscode/、.bashrc 等危险路径
2a  模式级绕过：bypassPermissions（或 plan+bypass可用）→ allow
2b  整工具 allow 规则        → allow
3   passthrough → 转成 ask
4   后处理：
      · ask + dontAsk → deny
      · ask + auto    → 分类器子流水线（见 1.5）
      · 否则弹用户审批
```

**如何判定一个 Bash 命令属于「读」还是「写」——23 项安全检查**（`bashSecurity.ts`，2592 行）。逆向列出了 23 个 check ID，例如：
- `INCOMPLETE_COMMANDS`、`SHELL_METACHARACTERS`（`;`/`|`/`&`）、`NEWLINES`（引号外换行）、`IFS_INJECTION`、`BRACE_EXPANSION`（`{a,b}`）、`OBFUSCATED_FLAGS`、`GIT_COMMIT_SUBSTITUTION`、`UNICODE_WHITESPACE`、`PROC_ENVIRON_ACCESS`、`MID_WORD_HASH`（解析分歧）、`ZSH_DANGEROUS_COMMANDS`、`BACKSLASH_ESCAPED_OPERATORS` 等。

验证器按顺序执行，前面提前 return（空命令→allow、不完整→ask、安全 heredoc→allow、简单 git commit→allow）。

**acceptEdits 档的自动放行范围**（官方文档）：
- 文件读写（工作目录内）。
- 常见文件系统 Bash：`mkdir, touch, rm, rmdir, mv, cp, sed`。
- 也可带 `LANG=C`、`NO_COLOR=1` 等安全前缀环境变量，或 `timeout, nice, nohup` 等包装器。
- 作用域**仅限工作目录或 additionalDirectories**；范围外路径、受保护路径、其它命令，仍要弹窗。
- PowerShell 工具启用时自动放行 `Set-Content/Add-Content/Clear-Content/Remove-Item` 及其别名——但参数含引号字符（如撇号）时因「无法静态校验引用与未引用读取是否一致」仍会弹窗；官方建议改用命名参数 `-Value`。
- 反向思路很妙：**「静态解析不了的地方就默认弹窗」**（fail-closed 原则）。

> ✅ **借鉴**：**以「工具分类 + 静态命令分析」决定放行，而不是白名单整条字符串**。对每条 Bash 做「子命令 + 路径 + 重定向 + 元字符」的结构化拆解，再映射到档位。
> ✅ **借鉴**：**3 个免疫优先级的硬规则**：`deny 规则 > ask 规则 > allow 规则`，且「安全项 / 内容级 ask 规则」在 bypass 模式也免疫。这是安全底线，不要砍。
> ✅ **借鉴**：**路径校验分多步、失败即弹窗**：normalize → symlink 解析 → 越界检查 → Windows 模式 → 作用域。并明确 TOCTOU 警告：路径校验与文件访问并非原子，存在竞态窗口——实现时提示风险。

### 1.4 plan 模式的审批细节

- 进入 plan 后 agent **只读**，把研究结果写成 plan 并询问下一步。批准弹窗有 3 个选项：
  1. `Yes, and use auto mode`（批准并转入 auto；auto 不可用时显示 `Yes, auto-accept edits`；bypass 开启时显示 `Yes, and bypass permissions`）
  2. `Yes, manually approve edits`（批准但逐条审）
  3. `No, keep planning`（留下继续改 plan）
- `Ctrl+G` 在默认编辑器打开 plan 直接编辑后再继续；`showClearContextOnPlanAccept` 开启时第一个选项是「批准 plan 并清空上下文字段」。
- 批准后**自动退出 plan 模式**并切到对应档位开始编辑。要再规划就 `Shift+Tab` 或 `/plan`。
- 批准 plan 还会**自动按 plan 内容给会话命名**（除非已 `--name`/`/rename`）。

> ✅ **借鉴**：plan 模式 + 三档批准 + **「批准后自动切到编辑模式」的无缝衔接**。这是 Agent 工具「想清楚再动手」的最佳节奏设计。

### 1.5 auto 模式的分类器流水线（逆向细节）

```
ask 结果（auto 模式下）
 → 安全项判定 classifierApprovable → false 则弹/deny
 → PowerShell 门（POWERSHELL_AUTO_MODE 未启用时 PS 不能绕过）
 → acceptEdits 快速路径：能在 acceptEdits 放行的直接 allow（省一次分类器 API）
 → 安全工具允许表 isAutoModeAllowlistedTool（只读类直接 allow）
 → YOLO 分类器两阶段判定 shouldBlock
      allowed → allow / blocked → deny+追踪 / unavailable → fail-closed(iron_gate) 或 fallback 弹窗
 → 连续 3 次或累计 20 次 deny → 退回人工弹窗；headless → AbortError
```

> 🔒 分类器本身是**服务端/私有模型能力**，不能直接抄；但**「优先走便宜的快速路径、必要时才调用昂贵分类器」「deny 次数阈值后降级人工」**的退避策略✅值得借鉴。

---

## 2. 斜杠命令系统（Slash Commands）

### 2.1 内置命令清单（官方 + 社区整理）

| 命令 | 作用 |
|---|---|
| `/help` | 帮助 |
| `/clear` | 清空对话历史（新开一段）|
| `/compact [instructions]` | 压缩上下文，可用一段指令聚焦 |
| `/config` | 打开设置界面（Config 页）|
| `/permissions` | 查看/修改权限（含当前模式）|
| `/model` | 选择/切换模型 |
| `/init` | 初始化项目生成 CLAUDE.md |
| `/doctor` | 检查安装/settings 健康 |
| `/cost` | 显示 token 用量统计 |
| `/context` | 查看上下文窗口占用（context 详情）|
| `/status` | 打开设置（Status 页：版本、模型、账号、连接）|
| `/usage` | 订阅计划的用量/速率限制 |
| `/add-dir` | 加附加工作目录 |
| `/agents` | 管理自定义子 agent |
| `/mcp` | 管理 MCP server 与 OAuth |
| `/memory` | 编辑 CLAUDE.md 记忆文件 |
| `/rewind` | 回退对话/代码到此前某点 |
| `/sandbox` | 开启沙箱 Bash（文件/网络隔离）|
| `/review` | 请求代码评审 |
| `/bug` | 报告 bug（把会话发给 Anthropic）|
| `/login` / `/logout` | 切换账号 / 登出 |
| `/pr_comments` | 查看 PR 评论 |
| `/vim` | 进入 vim 模式 |
| `/terminal-setup` | 安装 Shift+Enter 换行键绑定 |
| `/tui` | 查看当前渲染器（classic/fullscreen）|
| `/statusline` | 让 Claude 生成 status line 脚本 |
| `/import [codex|gemini]` | 从其它 agent 导入配置 |

### 2.2 命令的发现 / 补全交互（重点抄）

官方 interactive-mode 文档：
- 输入 `/` → 弹出命令面板，列出**所有可调用项**：内置命令 + 内置/用户 skills + 插件与 MCP server 贡献的命令。
- 输入 `/` 后跟任意字母 → **过滤**。未完全展示的命令取决于平台/套餐。
- fullscreen 渲染下，`/` 命令列表与 `@` 文件建议列表**支持鼠标**：悬停高亮、点击选中。
- `?` 在空输入上 → 切换快捷键帮助面板。

社区 repo 补充的自定义命令机制（[claude-code-marketplace/docs/slash-commands.md](https://github.com/hyperskill/claude-code-marketplace/blob/main/docs/slash-commands.md)）：
- 自定义命令 = 一个 Markdown 文件。**项目级**放在 `.claude/commands/`，**个人级**放在 `~/.claude/commands/`。
- **命名空间**：子目录只用于归类/显示，不改命令名。文件 `.claude/commands/frontend/component.md` → 命令 `/component`，描述显示 `(project:frontend)`。
- **frontmatter 元数据**：`description`、`allowed-tools`、`argument-hint`（补全时展示期望参数）、`model`、`disable-model-invocation`。
- **参数占位**：`$ARGUMENTS` 全量捕获；`$1/$2/$3` 位置参数；`!` 前缀在命令执行前跑 bash 并把输出并入上下文；`@` 前缀引用文件。
- `/help` 里分别标注 `(project)` / `(user)` 来源。

> ✅ **借鉴**：**命令面板即通用发现入口（hub）**——把内置命令、skill、插件、MCP 贡献者全部在 `/` 里平铺 + 前缀过滤，是极好的「可发现性」设计。
> ✅ **借鉴**：**tab/方向键选择 + 前缀过滤 + argument-hint 提示期望参数**——补全要让用户看到「这条命令要什么参数」。
> ✅ **借鉴**：**命令即 Markdown 文件**，天然可版本化、可分享、可命名空间。比你硬编码命令列表灵活得多。
> ✅ **借鉴**：自定义命令 frontmatter 里直接声明 `allowed-tools`（授权范围随命令走）。

### 2.3 斜杠 / 文本编辑相关的键位（补全交互延伸）

由交互模式文档整理（见 §3 表格），`/`、`@`、`!`、`:` 四个前缀触发不同语义：
- `/` 命令或 skill；`!` shell 模式（直接跑命令并让 agent 回应）；`@` 文件路径补全；`:` emoji 短码补全。

> ✅ **借鉴**：**用 `At`-sign / `!` / `.` 等前缀区分「补全域」**（命令 / 文件路径 / shell / emoji），输入框同一套，上下文切换补全源。

---

## 3. 快捷键（常用键映射）

官方 [interactive-mode](https://code.claude.com/docs/en/interactive-mode) 文档整理的**完整参考**。注意「HTML 规范要求：部分快捷键因终端/平台而异」，macOS 需把 Option 设成 Meta。

### 3.1 通用控制

| 快捷键 | 作用 | 反直觉点 |
|---|---|---|
| `Esc` | 中断当前响应 / 关闭对话框 | 有权限对话框开着时 Esc 是「关对话框」非「中断」 |
| `Esc Esc` | 输入有文字：清草稿（入历史）；输入为空：打开 rewind 菜单 | 双 Esc 语义随输入状态切换 |
| `Ctrl+C` | 中断运行中的操作；若空闲，第一下清输入、第二下退出 | 经典「安全退出」双保险 |
| `Ctrl+D` | 退出会话（第一下提示，800ms 内再按退出）；输入有文字时是「删光标后字符」 | 上下文相关 |
| `Ctrl+N` | （历史/多行导航）下一条 —— 会话历史导航 | — |
| `Ctrl+B` | 后台任务（后台化 Bash/agents）；tmux 用户按两次 | 用于并发 |
| `Ctrl+G` / `Ctrl+X Ctrl+E` | 在默认编辑器打开 prompt/plan 编辑 | readline 原生绑定 |
| `Ctrl+L` | 重绘屏幕（红屏恢复）；两秒内连按两次则 `/clear` 开新会话 | 双语义 |
| `Ctrl+O` | 切换 transcript 查看器（展开工具调用/MCP 细节）| 调试利器 |
| `Ctrl+R` | 反向搜索命令历史 | readline 经典 |
| `Ctrl+T` | 开关 Claude 的 to-do checklist（在状态区显示）| 不是后台任务视图 |
| `Ctrl+S` | 暂存/恢复 prompt 草稿 | 有用的草稿保护 |
| `Ctrl+Z` | 挂起进程（Unix，`fg` 恢复）| — |
| `Shift+Tab` / `Alt+M` | 循环切换权限模式（见 §1）| — |
| `Option+P` / `Alt+P` | 不丢输入地切换模型 | 保留输入极重要 |
| `Option+T` | 开关 extended thinking | — |
| `Option+O` | 开关 fast mode | — |
| `Up/Down` 或 `Ctrl+P/Ctrl+N` | 多行时先移动光标到行首/尾，到边界后再翻历史 | 「光标优先 vs 历史」的状态机 |

### 3.2 文本编辑（readline 风格）

| 快捷键 | 作用 |
|---|---|
| `Ctrl+A` / `Ctrl+E` | 行首 / 行尾 |
| `Ctrl+K` / `Ctrl+U` | 删到行尾 / 删到行首（存到删除剪贴板）|
| `Ctrl+W` | 删前一个词 |
| `Ctrl+Y` | 粘贴删除文本；`Alt+Y` 循环粘贴历史 |
| `Alt+B` / `Alt+F` | 词后 / 词前跳一单词 |
| `Ctrl+_` / `Ctrl+Shift+-` | 撤销上次输入编辑 |
| `Ctrl+X Ctrl+K` | 停掉所有后台子 agent（3 秒内按两次确认）|

### 3.3 多行输入

- `\` + `Enter`（通用）；`Option/Alt+Enter`；`Shift+Enter`（原生 iTerm2/WezTerm/Ghostty/Kitty/Warp/Windows Terminal）；`Ctrl+J`（任何终端）。

> ✅ **借鉴**：**「双语义键」设计**（Esc/Esc、Ctrl+L、Ctrl+D、Up/Down）让少量按键承载多态行为，但必须像它一样**在 UI 里有明确提示/状态区分**，避免用户困惑。
> ✅ **借鉴**：**Ctrl+C 中断、Esc 关闭对话框、权限对话框全屏快捷键**这套「安全 + 打断」心智模型深入人心，强烈建议照搬键位，降低学习成本。

---

## 4. HUD / 状态显示

### 4.1 底部状态区构成

Claude Code 底部是「footer 徽章（内置）+ 可定制 status line（新增一行，置于徽章上方）」两层：

- **内置 footer 徽章**：模式徽标（见 §1 表格：`⏸ plan mode on` / `⏵⏵ accept edits on` 等）、`esc to interrupt`、`? for shortcuts fallback`、`hold space to voice` 等键盘提示。
- **自定义 status line**：`/statusline + 自然语言描述`让 Claude 生成脚本；或手动在 settings.json 配 `"statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }`。脚本从 stdin 读 JSON session 数据，把 stdout 显示成一行/多行。

### 4.2 status line 可用数据（官方字段）

- 模型：`model.id`、`model.display_name`
- 目录：`cwd` / `workspace.current_dir`、`workspace.project_dir`、`workspace.added_dirs`、git worktree/repo（host/owner/name）
- 成本：`cost.total_cost_usd`（客户端估算，`/clear` 后归零）、`cost.total_duration_ms`（总墙钟时间）、`cost.total_api_duration_ms`（等 API 的时间）、`cost.total_lines_added/removed`
- 上下文窗口：`context_window.total_input_tokens`、`total_output_tokens`、`context_window_size`、`used_percentage`、`remaining_percentage`、`current_usage`、`exceeds_200k_tokens`
- 会话态：`effort.level`、`thinking.enabled`、`fast_mode`
- 速率限制：`rate_limits.five_hour.used_percentage`、`seven_day.used_percentage` 及 `remaining`、重置时间

### 4.3 更新时机（借鉴点）

- 会话开始/恢复时运行一次；之后在：**收到新 assistant 消息、`/compact` 完成、权限模式变更、vim 模式切换、`refreshInterval` 定时器到点**时更新。
- **300ms debounce**，连续变更批处理；脚本仍在跑时新更新会取消在途运行。
- 显示某些 UI（自动补全、帮助菜单、权限弹窗）时**临时隐藏**。
- 本地运行、**不消耗 API token**；支持 ANSI 颜色、多行、OSC 8 可点击链接。

> ✅ **借鉴**：**状态栏「数据即 JSON、展示即任意脚本」**——把「显示什么」完全交给用户脚本，是极好的可扩展性设计（Claude 官方也特意说 footer 徽章不会被 status line 替代）。
> ✅ **借鉴**：显示的关键指标 = **模型 + 用时 + token/上下文占用 + 成本 + cwd**（正好对应你调研问题的 HUD 项）。用百分比条而非绝对 token 更好读。
> ✅ **借鉴**：**300ms debounce + 事件驱动 + 可选定时刷新**，避免每 token 都重跑脚本导致卡顿。
> ✅ **借鉴**：多个第三方 statusline 项目（[leeguooooo/claude-code-usage-bar](https://github.com/leeguooooo/claude-code-usage-bar)、[SiluPanda/claude-statusline](https://github.com/SiluPanda/claude-statusline)、[ilia-pluzhnikov/claude-code-statusline](https://github.com/ilia-pluzhnikov/claude-code-statusline)）都展示了同一套字段的组合——说明这套字段设计成熟可复用。

---

## 5. 逆向可借鉴的「工程实现模式」（TUI 层面）

来自 [06-ui-layer.md](https://github.com/jung-wan-kim/claude-code-reverse-engineering/blob/main/docs/06-ui-layer.md)：

### 5.1 组件化渲染栈（Ink fork）

- **Custom reconciler**：复用 React 19 的 `react-reconciler`，host config 里 `createInstance`/`commitUpdate`/`resetAfterCommit`。`commitUpdate` 不带 payload，自己 diff old/new props。内部 `DOMElement` 节点树 + Yoga 节点一对一。
- **Yoga(WASM) exbox 布局**：完整 CSS flexbox（flexDirection/flexGrow/alignItems/justifyContent/margin/padding/border/gap/overflow:scroll）。
- **输出管线**：遍历 `DOMElement` 树 → 在每节点布局坐标记录文本/样式 → 视口裁剪（跳过屏幕外节点）→ **双缓冲 2D 单元矩阵（stylePool+charPool+hyperlinkPool）→ 逐单元 diff 生成 ANSI** → BSU/ESU 同步包裹 → `stdout.write()`。
- 性能：帧节流 `FRAME_INTERVAL_MS≈16ms`（leading+trailing），`queueMicrotask` 延迟渲染到 layoutEffect 后。
- 组件数：346 个 `.tsx`；自定义 hooks 85+（`useTextInput`、`useTerminalSize`、`useStdin`）。
- **alt-screen + mouse tracking**（全屏渲染模式）。

> ✅ **借鉴**：**「React/VirtualDOM + flexbox + 双缓冲 diff 渲染」是让 Terminal UI 能承载复杂列表/对话框/状态栏的根基**。若你用 React：直接 fork 开源的 Ink 或参考其收进 diff/blit 思路。若你轻量（Rust/Go），核心可抄点是 **diff 渲染 + 局部刷新**取代全屏重绘。

### 5.2 Keybinding 系统（14 文件架构，极可抄）

- `schema.ts`（Zod）定义 `context × action`；`parser.ts` 解析键串（`ctrl+shift+k` → 修饰键+key，支持 chord `ctrl+k ctrl+s`）；`match.ts` 匹配；`resolver.ts` 解析为 action；`defaultBindings.ts`；`reservedShortcuts.ts`（不可重绑）；`loadUserBindings.ts`；`validate.ts`；`template.ts`；`KeybindingContext.tsx` + `useKeybinding.ts` hook。
- **Context 优先级**：18 种上下文（Global/Chat/Autocomplete/Confirmation/Help/Transcript/…/ModelPicker/Select/Plugin）。**最具体的上下文覆盖全局**，例：`['Autocomplete','Chat','Global']` → Autocomplete > Chat > Global。同名键由更具体上下文优先。
- **支持 Chord**（两键组合），例 `ctrl+x ctrl+k`→killAgents、`ctrl+x ctrl+e`→externalEditor。
- 修饰键别名：ctrl/control、alt/opt/option/meta、cmd/command/super/win；特殊键映射 esc→escape、return→enter、arrows。

> ✅ **借鉴**：**把快捷键当成「context×action 表 + Zod schema + 用户可重绑 json」来工程化**，而不是散落 switch-case。这是本笔记最直接可抄的架构之一。
> ✅ **借鉴**：**预留 `reservedShortcuts.ts`（不可重绑的系统级键）**，防止用户把救命键（如 Ctrl+C）改成别的。

### 5.3 权限决策的工程化（可抄部分）

- `hasPermissionsToUseToolInner()` 把「deny/ask/allow/passthrough + 模式绕过 + 免疫规则 + 后处理」串成流水线，**每个工具自行实现 `checkPermissions()`**。
- `isConcurrencySafe` 标志：安全工具并行，危险工具独占。
- 成本追踪：会话级 USD 累加器、多 provider 归一化 —— 对应 status line 的 `cost.*` 字段。

> ✅ **借鉴**：**权限不是全局一处判断，而是「每个工具实现一个 checkPermissions + 全局流水线裁决」**。可测、可加白名单、可做 deny-first。

---

## 6. 参考链接汇总

**官方文档（权威，交互行为以此为准）**
- Permission modes：https://code.claude.com/docs/en/permission-modes
- Interactive mode（快捷键表格）：https://code.claude.com/docs/en/interactive-mode
- CLI reference（命令/flags）：https://code.claude.com/docs/en/cli-reference
- Slash commands（hyperskill 整理版）：https://github.com/hyperskill/claude-code-marketplace/blob/main/docs/slash-commands.md
- Status line：https://code.claude.com/docs/en/statusline
- Permissions（规则语法）：https://code.claude.com/docs/en/permissions

**逆向分析仓库（实现级规格，非常值得读）**
- https://github.com/jung-wan-kim/claude-code-reverse-engineering （architecture / core / permission / multi-agent / UI 八篇）
- https://github.com/ComeOnOliver/claude-code-analysis
- https://github.com/catyans/claude-code-source-analysis
- https://github.com/yaniv-golan/claude-code-internals （deep-dive 10 lessons）

**第三方 statusline（看 UI 可玩性）**
- https://github.com/leeguooooo/claude-code-usage-bar
- https://github.com/SiluPanda/claude-statusline
- https://github.com/ilia-pluzhnikov/claude-code-statusline
