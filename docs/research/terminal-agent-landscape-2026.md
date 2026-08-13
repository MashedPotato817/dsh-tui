# 终端 AI Coding Agent / Claude Code 替代品调研速览（2026）

> 聚焦点：你在给远程 DSH（DeepSeek Harness）host 写 **JS/Node 终端 TUI 客户端**（Claude Code 形态）。
> 本报告回答三问：① 成熟可装的 CLI Agent 工具盘点；② 有没有"作为 host/服务的客户端"这种模式；③ 有没有 JS/Node 实现值得参考。
> 所有版本/Star 数来自 2026 搜索命中，**未逐一验证确数**，标注处请点链接核对。

---

## 1. 成熟可安装的 CLI Agent 工具盘点

| 项目 | 语言/栈 | 开源 | 可脚本化 CLI | 交互式 TUI | 许可证 | 成熟度 | 套用核心 |
|---|---|---|---|---|---|---|---|---|
| **OpenCode** `anomalyco/opencode` | TypeScript（TS 重写版） | ✅ | ✅ `opencode run` | ✅ 全功能 TUI | MIT | Star 很高（百万级生态，多来源称 2026 超 170k；版本活跃） | ✅ 核心是 TS agent loop + MCP，最接近你的栈 |
| **Aider** | Python | ✅ | ✅（git 驱动、`--message` 批处理） | 精简（非全 TUI） | Apache-2.0 | Star 46k+（2026），非常稳定 | 部分——git 基准 + patch 应用器思路可借鉴，栈不同 |
| **Goose** `block/goose` | Rust（有 JS 组件） | ✅ | ✅ CLI | ✅ TUI + 桌面 + 插件 | Apache-2.0（2025 移交 Linux Foundation 后） | 稳定，版本 v1.x（RPM 见 v1.19） | ✅ 微内核 + MCP 原生，架构可参考 |
| **Codex CLI** `openai/codex` | Rust 内核 + TS 前端 | ✅ 源码开源 | ✅ `codex exec`（非交互批处理） | ✅ 有 TUI/markdown 渲染 | Apache-2.0 | Star ~71k（dev.to 2026），发布到 rust-v0.14x | ✅ TS 前端部分与你栈极近 |
| **Amplify**（Vercel） | JS/TS 库（BYOS） | ✅ 源码公开 | ❌ 不是 CLI，是库 | ❌ | Apache | — | ⚠️ 需注意：Vercel 的 agent 产品线已转向 AI Gateway 上的 **Coding Agents**（Pi、Crush、omp、openclaw 等），Amplify 作为独立 agent 库的定位已模糊/淡出 |
| **aichat** | Rust | ✅ | ✅（`-e` 顶层执行，超适合脚本化） | ✅ REPL + shell assistant | MIT | 成熟稳定 | 部分——多 LLM 适配层思路不错，但不是 agent |

### 你没列但更该关注的两类

- **a5c-ai/agent-mux**（`amux`）：TypeScript SDK + CLI，用**一个统一契约驱动** Claude Code / Codex / Gemini / Copilot / Cursor / OpenCode / pi / omp / openclaw / hermes 等多个 agent harness。对你的"host-agnostic 客户端"野心是最直接的现成参考。
- **Cline / Roo-Code**（VSCode 形态，非终端）属另一赛道，不在本速览。

---

## 2. 关键答案：确实存在"连接 agent 服务的客户端"这种模式 ✅

你的问题（"作为 host/服务的客户端面，而非把 LLM 内嵌"）**开源生态里已有明确先例**，而且是已经标准化的协议：

