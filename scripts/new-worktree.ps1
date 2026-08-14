param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("feat", "fix", "docs", "chore", "style", "refactor", "test", "perf")]
  [string]$Type,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9][a-z0-9-]*$')]
  [string]$Slug,
  [string]$Base = "feat/dsh-tui"
)
$ErrorActionPreference = "Stop"
$root = (git rev-parse --show-toplevel).Trim()
$parent = Split-Path $root -Parent
$target = Join-Path (Join-Path $parent "dsh-tui-worktrees") "$Type-$Slug"
$branch = "$Type/$Slug"
if (Test-Path -LiteralPath $target) { throw "目标 worktree 已存在：$target" }
New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
git worktree add -b $branch $target $Base
if ($LASTEXITCODE -ne 0) { throw "创建 worktree 失败。" }
Write-Output "branch=$branch"
Write-Output "worktree=$target"
