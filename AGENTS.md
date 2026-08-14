# Agent 开发约定

- 所有开发在 `feat/*`、`fix/*`、`docs/*`、`chore/*` 等类型分支进行，不直接提交 main。
- Commit 使用 MAA 风格：`<type>(<scope>): <中文主体>`。
- `lib/` 保持无 UI 依赖、可单测；`ui/` 保持 Ink/React 边界。
- 写入前创建或认领 `.collab/workstreams/<id>.md`，声明 worktree、文件范围、依赖、
  Implementer、Reviewer 和恢复点。
- 一个 workstream 只有一个写入负责人；不得覆盖其他活跃 workstream 的文件范围。
- 高风险修改前创建 checkpoint；已共享历史只能 revert，禁止 `reset --hard`。
- 合并 main 需要独立审查、可执行恢复方案以及用户关键流程验证。
