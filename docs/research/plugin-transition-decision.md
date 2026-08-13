# dsh-tui 转型决策备忘：独立 HTTP 客户端 → 官方 dsh 插件

> 依据：多轮调研（Claude Code 逆向 / OpenCode Go+TS / Codex CLI / 现成开源生态 / DSH 生态 TUI）。
> 结论：用户决定**改成官方插件式**，**保留现有业务逻辑**（fold/Vim/权限/slash/自定义命令）。

## 一、"别人做好的"全景（已核实）

### ① 现成独立终端 Agent（内嵌 LLM，非 DSH）
- **OpenCode**（anomalyco/opencode，TS 重写，MIT，170k+ star）：`opencode run` 可脚本化 + 全功能 TUI + headless server + SDK。TS 栈与 dsh-tui 最接近。
- **Codex CLI**（openai/codex，Rust 内核 + TS 前端，Apache-2.0，71k+）：`codex exec` 批处理 + TUI。
- **Aider / Goose / aichat**：Python / Rust，各有借鉴点（git 基准、MCP、脚本化）。
- **agent-mux**（a5c-ai，TS）：统一契约驱动多家 agent harness——做 host 无关客户端的现成路线图。

### ② DSH 生态里的现成 TUI（关键）
- **`@openguardrails/dsh-tui`**（v0.1.2，**已存在且完整**）：
  - 从 DSH 官方历史 `packages/ui/tui`（官方 commit `10bb9cbf4a` 确认"remove TUI package"）**恢复移植**。
  - 走**官方 dsh 插件接缝**：`dsh plugin --profile tui add @openguardrails/dsh-tui`，stdin 内，挂官方 `dsh-base`。
  - 功能极全：流式 Markdown 渲染、工具卡片(Ctrl+O 折叠)、审批/ask 对话框、plan 审查、`@file` 补全 + `@session` 卡片、slash(/model /resume /compact /details)、todo 面板、token/context 状态栏、主题。
  - 渲染层 **pi-tui**（非 Ink）；测试套件已恢复但"predates the port 未跑通"。
- **DSH 官方 CLI**：`dsh --profile web|headless` 默认发货，`--profile tui` 是**预留槽位**（官方不随包带；本机 `~/.dsh/profiles` 确认只有 headless/web）。

### ③ 命名冲突核查
- npm 上的 `dsh-tui` v0.1.0 = **我们自己**（maintainer `mashedpotato`），无抢注。
- `@deepseek-ai/dsh-tui` 不存在（官方未发布）。
- `@openguardrails/dsh-tui` 是社区的，scoped，不冲突。

## 二、两条路线的本质区别

| | 我的 dsh-tui（现状） | openguardrails（官方插件式） |
|---|---|---|
| 接缝 | 独立 HTTP 客户端，连 `ctx.remote`(3080, mux SSE) | Cordis 插件，stdio 内，挂 dsh-base |
| 依赖 host | 需要一个 running 的 `dsh web` host | 直接由 `dsh --profile tui` 拉起，同进程 |
| 工具生态 | 只走 HTTP 暴露的工具，无原生 dsh 插件工具 | 完整官方生态（shell/fs/skills/subagents/审批） |
| 渲染 | Ink | pi-tui |
| 复用 | core 纯函数可被 VSCode 复用 | 被 dsh 生态绑定 |

## 三、本次用户决定

> **做成插件形态，保留我们写好的业务逻辑**（fold/Vim/权限档位/slash/自定义命令），
> 挂官方 dsh-base，走 stdio，渲染层沿用我们更熟的 **Ink**。

## 四、可行的落地路径（供执行时选择）

**A. 从零做插件 + 复用我们业务层（工作量最大）**
- 新建 `cordis.patch.yml`（仿 openguardrails：`agent-loop` + `system-prompt` + `llm-deepseek` + `dsh-storage` + `dsh-session-reference` + `@xxx/dsh-tui`）
- 把 lib/ 的纯函数业务层原样带入，写 Cordis 插件 entry（`{ name, inject, Config, apply(ctx) }`）
- 关键：摸清"插件内如何驱动 agent-loop / 订阅 session 事件"这一核心接缝 API
- 渲染用 Ink

**B. 直接基于 openguardrails 做差异化（最省，但放弃自研渲染）**
- fork/依赖 `@openguardrails/dsh-tui`（官方恢复版，功能最全）
- 在其上只加我们独特的：权限档位(Shift+Tab)、可复用 core、自定义命令
- 风险：它依赖 pi-tui + 测试未跑通

**C. 先实测 openguardrails 再决定（最稳）**
- 本机 pnpm 装 `@openguardrails/dsh-tui → dsh --profile tui` 跑一遍
- 亲眼看官方 TUI 多好用，再决定 A 或 B

## 五、建议

路径 C（先实测）→ 若官方版本足够好选 B；若要保留 Ink/可复用 core 选 A。
本机满足它 node 需要（v24）、peer 依赖（rc.6）齐全，可实测。

## 六、实测结论（已验证）

本机执行 `dsh plugin --profile tui add @openguardrails/dsh-tui` **成功**，
并在真实 PTY 里 `dsh --profile tui` **完整渲染出 TUI**（keyless 阶段）：
- 顶部 `DEEPSEEK HARNESS` 渐变色 logo + `main-session-<uuid>` 会话标题
- HUD 状态栏：cwd(带 git 分支 `feat/dsh-tui`) · 模型 `deepseek-v4-pro` · `↑0 ↓0`(token) · `0% context`
- 输入提示符 `dsh >` + 绿色 prompt 光标

**含义**：
1. 插件化路线（官方 dsh 插件接缝 + pi-tui）**本机完全可跑**，无需自造。
2. openguardrails 是"官方历史恢复版"，功能极全，**已是别人做好的成品**。
3. 我们若重做 Ink 插件版，等于重造轮子，除非要保留可复用 core / Ink 渲染这些官方版没有的点。

## 七、最终抉择点（供用户定夺）

- 既然 openguardrails 已可跑且功能远全：**直接用它**（省力，放弃自研渲染）
- 或：**在其上做差异化**（加我们的权限档位/可复用 core/VSCode 对接）
- 或：**仍重做 Ink 插件版**（保留自己逻辑 + Ink + core 复用，工作量最大）

详请结合《terminal-agent-landscape-2026.md》《opencode-ts-tui-reference.md》综合判断。

## 参考资料
- openguardrails README：https://github.com/openguardrails/dsh-tui (README.md)
- cordis.patch.yml（其插件接缝）已在调研时抓取
- 官方删除 TUI 的 commit `10bb9cbf4a` 已核实
- npm：https://www.npmjs.com/package/@openguardrails/dsh-tui
