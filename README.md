# dsh-tui

[![npm version](https://img.shields.io/npm/v/dsh-tui)](https://www.npmjs.com/package/dsh-tui)
[![npm downloads](https://img.shields.io/npm/dm/dsh-tui)](https://www.npmjs.com/package/dsh-tui)
[![License](https://img.shields.io/npm/l/dsh-tui)](https://github.com/MashedPotato817/dsh-tui)

DeepSeek Harness 的终端客户端（TUI）。在 DeepSeek 生态内，以插件形式提供类似
Claude Code 的 agent 对话 + 类似 Vim 的模态输入 —— 在两者之间找一个平衡。

- **Claude Code 功能**：会话对话、斜杠命令、流式回复、工具调用、模型/成本状态栏
- **Vim 形式**：normal / insert / command 三模态，`i/a/o` 输入、`h/j/k/l` 移动、`ESC` 切换
- **PTC 模式**：默认用 DSH 的 `code` agent preset（Code Mode SDK，多步操作一次往返）
- **实时流**：mux SSE 流式渲染，`assistant/chunk` 边生成边显示
- **会话管理**：记忆最近会话、`/resume` 恢复、`/new` 新建、会话中切换
- **开放核心**：`core/` 纯 Node 零依赖，`ui/` 是 Ink 层——VSCode 集成可直接复用 core

## 安装

已发布到 npm，一条命令全局安装：

```bash
npm install -g dsh-tui # 或局部：npm install dsh-tui
```

需要本机已运行 `dsh web`（DeepSeek Harness host，默认 `http://127.0.0.1:3080`）。启动 host 后即可运行下面的用法。

## 用法

```bash
# 交互式 TUI（TTY 下自动进入）
dsh-tui

# 新建 / 恢复最近 / 指定会话进入交互
dsh-tui --new
dsh-tui --resume
dsh-tui --session session-xxxx

# 一次性调用（默认新建 PTC 会话 → 打印回复）
dsh-tui run "帮我写个排序函数"
dsh-tui run --resume "继续刚才的"
dsh-tui run --session session-xxxx "接着干"

# 非 TTY（管道/脚本）下列出会话
dsh-tui --new | head

环境变量：
  DSH_URL    host 地址，默认 http://127.0.0.1:3080
```

### TUI 操作

| 键 | 作用 |
| --- | --- |
| `i` / `A` / `o` 等 | 进入 insert 模式输入 |
| `ESC` | 回 normal 模式 |
| `:` | 命令模态：`:w` 提交、`:cancel` 停止回合、`:q` 退出 |
| `/` | 斜杠命令：`/new` `/resume` `/status` 或 host 命令（`/git status`） |
| `Enter`（normal/insert） | 发送 |

### HUD 状态栏

```
● deepseek-chat | PTC | $0.0123 | 1.2ki/450o  abcdef12 C:\work
   ↑ 运行状态    模型   成本      token         ↑ 会话id 工作目录
```

## 架构

```
lib/        core 层（零依赖）：client/fold/session/stream/live/vim/hud/policy/... 
ui/         Ink 组件层
bin/        cli 入口（interactive + run + list）
test/       单元飞轮（118 例）
test-live/  live 飞轮（真实 host，DSH_TEST_LIVE=1 才跑）
```

`lib/index.js` 导出 core API，供 VSCode 集成等复用，不依赖任何 UI。

## 贡献与社区

- 提交 **issue / 需求 / PR**：见 [`CONTRIBUTING.md`](CONTRIBUTING.md)，或用 GitHub 的 issue / PR 模板。
- 了解项目的 **协同机制与反馈升级飞轮**：见 [`docs/community.md`](docs/community.md) —— 从上报到修复、测试、发布的完整闭环。
- 社区路线图：见 [dsh-ecosystem](https://github.com/MashedPotato817/dsh-ecosystem)。

## 开发

```bash
npm test          # 单元飞轮（快，118 例）
npm run test:live # live 飞轮（真实 host，会调真实模型）
npm run flywheel  # --watch 快速迭代
```

详见 `docs/flywheel.md`。

## 授权

MIT