### 2.1 Agent Client Protocol (ACP) —— 事实标准
- **repo**：[`agentclientprotocol/agent-client-protocol`](https://github.com/agentclientprotocol/agent-client-protocol)、[`coder/agent-client-protocol`](https://github.com/coder/agent-client-protocol)（Coder 发起）
- 一句话：**标准化"编辑器/客户端 ↔ 远端 agent"之间的协议**——正是"轻客户端连 agent host"的抽象。JSON-RPC 信封，有 `initialize/protocolVersion` 能力协商。
- **官方 SDK**：Kotlin / Java / Python / Rust / **TypeScript（`@agentclientprotocol/sdk`）**。你 **JS 栈直接可用**。
- 官方还维护了 [agentclientprotocol.com](https://agentclientprotocol.com/) 的 overview/clients/agents 清单，列了现成的 ACP 客户端实现可抄。

### 2.2 直接命中你场景的开源实现：`@offloophq/dsh-acp`
- npm 包 [`@offloophq/dsh-acp`](https://www.npmjs.com/package/@offloophq/dsh-acp)，且 deepseek-harness 官方就带一个 [`examples/acp-agent`](https://github.com/deepseek-ai/deepseek-harness/tree/master/examples/acp-agent)（也见 [`examples/jsonrpc-agent`](https://github.com/deepseek-ai/deepseek-harness/blob/master/examples/jsonrpc-agent/README.md)）。
- 含义：**已经有人用 TS 把 DSH/远程 host 包成 ACP，另一头接终端客户端**——这就是你「DSH host 的 terminal 客户端」要做的形态。直接当参考依赖。

### 2.3 其他"客户端连远端 host"类
- **OpenCode server 模式**：[server.mdx](https://docs.opencode.ai/docs/sdk) 文档 + issue 里有人做 Docker/SSH 远程实例（[agent-container](https://github.com/Du7chManiac/agent-container)、[openchamber 远程实例](https://docs.openchamber.dev/zh-cn/remote-instances/)）。OpenCode 有 **SDK（Python/TypeScript + OpenAPI codegen）与 headless HTTP server**，可通过 API 远程驱动——是「host + 独立客户端」模式的成熟范例。
- **mcpc**（`agend07/mcpc`）：通用 MCP CLI 客户端，persistent sessions / stdio+HTTP / OAuth2.1 / JSON output 模式——如果你的 agent host 走 MCP 面，这是客户端侧可抄的。

---

## 3. JS/Node 实现（最接近你 dsh-tui 栈）值得抄的

| 项目 | 说明 | 为什么 close to you |
|---|---|---|
| **OpenCode**（TS 重写） | 全 TS 的 agent loop + TUI + server/SDK | 栈几乎一致，可直接拆包 TUI/agent/server 分层参考 |
| **OpenAI Codex 的 TypeScript 侧** | `codex/sdk/typescript`（[仓库内 README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md))；另有社区打包 `@ai-nd-co/codex-sdk` | JS/TS SDK 形态，是"前端连 core"的样例 |
| **ACP TypeScript SDK** `@agentclientprotocol/sdk` | 官方 TS 客户端/agent SDK | 直接可用于你的客户端实现 |
| **`@offloophq/dsh-acp`** | DSH × ACP 的 TS 胶水 | 最接近你「连 DSH host」的直接答案 |
| **Goose 的 JS 部分** | 主体 Rust；TS 更多在桌面/插件层，非核心 | 参考价值低于前三者 |
| **agent-mux (a5c-ai)** | TS 统一驱动多 harness | 如果要"host 无关"，这是路线图参考 |

---

## 4. 直接结论（给你 dsh-tui 的落点）

1. **别自己发明"客户端连 host"协议**——直接用 **ACP（TypeScript SDK）**或抄 **OpenCode 的 server/SDK 分层**。
2. **`@offloophq/dsh-acp` + DSH 的 `examples/acp-agent` / `examples/jsonrpc-agent`** 是你的**起点金矿**，先读它的 TS 实现再动手。
3. **要想 host 无关**，抄 `a5c-ai/agent-mux` 的契约抽象。
4. **TUI 形态参考**：OpenCode（TS 全功能 TUI）和 Codex CLI 的 TS 前端是 stack 最近的两个范本。
5. **Aider** 仅借鉴 git 基准 + 审查/应用补丁的工程思路（栈不同）；**Amplify 定位已弱化，别当主参考**。

---

### 引用链接
- OpenCode：[github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)；SDK/对比：[sst/opencode DeepWiki](https://deepwiki.com/sst/opencode/7.1-share-system)、[opencode-vs-aider](https://www.morphllm.com/comparisons/opencode-vs-aider)
- Aider：[api-evangelist/aider](https://github.com/api-evangelist/aider)
- Goose：[block/goose](https://github.com/block/goose)；[DeepWiki 架构](https://deepwiki.com/block/goose/1.1-system-architecture)、[MCP 架构](https://deepwiki.com/block/goose/5.1-mcp-architecture)
- Codex CLI：[openai/codex](https://github.com/openai/codex)；TS SDK：[codex/typescript README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)；[dev.to 复盘](https://dev.to/ji_ai/71700-stars-and-60-rust-crates-inside-openais-codex-cli-source-363i)
- ACP：[cider agent-client-protocol](https://github.com/coder/agent-client-protocol)、[agentclientprotocol 主库](https://github.com/agentclientprotocol/agent-client-protocol)、[agentclientprotocol.com](https://agentclientprotocol.com/)
- DSH 客户端面：[deepseek-harness examples/acp-agent](https://github.com/deepseek-ai/deepseek-harness/blob/master/examples/acp-agent/README.md)、[examples/jsonrpc-agent](https://github.com/deepseek-ai/deepseek-harness/blob/master/examples/jsonrpc-agent/README.md)、[`@offloophq/dsh-acp`](https://www.npmjs.com/package/@offloophq/dsh-acp)
- agent-mux：[a5c-ai/agent-mux](https://github.com/a5c-ai/agent-mux)
- aichat：[sigoden/aichat](https://github.com/sigoden/aichat)
- kbot：[isaacsight/kernel/@kernel.chat/kbot](https://github.com/isaacsight/kernel)
- mcpc：[agend07/mcpc](https://github.com/agend07/mcpc)
- OpenCode 远程/Server+SDK：[server.mdx](https://docs.opencode.ai/docs/sdk)、[agent-container](https://github.com/Du7chManiac/agent-container)、[openchamber 远程实例](https://docs.openchamber.dev/zh-cn/remote-instances/)
- Vercel Coding Agents/Pi：[vercel Coding Agents](https://vercel.com/docs/ai-gateway/coding-agents)
