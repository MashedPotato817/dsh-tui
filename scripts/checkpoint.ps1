param([Parameter(Mandatory = $true)][string]$Message)
$ErrorActionPreference = "Stop"
$branch = (git branch --show-current).Trim()
if (-not $branch -or $branch -eq "main") { throw "禁止在 main 或 detached HEAD 创建 checkpoint。" }
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { throw "暂存区为空；请逐文件 git add，脚本不会自动 add -A。" }
node scripts/verify-governance.mjs
if ($LASTEXITCODE -ne 0) { throw "治理检查失败。" }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw "暂存 diff 检查失败。" }
git commit -m "chore(checkpoint): $Message"
if ($LASTEXITCODE -ne 0) { throw "Checkpoint commit 失败。" }
