# dsh-tui 发布手册（Release Runnable）

> 目标：在用户亲测「暂定稳定」后，把 `feat/dsh-tui` 安全送达 npm + GitHub（放开 issue/PR）。
> 遵守 `.collab` 治理：**未用户验收不得合 main**；merge 用普通合并保留历史；push 远端前确认；强推/改写历史前确认。
> 环境备注：本机全局 npm 入口曾损坏（指向不存在的 `npm-cli.js`）。本手册同时给出 `npm` 与等价 `node` 命令；两者任选其一验证即可，若 `npm` 报错就直接用 `node` 形式。

> 当前状态锚点（第 19~ 轮核对）：`feat/dsh-tui` 领先 `origin/feat/dsh-tui`（`22bcd69`）12 个提交；工作树干净；`npm test` 与直接 `node --test` 均 **194 通过 / 0 失败**；`check` / `check:types` / `check:governance` 全绿。远程尚无 `main` 分支。

---

## 0. 前置 —— 用户验收

用户在真实 Windows 终端跑关键流程，确认「暂定稳定」：

1. 启动：`node bin/interactive.js`（或 `node bin/tui.js`，若已全局安装则 `dsh-tui`）。
2. 对话：输入一条复杂 Markdown + 代码块回复，确认流式渲染、follow-tail、输入 HUD 稳定。
3. `@` 文件补全目录下钻、`/` 命令面板、`!` shell、`<Tab>/↑↓`、双击 ESC 清空、↑ 历史召回。
4. 触发一次工具审批（非白名单工具），验证 `y / Y / n` 与 acceptEdits 档自动放行。
5. `Ctrl+C` 中断、`Ctrl+L` 清屏、`/status`、`?` 帮助面板。
6. 退出后确认无报错、无残留临时文件。

**未通过则不进行后续。** 通过后记录到本次发布对应 commit 的 message 或并发笔记。

---

## 1. 基线验证（发布前门禁）

```bash
# 任选一：npm 若好用
npm test
npm run check
npm run check:types
npm run check:governance
# 任选二：等价的 node 直接命令（npm 不可用时）
node --test test/fold.test.js test/session.test.js test/client.test.js test/stream.test.js test/live.test.js test/vim.test.js test/hud.test.js test/bridge.test.js test/ui.test.js test/registry.test.js test/policy.test.js test/permission.test.js test/command-loader.test.js test/config.test.js test/history.test.js test/diff.test.js test/ui-mode.test.js test/version.test.js test/docs.test.js test/types.test.js test/mention.test.js test/tool-summary.test.js test/markdown.test.js test/viewport.test.js test/safety.test.js test/timing.test.js test/scan.test.js test/usage.test.js test/mode.test.js test/queue.test.js
node --check lib/index.js
tsc -p tsconfig.typecheck.json
node scripts/verify-governance.mjs
```

期望：194 通过 / 0 失败；`check`、`types`、`governance` 均退出码 0。

---

## 2. 推送工作分支（备份）

```bash
git push -u origin feat/dsh-tui
```

> 个人工作分支允许定期推送备份；合并 main 前先把工作分支推上去，避免远端空白。

---

## 3. 合入 main（普通合并，保留历史）

```bash
git checkout main          # 若不存在：git checkout -b main
git merge feat/dsh-tui     # 普通 merge（不 squash、不 fast-forward-only，保留提交历史）
git push origin main
```

> `.collab` 规定：合 main 需独立审查 + 可执行恢复方案 + 用户关键流程验证。发布前若有 Reviewer，先走完审查。

---

## 4. 版本 bump 与发布

版本策略（语义化，当前 `0.2.19`）：

- 补丁 `0.2.x`：bug fix / 文档 / 纯内部。
- 次版本 `0.3.0`：本轮新增队列、前缀区分等多项产品能力，建议 bump 到 `0.3.0`。
- 发布 tag + 推送：`npm run tag`（内部调用 `node scripts/tag-version.mjs --push`）。

```bash
npm run tag        # bump 版本 → commit → 打 tag → push 远端
npm publish        # 发布 npm（publishConfig.access: "public" 已配好）
```

> `npm run tag` 的 `--push` 会推到远端；确认 tag/版本号符合语义后再发。`npm publish` 需要 npm token/登录态。

---

## 5. 发布后复核

1. `npm view dsh-tui version` 确认新版本已上线。
2. GitHub 远端 `main` 与 tag 均在（`git ls-remote --tags origin`）。
3. 放开 issue / PR：确认 `.github/ISSUE_TEMPLATE/`、`pull_request_template.md`、workflows CI 均已在 `main`（CI 首次合并会自动建 checks）。
4. 通知社区入口 `docs/community.md`（协同闭环 + 反馈升级飞轮）与 ecosystem 列表。

---

## 6. 回滚

- 产品功能回滚：`git revert <bad-commit>`（只 revert，禁 `reset --hard` 改写已共享历史）。
- 发布回滚：`npm unpublish <version>` 仅限新版本 / 48h 内（或用新补丁版修正）。
- 治理文件回滚：独立 revert `.githooks/` / `.collab/` / workflow 文件即可，不影响运行时代码。

---

## 待办核对（release 前 checklist）

- [ ] 用户在真实终端验收核心流程（本文 §0）
- [ ] 194 tests / check / types / governance 全绿（§1）
- [ ] `feat/dsh-tui` 已推送备份（§2）
- [ ] 合 main 已完成（含独立审查）（§3）
- [ ] 版本号语义化正确、tag 已推、npm 已发（§4）
- [ ] GitHub main + tag + issue/PR + CI 复核通过（§5）
