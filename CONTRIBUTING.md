# 参与贡献（Contributing）

感谢你愿意帮助 dsh-tui 变得更好。本指南说明如何提 issue、提 PR、以及这个项目的协作约定。

## 提交问题（Bug / Feature / Question）

提交 issue 时请：

1. **先去 [Issues](https://github.com/MashedPotato817/dsh-tui/issues) 搜索**是否已有人提过（包括已关闭的）。
2. 选对应模板：
   - 反馈 Bug — 按模板填：环境（OS/Node 版本/host 版本）、复现步骤、期望 vs 实际、是否稳定复现。
   - 提需求 — 描述场景与期望行为；标明是否对标 Claude Code / OpenCode / Codex。
3. Bug 报告**务必包含**：
   - 所在平台（Windows/macOS/Linux）与 Node 版本（`node -v`）
   - DSH host 版本（`dsh --version`）
   - 终端类型（Windows Terminal / iTerm2 / 其它）
   - 关键现象（报错、卡 pending、布局错乱等）——带截图最佳

## 提 Pull Request

1. 阅读 [`COLLABORATION.md`](COLLABORATION.md)，创建 workstream 记录和独立 worktree；
   **从 `feat/dsh-tui` 切类型分支**，不要直接提交 main。
2. MAA 风格 commit：`<类型>(<作用域>): <中文主体>`，如 `fix(ui): HUD 移到底部防跳顶`。
   - 类型：`feat` / `fix` / `docs` / `chore` / `style` / `refactor` / `test` / `perf`。
3. 改动后请：
   - 跑 `npm run check:governance`（协同、安全与分支门禁）
   - 跑 `npm run check`（语法）
   - 跑 `npm test`（单测，须全绿）
   - 如涉及真实 host 链路改动，跑 `npm run test:live`（需本机开着 dsh host + 模型 key）。
4. 描述你的改动：动机、做了什么、如何验证（测试/真实终端截图）。
5. PR 会被 review；`core/`（`lib/`）层保持**纯函数、零 Node 依赖、可单测**——这是它可被 VSCode 复用的关键。

## 代码约定

- **`lib/`（core）**：纯 Node ESM、无 UI 依赖、每个模块配单测（`test/*.test.js`）。
- **`ui/`（Ink 层）**：`React.createElement` 手写，不引入 JSX 构建。新增组件请在 `test/ui.test.js` 加 renderToString 冒烟。
- **纯函数优先**：状态机 / 折叠 / 策略等都写成可单测的纯函数（见 `lib/vim.js` / `lib/fold.js` / `lib/permission.js`）。

## 协同与飞轮（Feedback Flywheel）

请阅读 [`docs/community.md`](docs/community.md) 了解 dsh-tui 的全局协同机制与「反馈升级飞轮」——issue 从上报到修复的闭环路径。
