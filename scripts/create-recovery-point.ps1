param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9][a-z0-9-]*$')]
  [string]$Topic
)
$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$name = "recovery/$Topic-$stamp"
if (git status --short) { Write-Warning "未提交内容不在 recovery branch 中；请先 checkpoint。" }
git branch $name HEAD
if ($LASTEXITCODE -ne 0) { throw "创建 recovery branch 失败。" }
Write-Output $name
