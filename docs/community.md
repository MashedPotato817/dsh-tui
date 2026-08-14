# 社区协同机制与反馈升级飞轮

dsh-tui 是一个开放、面向社区协作的 DeepSeek Harness 终端客户端。本文档定义：
1. **仓库与工作流布局**（跨仓库协同）
2. **Issue/PR 处理流程**
3. **反馈升级飞轮**（从上报到修复、到测试、到发布的闭环）

## 一、仓库与工作流布局

dsh-tui 隶属于 DSH 生态（见 `dsh-ecosystem` 的 `ROADMAP.md`）。相关仓库：

| 仓库 | 职责 |
|------|------|
| `MashedPotato817/dsh-tui` | 本 TUI 客户端（代码、issue、PR 都在此）|
| `MashedPotato817/dsh-ecosystem` | 生态路线图 / 协作约定 / 跨项目文档 |
| `MashedPotato817/dsh-git-plugin` | Git 工作流插件 |
| `MashedPotato817/dsh-tool-browser` | 浏览器自动化插件 |

**分支约定**：
- 主工作分支：`feat/dsh-tui`（含全部最新代码与文档）
- 新功能 / 修复：切个人分支（`fix/*` / `feat/*` / `docs/*`），MAA 风格提交
- `main`：正式稳定版基座（验收通过后由维护者基于 `feat/dsh-tui` 建立）

## 二、Issue / PR 处理流程

### 上报端（Issue）
- 用模板提交（Bug / Feature），附带环境信息（OS / Node / DSH 版本 / 终端类型）与复现步骤。
- 维护者（Agent + 人工）会**自动标注**：`bug` / `enhancement` / `needs-repro` / `good-first-issue`。
- 反馈可对标成熟产品（Claude Code / OpenCode / Codex），便于对齐设计。

### 处理端（Agent + 维护者）
1. **分类**：按类型派发（UI 布局 → `ui/`；协议/消息 → `lib/`；CLI → `bin/`）。
2. **根因定位**：优先用真实 host + node-pty 复现（`scripts/interactive-smoke.mjs`），少靠猜。
3. **修复 + 测试**：core 层改动用单测覆盖；UI 改动用 renderToString 冒烟；真实链路用 `test-live/`。
4. **发布**：通过后 bump 版本（`0.2.x` 语义化）、发布 npm、Push 备份。

### 发布即对齐（飞轮嵌合度关键）
发布不止是「npm publish」。为保证三处一致、用户反馈对到同一版本：
1. `npm publish` → npm `latest` 更新。
2. `npm run tag`（`scripts/tag-version.mjs --push`）→ 给当前 commit 打 `vX.Y.Z` 并 push 到 GitHub。
3. 若该版本要作为稳定版，把 `feat/*` 合并进 `main` 并 push（由维护者确认后执行）。
4. 在 GitHub Releases 页为对应 tag 写 changelog（可选，但建议）。
> 校验：`npm view dsh-tui version` ≡ 本地 `package.json` ≡ GitHub 最新 tag 指向的 commit。

## 三、反馈升级飞轮（Feedback Upgrade Flywheel）

「反馈 → 定位 → 修复 → 测试 → 发布 → 用户验证 → 更高质量反馈」的持续循环。

```
 ① 用户/社区上报 (issue, 附环境+复现)
        │
        ▼
 ② 分类 + 环境诊断            ┌────────────────────────┐
        │                     │  质量网关（每版必过）    │
        ▼                     │  - check 语法            │
 ③ 根因定位 (真实 host + PTY)  │  - npm test 单测(116+)   │
        │                     │  - test:live 真实链路     │
        ▼                     │  - 真实终端截图           │
 ④ 修复(core/ui 分层) + 单测  └───────────┬────────────┘
        │                                 │
        ▼                                 │
 ⑤ 发布 (bump → npm publish → push) ──────┘
        │
        ▼
 ⑥ 用户验证新版本 → 若仍有问题回到 ① (更高信息质量)
```

**每个「升级」的价值**：每一轮反馈都让下一轮更快——
- 首次上报 = 复现路径硬化
- 首次修复 = 自动化测试固化（同一类 bug 不再复发）
- 发布 = 社区可验证,反馈质量提升(用户拿到新版本带着更准的现象)

## 四、质量与发布标准

| 关卡 | 要求 |
|------|------|
| 语法 | `npm run check` 零错误 |
| 单测 | `npm test` 全绿（当前 116） |
| live | 涉及真实链路时 `npm run test:live` 全绿（3 例）|
| 交互 | 真实 TTY（node-pty）验证：输入/回复/布局 |
| 命名空间 | `docs/*` / `feat/*` / `fix/*`,MAA commit |

## 五、如何参与

- **提 issue**：bug / feature,见模板。
- **提 PR**：按 CONTRIBUTING 的约定,核心是「core 纯函数可单测」。
- **讨论**：在 issue 或 Discussion 中分享你对标成熟产品的想法。
- **试用最新版**：`npm install -g dsh-tui@latest` 并反馈真实体验。

感谢你让 dsh-tui 变得更好。🚀
