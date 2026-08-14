# 可靠消息 + 空回复：逆向/方案落地记录

> 依三路调研：①逆向(DeepSeek Harness 开源 + Codex + Claude Code)；②可靠消息(Codex/OpenCode/Goose/Aider)；③交互差距(三套参考)。
> 目的：解决"用户发消息没返回/空回复/UI 挂 pending"。

## 一、逆向核实结论

1. **DeepSeek Karness 官方仓库已开源**：`deepseek-ai/deepseek-harness`(TS/JS monorepo)。
   TUI 最该读：`packages/client/connection/`(浏览器↔宿主 RPC 与事件投递)、`packages/llm/llm-deepseek/`。
   → 我们连的协议正是这个官方 client contract，方向对。
2. **OpenAI Codex**(真开源 Rust+TS)：重试在 `codex-rs/core/src/responses_retry.rs`：
   - 连接重试 5s 起、双倍退避封顶 60s、串行 `max_retries`；
   - 到上限 `try_switch_fallback_transport`(WebSocket→HTTPS 降级)；
   - UX：重连 `notify_stream_error` 通知「Reconnecting… n/max」——**"发消息不卡死"的核心**。
3. **Claude Code** 闭源，但有更全的逆向仓库(l3tchupkt/zhuxijing123 等，source-map 反推)。
4. **SSE 断流修复范本** `esengine/DeepSeek-Reasonix` commit f06bd1d：
   - 空/心跳 `data:` 行绝不放 json 错杀流，`data==""` 就 continue 跳过；
   - 半开断流(本地代理静默丢 SSE、无 FIN) → 错误包 `io.ErrUnexpectedEOF` 触发重试。

## 二、可靠消息系统方案(综合)

| 项 | 方案 | 落地状态 |
|---|---|---|
| SSE 空行/心跳 | 空 data continue 不杀流 | ✅ stream.js 已有 |
| pending 超时提示 | >8s 显示「仍在处理… Ns」(黄) | ✅ 0.2.4 |
| 空回复占位 | host 回了但无文本 → 显式提示 | ✅ 0.2.4 |
| history 轮询兜底 | mux 断帧回复必达 | ✅ 0.2.3 |
| 请求幂等 + 发送后 ack | requestId + turn 确认 | ⏳ 需确认 host prompt 契约 |
| turn 超时强制落定 | pending 永不无限期 | ⏳ 下一步 |
| 重连 rehydrate | 断线后拉全量快照对齐 | ⏳ 下一步 |

## 三、根因诊断(实测)

- 用原始协议连发多条到同一会话：host 端(opencode-go 网关)对**连续多轮**第二条起有时返回**旧回复或空文本**。
- 这是 **host/provider 行为**，非 dsh-tui 渲染错误。dsh-tui 已通过"空占位 + pending 超时 + history 兜底"让这种情况**有明确反馈**而非"没反应"。

## 四、落地优先级

1. ✅ done：SSE 空行 / history 兜底 / 空占位 / pending 超时
2. 下一步：turn 超时(>N s)强制把 pending 落定成错误态 + 重试提示(Codex 模式)
3. 可选：requestId 幂等(需 host 契约支持)

## 参考
- Reasonix f06bd1d / codex responses_retry.rs / opencode resync PR / goose 空 turn 重试
- Claude Code retrying·attempt / errors.md 横幅
