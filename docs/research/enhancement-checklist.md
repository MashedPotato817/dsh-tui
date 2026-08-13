# dsh-tui 增强清单：四套 CLI Agent 精华整合（可执行）

> 来源：Claude Code 逆向、OpenCode(Go v0.0.52 + TS 重写)、Codex CLI(Rust main)、
> 现成开源生态 五份调研的交叉整合。每条标「可抄 / 参考 / 概念」。
> 目的：不依赖 A/B/C 路径决策，给 dsh-tui 一条明确的借鉴清单。

## 一、审批 / 权限（三套最强共识）

| 借鉴项 | 来源 | 落点 |
|---|---|---|
| **审批四态（一次性/本会话/记住/拒绝并继续+拒绝并中止）** | Codex `ReviewDecision` 8 分支 | dsh-tui 现在只有「放行/拒绝」，应加「本会话记住」「拒绝并继续」 |
| **沙箱三档 `read-only / workspace-write / FullAccess`** | Codex `SandboxPolicy` | 与我们的权限档位(manual/edits/bypass)对齐概念 |
| **deny > ask > allow 免疫优先级 + fail-closed** | Claude Code | 已落地(permission.js)，保持 |
| **静态解析不了默认弹窗** | Claude Code | 已落地心智 |
| **路径校验分多步、失败即弹窗 + TOCTOU 提示** | Claude Code | dsh-tui 待补（若要展示工具路径） |
| **plan 模式三档批准（转 auto / 手动批准 / 继续规划）** | Claude Code | dsh-tui 现在 plan 只 decline；可加「批准后自动切档」 |

## 二、命令 / 补全 / 输入（跨三套共识）

| 借鉴项 | 来源 | 落点 |
|---|---|---|
| **`/ @ ! :` 四前缀区分补全域** | Claude Code / OpenCode(TS) | dsh-tui 有 `/`；`@`(文件)受 DSH host.listDirectory 限制，`!`(shell) 待评估 |
| **`#` 行范围引用 `@file.ts#10-20`** | OpenCode(TS) | 有价值，但依赖文件访问能力 |
| **leader key 系统（ctrl+x）** | OpenCode(TS) | 让系统级快捷键不与 vim 编辑冲突 |
| **自定义命令 = Markdown 文件 + frontmatter(allowed-tools/argument-hint)** | Claude Code | ✅ 已落地(command-loader.js) |
| **命令面板即通用发现入口(hub)** | Claude Code | 已落地(slash 面板)，可扩展 |
| **AutoApproveSession / 记住选择** | OpenCode(Go) | 与审批四态呼应 |

## 三、架构 / 状态管理（决定 dsh-tui 演进方向）

| 借鉴项 | 来源 | 落点 |
|---|---|---|
| **事件枚举 1:1 = 源可复用单元 + reducer 接缝** | Codex / OpenCode(TS) | ✅ dsh-tui 的 foldEvents 已是此模式，方向受验证 |
| **双消息流解耦（事件流 + 命令流）** | Codex `EventMsg`/`Op` | dsh-tui 已有 mux 事件流；命令流(interrupt/approval)可强化 |
| **显式 Mode 状态机 + keybinding 表(context×action)** | Codex `AppState` / Claude Code | dsh-tui 有 vim 模态；可加全局 mode 状态机 |
| **`<Static>` 提交已完成 turn** | Codex/Claude Code(Ink) | ✅ 已落地 |
| **worker 隔离 UI 与 agent** | OpenCode(TS) | dsh-tui 单进程，复杂度够再上 |
| **rollout/JSONL 会话持久化 + 可 replay** | Codex | dsh-tui 有 registry；可加 trace |

## 四、配置（复用接 DSH / 未来 VSCode）

| 借鉴项 | 来源 | 落点 |
|---|---|---|
| **`[model_providers]` 分层 schema（可接 DeepSeek/OpenAI/本地）** | Codex `ConfigToml` | 未来 dsh-tui 若要独立模型路由可复用；DSH 由 host 管，暂不需要 |
| **`.opencode.json` schema** | OpenCode(Go) | 参考价值：provider/agent/权限 |
| **status line 数据即 JSON、展示即脚本** | Claude Code | 高级可扩展，非首期 |

## 五、本轮已落地（回顾）

- 权限档位 + HUD 徽标 + Shift+Tab 切换 + plan-review 档位判定（permission.js）
- Ctrl+C 双按退出 / Esc 中断 / `:cancel`
- slash 面板 Tab/方向键导航
- 自定义命令（.claude/commands/*.md，frontmatter）
- `<Static>` 流式优化
- 注入上下文折叠
- core 全量导出（40 API，VSCode 复用入口）

## 六、下一步优先级（供择路后执行）

1. **审批四态**（本会话记住/拒绝并继续）——最高价值，三类 CLI 共识
2. **leader key 系统**——避免快捷键冲突，工程化 shortcut 表
3. **显式全局 mode 状态机**——撑起多对话框/审批/命令面板
4. **`@`/`!` 前缀**——受 DSH host 能力限制，评估后定
5. **tool 卡片渲染 + diff 预览**——对齐官方版，工作量较大
