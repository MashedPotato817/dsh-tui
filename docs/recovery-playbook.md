# Recovery Playbook

1. 停止当前 AI/脚本，记录分支、HEAD、`git status`、worktree 和失败命令。
2. 未提交内容先生成补丁或 checkpoint，不直接丢弃。
3. 从最后已知好提交创建 `recovery/<topic>-<date>`。
4. 未合并坏提交使用 revert 或重新挑选好提交；已共享历史只使用 revert。
5. 运行 `npm run check`、相关单测和 governance verifier。
6. 记录恢复前后 commit、终端行为和仍存在的风险。

提交似乎丢失时先查 `git reflog`，确认对象后创建 recovery 分支。禁止先运行 clean、
aggressive gc 或 `reset --hard`。
