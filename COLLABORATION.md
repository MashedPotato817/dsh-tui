# Collaboration Protocol

每项工作由 workstream、独立分支/worktree、精确写入范围、小 checkpoint、独立 Reviewer 和
恢复点组成。聊天记录不是协同事实来源，仓库记录和 Git 对象才是。

## 生命周期

`proposed -> claimed -> in-progress -> review -> user-validation -> ready-to-merge -> merged`

允许 `blocked`、`handoff`、`abandoned`、`reverted`。

## 并行规则

- 一个文件同时只有一个写入负责人。
- `lib/`、`ui/`、测试和文档可拆为不同 workstream，但共享契约修改必须先由 owner 记录。
- 范围扩大前更新 workstream；交接使用模板并包含准确 commit 与测试结果。

## 回溯规则

- checkpoint 只提交人工/Agent 已明确 stage 的文件，脚本不自动 `git add -A`。
- 本地坏提交优先 recovery branch 或 revert；已推送提交必须 revert。
- 禁止强推和 `reset --hard`，除非用户对明确目标单独授权。
- CI 通过不等于稳定；用户实际终端流程验证后才允许合并 main。
