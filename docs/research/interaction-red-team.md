# dsh-tui 交互设计：Claude Code + OpenCode + Codex 三家之长合并红队

> 目的：不抄单一产品，而是把三家在「程序员 / 终端 GUI」上各自最强的体验
> 合成一套 dsh-tui 的交互规范。本文既是设计文档，也是后续改进的决策依据
> 与优先级清单。所有实现都必须在 dsh-tui 架构内落点：
> **core/（`lib/`）纯函数可单测**，**ui/（Ink）薄渲染**，不改 DSH host 契约。

## 0. 三家分别最强的是什么（取长补短）

| 产品 | 最值得抄的体验 | dsh-tui 对应 |
|---|---|---|
| **Claude Code** | 紧凑单行 HUD（model/成本/权限/上下文占用）、logo banner、思考时长、底部状态栏 | HUD 已有雏形（model/mode/cost/ctx%）|
| **OpenCode** | 输入上下文补全：`@` 文件引用、`#` 行范围、`/` 命令、`!` shell 模式 | 已有 `/`；缺 `@`/`#`/`!` |
| **Codex** | 命令面板多路补全、可重映射键位、审批记忆三态、Ctrl+C 双重退出、打字机增量渲染 | 已有 Ctrl+C 双按；缺打字机/记忆 |

## 1. HUD / 状态栏（合并）

目标一行，信息密度与 Claude Code 接近，但加 Codex 的时间概念：

```
● model[1M] | PTC | ⏸ manual | $0.0011 | 1.2ki/3o | ctx 4% | ⏱️<1m  session cwd
```

- `●/○` running 指示（已有）
- `model[1M]` 上下文窗标注 —— 从 `hud.contextWindow` 派生（补）
- `ctx 4%`（已有）
- `⏱️<1m` 回合耗时 —— turn/start→now（补，Codex/Claude Code 都有）
- 内置文档计数 `2 docs` —— 统计项目 CLAUDE.md/AGENTS.md（补）
- 子 agent 计数 `← 1 agent` —— 从 subagents 列表（补）

## 2. 反馈细节（Claude Code 灵感）

- **logo banner**：启动时 ASCII logo + 版本（对标 Claude Code 顶栏）。
- **思考时长 `Thought for 2s`**：turn/start → 首个 assistant 增量 / turn/end 的耗时（纯函数 fold 内算）。
- **工具迭代耗时**：tool/call 出现 → tool/result 落定 的时长（fold.js `tools[]` 补 `startedAt`，UI 显示 `(Xs)`）。
- **空回复占位**（已有）、**pending 升级**（已有）。

## 3. 输入补全（OpenCode 灵感，最大增量）

- `/` slash（已有）
- `@` 文件引用 → 补全项目文件路径（`mentionTriggerIndex`）；触发后内联候选，Tab 选择。
- `#` 行范围 → `@file.ts#10-20` 展示行范围。
- `!` shell 模式 → 空输入 `!cmd` 直接把命令交给 host 执行。
- 输入框多路补全（`/`、`@`、`!`）统一成一个候选面板。

> 依赖：文件补全需要 host 侧或本地 fs 扫描当前 cwd。本地 fs 是零依赖可行路径。

## 4. 键位 / 交互（Codex 灵感）

- **Ctrl+L 清屏**（Codex），对当前 TUI 最实用。
- **Ctrl+T 历史 transcript / Ctrl+R/S 历史搜索**（Codex）。
- **可重映射键位**（长期，config 驱动）。
- **审批记忆三态**（已有 allow-once / allowed-session；缺"记住"→ 可加，但依赖 host 权限模型）。
- **打字机增量渲染**（已有按 chunk 追加；可细化为行级 commit）。
- **Ctrl+C 语义**：运行中打断 turn（已有），空闲双按退出（已有）。

## 5. 优先级（按 价值/成本，UI 决策）

| 优先 | 项 | 来源 | 成本 |
|---|---|---|---|
| P0 | HUD 补时间/上下文窗/文档计数/子agent计数 | Claude Code | 低（core 纯函数+薄 UI）|
| P0 | turn 思考时长 | Claude Code | 低（fold 纯函数）|
| P1 | logo banner + 版本 | Claude Code | 低 |
| P1 | 工具迭代耗时 | Claude Code | 低 |
| P1 | Ctrl+L 清屏 | Codex | 低 |
| P2 | `@` 文件 / `#` 行范围 / `!` shell 输入补全 | OpenCode | 中-高 |
| P2 | 打字机行级 commit | Codex | 中 |
| P3 | 可重映射键位 | Codex | 高（长期）|
| P3 | 审批记忆三态"记住" | Codex | 中（依赖 host）|

## 6. 原则

- 每一项都尽量落在 `lib/` 纯函数 + 单测，UI 只消费派生结果。
- 不改 DSH host 契约（协议层是 host 的，dsh-tui 只消费）。
- 每完成一批 bump minor + 发布 + push。
- 本项目分支工作流：`feat/dsh-tui`，MAA commit。
