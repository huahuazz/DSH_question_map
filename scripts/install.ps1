# lateral-ask 安装脚本（幂等）
#
# 把本仓库安装到 DSH Desktop 的 desktop profile：
#   1) 复制 package.json + lib/ 到 %USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-plugin-lateral-ask\
#   2) 在 profile 的 cordis.yml 里登记一条 loader 条目（已存在则跳过）
#
# 用法（在项目根目录）：pwsh -File scripts\install.ps1
# 卸载：pwsh -File scripts\install.ps1 -Uninstall

param(
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$dest = Join-Path $profileDir 'node_modules\dsh-plugin-lateral-ask'
$cordisPath = Join-Path $profileDir 'cordis.yml'
$marker = 'dsh-plugin-lateral-ask'

if (-not (Test-Path $profileDir)) {
  throw "desktop profile 不存在：$profileDir"
}

if ($Uninstall) {
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  if (Test-Path $cordisPath) {
    $text = Get-Content $cordisPath -Raw
    if ($text -match $marker) {
      # 逐行剔除属于本插件的条目块
      $lines = Get-Content $cordisPath
      $kept = New-Object System.Collections.Generic.List[string]
      $skip = 0
      foreach ($line in $lines) {
        if ($line -match $marker) { $skip = 2; continue }
        if ($skip -gt 0) { $skip--; continue }
        $kept.Add($line)
      }
      Set-Content -Path $cordisPath -Value $kept -Encoding utf8
    }
  }
  Write-Host "已卸载 lateral-ask（若页面仍加载着插件，刷新一次即可）"
  exit 0
}

# 1) 复制产物
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item (Join-Path $root 'package.json') $dest
Copy-Item (Join-Path $root 'lib') $dest -Recurse

# 2) 登记 loader 条目
$entry = @(
  '- id: lateral-ask',
  '  name: dsh-plugin-lateral-ask'
) -join "`n"

$text = ''
if (Test-Path $cordisPath) { $text = Get-Content $cordisPath -Raw }
if ($text -eq $null) { $text = '' }

if ($text -match $marker) {
  Write-Host 'cordis.yml 已有条目，跳过'
} else {
  $trimmed = $text.Trim()
  if ($trimmed -eq '' -or $trimmed -eq '[]') {
    Set-Content -Path $cordisPath -Value ($entry + "`n") -Encoding utf8
  } else {
    $updated = $text.TrimEnd() + "`n" + $entry + "`n"
    Set-Content -Path $cordisPath -Value $updated -Encoding utf8
  }
  Write-Host 'cordis.yml 已登记 lateral-ask'
}

Write-Host "安装完成：$dest"
Get-ChildItem $dest -Recurse -File | ForEach-Object { "  " + $_.FullName.Substring($dest.Length + 1) }
Write-Host '--- cordis.yml ---'
Get-Content $cordisPath
