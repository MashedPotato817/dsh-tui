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

### Batch 0 —— 输入交互细节（✅ 已交付 commit 5463300）
- [x] 输入框非空时：第一次 ESC 回 normal（保留草稿），第二次 ESC 清空当前输入。
- [x] 上下方向键在输入可编辑时调用「最近发过的消息」历史（Claude Code 历史召回），normal 的 j/k 仍在行内移动。
- 验证：lib/vim.js 单测 + node-pty 烟测。

### Batch 1 —— 工程健壮（✅ 安全项已交付 e6958e7；审批项已核实契约）
- [x] `displayText()` 控制字符转义 → `lib/safety.js`（sanitizeControlChars），已接入 assistant/streaming。
- [x] diff 编辑距离预算守卫 → `lib/diff.js` guardDiff（超预算折叠标 approx），已接入 ToolCards。
- [≈] **审批取舍（已核实 host 契约，勿加新 outcome）**：DSH host `dsh-user-approval` 的 `OUTCOMES` 仅 `allowed-once / rejected / cancelled / unavailable`。没有 `allowed-session`，也没有 `rejected-and-continue/abort`。
  - `allowed-session` 是**客户端本地语义**（dsh-tui 已正确实现：host 收 `allowed-once` + 本地 `sessionAllowedTools` 记住）。
  - "拒绝并中止" host 不认 → 需走其它机制（如 session.cancel），不新增 outcome。
  - **结论**：审批能落地的"态"就是一次 `allowed-once` / 拒绝 `rejected` / 会话记住（本地）+ 中止（cancel 侧路）；不新增四态 outcome，避免向 host 发非法值破坏 approval 流。

### Batch 2 —— 补全与命令（✅ 主项已交付 fdab239）
- [x] `@` 文件补全升级：目录内查询下钻 + 子序列打分排序 + 回车整 token 替换 + 空格自动 `@"path"` quoted（`lib/mention.js`）。
- [ ] 输入补全里区分 `/ @ ! :` 前缀（Claude Code 心智）—— 部分已有（/ 与 @ 分面板），`!`/`:` 待评估。
- [x] 嵌套 fs 扫描支持真下钻 → `lib/scan.js` scanWorkspace（有界 BFS，注入 listDir 保持纯函数），App 启动时有界扫嵌套路径（maxEntries 4000/depth 5），@ 补全真正下钻。

### Batch 3 —— 架构健壮（中-高风险，宜稳扎稳打）
- [x] 显式全局 mode 状态机 + keybinding 表（对话/审批/命令/补全/历史 各态不打架）→ `lib/mode.js` MODES/transitionMode/keyOwner（0acadfc/8cd307a）。
- [x] 对话框改异步 FIFO 模态队列（不阻塞主循环，AbortSignal 贯穿）→ `lib/queue.js` createModalQueue（4c83026，5 用例绿）。纯原语已就绪，接入审批/问题弹窗为后续可选 wiring。
- [x] 计时改共享游标单次扫描 → `lib/timing.js` createTimingAccumulator/advanceTiming（O(events) 防二次方退化），已接入 live 相位分相。

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
