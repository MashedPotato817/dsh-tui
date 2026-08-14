# dsh-tui 真实终端验收反馈

> 本文件只记录用户在真实 Windows Terminal 中的体验与复现证据。问题在验收结束、统一确认优先级后再分别修复；记录阶段不直接修改实现。

## 2026-08-14 验收会话

### F-001 发送后用户输入不可见，长时间缺少可感知反馈

- 状态：工程修复完成，待真实 Windows Terminal 复验
- 环境：Windows Terminal、PowerShell、`node bin/tui.js`
- 模型：`deepseek-v4-flash[1M]`
- 权限档位：`acceptEdits`（界面显示 `edits`）
- 用户体验：输入并发送后，刚发送的用户消息从界面消失；界面没有可感知的思考进度、推理摘要或阶段状态，交互反馈较弱；等待至少 1 分 34 秒仍没有助手正文输出。
- 截图证据：`codex-clipboard-d7f3e7cb-5bb0-4153-abb9-763ea83f6511.png`
- 截图可见状态：`Worked for 1m 34s`，输入框为空，正文区未显示用户消息或助手回复；HUD 已出现 token/成本数据。

拆分检查：

1. 用户消息是否应在发送时立即乐观回显，并在刷新/流式阶段持续可见。
2. running 状态是否应显示 spinner、阶段文案、工具调用或安全的推理摘要，而不是暴露模型私有思维链。
3. 已产生 usage 但无正文时，是否发生 SSE 丢帧、history 折叠遗漏、空回复、回合结束事件遗漏或渲染层隐藏。
4. 长时间无可见输出时，是否需要超时提示、重连状态和可执行的取消/重试入口。

#### 端到端审查结论

已证实：

1. **长回复被视口整体丢弃**：当前 `tailWithinBudget()` 在最新一条消息的估算高度大于正数预算时返回 `start = messages.length`，导致消息列表为空。本机最近会话中 host 已正常完成并保存 1814 字符 assistant 正文；按截图附近终端尺寸估算，该消息约 58 行、消息预算约 20 行，函数实际返回 `{ start: 6, lines: 0 }`。`renderToString` 也复现为 user/assistant 均不可见、只剩 `Worked for`。
2. **测试边界缺失**：现有“预算不足时保留最新一条”测试只覆盖 `budget = 0`，没有覆盖 `0 < budget < 最新消息高度`；因此 194 项测试全部通过仍漏掉真实缺陷。
3. **完成耗时会继续增长**：UI 用每秒更新的 `now - turnStartTime` 渲染已完成回合的 `Worked for`，没有使用 `turn/end` 时间。因此回合完成后数值仍继续增加，容易让用户误判仍在工作。
4. **推理阶段没有可见反馈**：`reasoning-delta` 会进入内部 draft 并参与相位计时，但可见 draft 明确只筛选 `text` 块；正文出现前没有清晰的 `Thinking…`/阶段/耗时反馈。这里应展示安全状态或摘要，不应直接暴露私有思维链。
5. **错误状态没有渲染出口**：mux 的 `stream/error` 和重连耗尽错误写入 `state.error`，但 App 没有展示 `snapshot.error`，用户可能只看到空白或停止变化。

高风险、需用新增竞态测试确认：

6. **启动基线可能覆盖刚发送的乐观消息**：App 不等待 `conv.open()` 完成就开放输入，并且同时启动 history sync；`#baseline()` 会整体替换 `state.messages`。快速发送、基线响应较慢时存在覆盖窗口。
7. **订阅游标可能跳过缺失事件**：`session/subscribed` 直接把 `lastSeq` 推进到服务端最新值，而 `#mergeView()` 在 history 的 `lastSeq <= state.lastSeq` 时不再合并消息；基线与订阅之间发生的事件可能永久缺失。
8. **重连/切换会话的生命周期缺少单实例保护**：重连基线同样整体覆盖本地状态；`switchSession()` 更换 AbortController 后，旧消费/轮询循环有机会继续，可能与新循环并行。

产品成熟度缺口：

9. 当前视口以“整条消息”为最小单位，不能在一条超长回复内部按视觉行分页；`PageUp/PageDown` 只改变消息起点，无法可靠阅读单条长回复。
10. `question/requested` 没有交互面板，而是默认代替用户选择首项；虽然避免挂起，但会擅自作出产品/执行决策，不符合成熟 coding agent 的协作预期。
11. `bypassPermissions` 的实现、注释和纯函数策略不一致：实时审批分支无条件自动放行，但 `allowToolsForMode()` 与配置语义写的是只放行 `allowTools` 白名单；需要先明确安全语义再发布。
