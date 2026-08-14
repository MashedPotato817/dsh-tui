# 官方 DeepSeek Harness 插件质量标准 —— dsh-tui 成熟度对标

> 调研对象：`@deepseek-ai/*`（0.1.0-rc.6）已安装到本机 DSH host 的全部官方 cordis 插件。
> 目的：从官方"优质插件"提炼一套可复用的**成熟度/嵌合度标准**，逐项对照 dsh-tui 及我们生态插件。
> 结论先行：dsh-tui 的功能和架构没问题，但**在工程规范（类型/发布/文档）上离官方"嵌合"还有差距**，是可补的、且应补的。

## 1. 官方插件清单（已装，约 130 个 `dsh-*`）

覆盖领域：`dsh-agent-*`（agent 循环/预设/指令）、`dsh-client-ui-*`（web 前端 UI 组件）、
`dsh-command-*`（slash 命令）、`dsh-fs-*`/`dsh-bash-*`/`dsh-tool-*`（工具）、
`dsh-session-*`（会话/checkpoint/persistence/title/stats/telemetry）、`dsh-skill-*`、`dsh-spill-*`、
`dsh-subagent-*`、`dsh-timeout-*`、`dsh-token-meter`、`dsh-credentials`、`dsh-permission-presets`、
`dsh-message-feedback`、`dsh-user-approval` 等。

**结论**：官方生态是一个**庞大的 monorepo**（`deepseek-ai/deepseek-harness`，子包 `packages/**/`），
每个插件是一个**小而专、命名统一、自文档完备**的 cordis 插件。这就是"优质插件"的形态。

## 2. 官方插件工程规范（可抄的标准）

### 2.1 包声明
- `"type": "module"`、`"main": "lib/index.js"`、`"types": "lib/types/index.d.ts"`。
- `"exports"` 映射具名子路径（`.` / `./invariant` / `./types` / `./src/*`），types + default 双条目。
- `"publishConfig": { "access": "public" }`。
- `"repository.directory"` 指向官方 monorepo 里的包路径。

### 2.2 运行时结构
- `lib/index.js`（插件本体，`export { name, inject, ... }`）。
- `lib/invariant.js`（`assertNever` 等契约守卫，closed-union 兜底）。
- `lib/types/`（TS 声明，含 `Branded<B>` nominal type —— 跨包 id（`SessionId`/`CallId`）类型隔离）。
- cordis 注入声明：`inject: ["commands"]` 类型化依赖，不直接用 `ctx.get`。

### 2.3 文档纪律（极具参考价值）
- `README.md` + `README.zh.md` 双语。
- `README.i18n.yaml`：记录两语 README 的 git blob hash，用 `verify-translation-pairing` 强制两语一致。
- README 结构：一句话定位 → **契约表（Command contract：input/result/error）** → **"What this plugin does and does not do"（承诺边界）** → Composition（组合示例）→ 事件/副作用明细。
- **承诺边界**是核心：明确写出"acknowledgement 只代表已入 log，不代表已上盘"，不夸大承诺。

### 2.4 UI 组件质量（`dsh-client-ui-primitives`，对 TUI 的参考）
组件：`CodeBlock` `TerminalBlock` `DiffBlock` `JsonTree` `SearchBlock` `WebBlock`
`MarkdownText` `highlight` `incremental` `katex` `ansi` `StateDot` `Pill` `Toast` `Tooltip`
`ConnectionBanner` `BrandWordmark` `FishLogo` `cjkFriendlyStrong` `useAnchoredMaxHeight` `use-copy-feedback`。

> 启示：成熟 UI 是**一组可复用原语**（code/markdown/diff/terminal 渲染 + 状态点/连接横幅/品牌标 +
> 复制反馈/锚定高度），而非堆满一页。dsh-tui 的 TUI 可借鉴其"组件分层 + 状态可视化"心智。

## 3. dsh-tui 现状 vs 官方标准（差距清单）

| 维度 | 官方标准 | dsh-tui 现状 | 差距 |
|---|---|---|---|
| types 声明 | `.d.ts` + `exports` | 无 types（零依赖 JS）| 🔴 缺（易补）|
| 发布 `publishConfig` | `access:public` + repo.directory | 有，未标 repo.directory | 🟡 |
| README 双语/i18n.yaml | 双语 + hash 一致性 | 单语中文 | 🟡 |
| 规范（内置文档计数） | `Branded` type | 有 `docs.js` 纯函数 | 🟢 相当 |
| 全局协同 | `dsh-ecosystem` roadmap | 已有 community 文档 | 🟢 |
| release/tag 对齐 | 官方 monorepo tag | 已补 `npm run tag` | 🟢（本session）|

## 4. 该不该做 / 优先级

- **P0 —— 补 `.d.ts` 类型声明**：`lib/index.js` 已导出 40+ 纯函数，VSCode/TS 复用是卖点，缺类型是最大可感知差距。加 `lib/types/*.d.ts` + `exports` 具名子路径，零构建。
- **P1 —— readme 承诺边界 + i18n**：在 README 加"does and does not"边界；补 `README.zh.md` 已有中文，`README.i18n.yaml` 记录 hash。
- **P1 —— package.json 补 `repository.directory` + `publishConfig`**：让 npm 页面能跳 repo。
- **P2 —— 生态插件（dsh-tool-browser / dsh-git-plugin）对齐同一可复用原语/规范**：写进 dsh-ecosystem 的插件开发约定。

## 5. 结论

dsh-tui **功能面已成熟**（HUD/流式/权限/命令/dock/输入，均验证），但要把"嵌合度"对齐官方优质插件，
**最值得补的是"类型声明 + 文档承诺边界 + 包元数据"这层工程规范** —— 成本低、可单测/可验证、社区可感知。
UI 层面应学习官方 `primitives` 的"组件原语 + 状态可视化"分层，逐批补齐（codeblock/diff/terminal 渲染、连接横幅等）。
