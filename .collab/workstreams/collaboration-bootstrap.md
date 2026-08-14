# Workstream: collaboration-bootstrap

- Status: review
- Branch: feat/dsh-tui
- Worktree: C:/Users/zhntd/Desktop/game/dsh-tui
- Implementer: Codex
- Reviewer: unassigned
- Created: 2026-08-14
- Lease review date: 2026-08-21

## Objective

在不改变 TUI 产品行为的前提下增加 workstream、交接、checkpoint、恢复与 CI 治理。

## Write scope

- Allowed: governance docs, scripts, CI/PR metadata, package scripts
- Forbidden: lib/, ui/, bin/, tests, release workflow, product version

## Dependencies

DSH Collaboration Hub；现有 dsh-tui CI 与贡献流程。

## Acceptance criteria

- 现有 check/test/typecheck 保持通过。
- governance verifier、pre-commit hook 和恢复分支演练通过。
- 不修改运行时代码和发布配置。

## Checkpoints

| Commit | Meaning | Verification |
|---|---|---|
| 22bcd69 | 本次治理前产品基线 | existing branch clean |
| d9a0af2 | 接入仓库级协同治理 | governance、186 tests、typecheck passed |

## Activity log

- 2026-08-14：认领治理文件范围。
- 2026-08-14：完成治理接入；npm 入口损坏，已用等价 Node/TypeScript 命令验证。

## Risks and rollback

治理文件可独立 revert；产品运行时代码未进入范围。
