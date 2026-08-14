# dsh-tui 工程化路线图 —— 对标主流 Agent（Claude Code 为主参照）开箱即用

> 目的：把「打磨成开箱即用、对标 Claude Code 等主流 Agent、面向程序员的 TUI」落实成可执行的工程路线。
> 依据：`docs/research/` 下 claude-code / codex / opencode / pi-tui / official-plugin-standard 等调研交叉汇总。
> 原则：大方向先对；每批 lib/ 纯函数 + 单测 + check/types + node-pty 烟测；不改协议、不迁 UI 框架、保留 lib/ 可复用。

## 里程碑（大方向）

- **M1 开箱体验（进行中）**：启动即用、输入快路径、历史/最近的便利、错误直面。
- **M2 审批与权限**：把「一次性/本会话/拒绝」补齐为四态，plan 批准后自动切档。
- **M3 补全与命令**：`@` 文件升级（目录下钻+子序列打分）、`!` shell、leader key 避免冲突。
- **M4 工程健壮**：模式状态机、对话框队列、时间/token 增量、diff 预算防御、控制字符转义。
- **M5 性能**：定稿块行缓存、流式轻渲染 vs settle 完整渲染、超长会话稳定。

## 分批（按 价值/风险 排序，每批独立可交付）

### Batch 0 —— 输入交互细节（用户点名，立竿见影，风险低）
- [ ] 输入框非空时：第一次 ESC 回 normal（保留草稿），第二次 ESC 清空当前输入（Claude Code 心智）。
- [ ] 上下方向键在输入可编辑时调用「最近发过的消息」历史（Claude Code 历史召回），normal 的 j/k 仍在行内移动。
- [ ] 历史保留最近 N 条（已有 pushHistory/registry）并可持久化/回显。
- 验证：lib/vim.js + history 纯函数单测；node-pty 烟测按 ↑ 出上一条。

### Batch 1 —— 工程健壮（pi-tui 精读 + Claude Code 共识，低风险）
- [ ] `displayText()` 控制字符转义（防模型输出注入 CSI/OSC 破坏布局）。
- [ ] diff 编辑距离预算守卫（超预算回退整边渲染 + 标 approximate）。
- [ ] 审批四态：allowed-once / allowed-session / rejected-and-continue / rejected-and-abort（对齐 Codex ReviewDecision）。

### Batch 2 —— 补全与命令（中风险）
- [ ] `@` 文件补全升级：实时 readdir 单目录 + 裸名有界索引 + 子序列打分排序 + 目录尾 `/` 下钻 + `@"path"` quoted。
- [ ] 输入补全里区分 `/ @ ! :` 前缀（Claude Code 心智）。

### Batch 3 —— 架构健壮（中-高风险，宜稳扎稳打）
- [ ] 显式全局 mode 状态机 + keybinding 表（对话/审批/命令/补全/历史 各态不打架）。
- [ ] 对话框改异步 FIFO 模态队列（不阻塞主循环，AbortSignal 贯穿）。
- [ ] 计时改共享游标单次扫描（O(events) 防二次方退化）。

### Batch 4 —— 性能与渲染（在已有 follow-tail / markdown 之上）
- [ ] 流式期轻渲染 vs settle 完整 Markdown 分离。
- [ ] 定稿消息/工具卡按 width 行缓存，状态变更才失效。
- [ ] token 按 turn:step 去重 + 上下文压力提示。

## 取舍原则

1. **滚动**：保留已完成的 app-level follow-tail（默认跟随/PgUp·PgDn/End 回底/输入固定）——已有的实现对标 Claude Code 优于 pi-tui 的 scrollback 让渡，不退回。
2. **框架**：不迁 OpenTUI/OpenCode 的 TUI 库；保留 Ink + lib/ 纯函数分层（lib/ 可被 VSCode 复用）。
3. **Markdown**：不引 marked（每 chunk 全量 re-parse 是 pi-tui 的坑）；用自研 lib/markdown.js 轻量解析 + 增量批渲染。
4. **协议**：不改 DSH host 协议；只消费现有 contract（ctx.remote、mux、approval/question requested）。
5. **合 main**：每批推到 feat/dsh-tui，用户验收暂定稳定后才合；强推/改写历史前确认。

## 每批交付标准
- `lib/` 纯函数 + `test/*.test.js` 单测全绿
- `npm run check`、`npm run check:types` 通过
- 涉及交互/渲染的改进跑 `npm run smoke:interactive`（node-pty 真实 TTY）
- MAA 风格 commit，推到 `feat/dsh-tui`
