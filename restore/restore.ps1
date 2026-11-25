<#
  DSH 桌面端 · 离线恢复程序

  用途：当 DSH 无法启动、打不开时，在 DSH 完全退出的状态下，把某个还原点
  覆盖回本机 DSH 数据目录（默认 %USERPROFILE%\.dsh）。

  用法：
    1. 双击同目录下的“恢复DSH.cmd”，按提示选择还原点。
    2. 或把还原点文件夹 / .zip 文件直接拖到“恢复DSH.cmd”上。
    3. 命令行：恢复DSH.cmd "D:\...\dsh-backups\points\20261123-221843"

  可选参数：
    -Point <文件夹|zip|还原点编号>   跳过交互直接指定还原点
    -Force                           即使检测到 DSH 进程也继续（确认已退出时使用）
    -Yes                             不再询问确认，也不在结束时暂停（供脚本调用）

  恢复前会把将被覆盖的文件复制到 <DSH_HOME>\.dsh-backup\replaced-<时间>\ 作为回滚副本。
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Point = '',
  [switch]$Force,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PointsDir = Join-Path $ScriptDir 'points'
if ($env:DSH_HOME -and $env:DSH_HOME.Trim() -ne '') {
  $DshHome = $env:DSH_HOME.Trim()
} else {
  $DshHome = Join-Path $env:USERPROFILE '.dsh'
}

$ScriptVersion = '1.0.4'
$LogDir = Join-Path $ScriptDir 'logs'
$LogFile = Join-Path $LogDir 'restore-offline.log'

# One line per step; never write credentials or file contents here.
function Write-RestoreLog([string]$level, [string]$message) {
  try {
    if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
    if (Test-Path -LiteralPath $LogFile) {
      if ((Get-Item -LiteralPath $LogFile).Length -gt 262144) {
        Remove-Item -LiteralPath ($LogFile + '.1') -Force -ErrorAction SilentlyContinue
        Move-Item -LiteralPath $LogFile -Destination ($LogFile + '.1') -Force
      }
    }
    $line = '{0} {1} {2}' -f (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz'), $level.ToUpperInvariant(), (($message -replace '\s+', ' ').Trim())
    [System.IO.File]::AppendAllText($LogFile, ($line + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    # 日志写不进去也不能中断恢复
  }
}

function Write-Head([string]$text) {
  Write-Host ''
  Write-Host "== $text ==" -ForegroundColor Cyan
}
function Write-Ok([string]$text) { Write-Host $text -ForegroundColor Green }
function Write-Note([string]$text) { Write-Host $text -ForegroundColor Yellow }
function Write-Bad([string]$text) { Write-Host $text -ForegroundColor Red }

function Format-Size([double]$bytes) {
  if ($bytes -lt 1024) { return ('{0} B' -f [int]$bytes) }
  $units = @('KB', 'MB', 'GB')
  $value = $bytes / 1024
  $index = 0
  while ($value -ge 1024 -and $index -lt 2) {
    $value = $value / 1024
    $index += 1
  }
  return ('{0:N1} {1}' -f $value, $units[$index])
}

function Get-RestorePoints {
  if (-not (Test-Path -LiteralPath $PointsDir)) { return @() }
  return @(Get-ChildItem -LiteralPath $PointsDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'manifest.json') } |
    Sort-Object Name -Descending)
}

function Read-Manifest([string]$folder) {
  $path = Join-Path $folder 'manifest.json'
  if (-not (Test-Path -LiteralPath $path)) { throw "该还原点缺少 manifest.json：$folder" }
  $manifest = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.format -ne 'dsh-desktop-restore-point') {
    throw "不是有效的 DSH 还原点（format=$($manifest.format)）：$folder"
  }
  return $manifest
}

function Get-NoteText($manifest) {
  if ($manifest.noteKind -eq 'auto-before-restore' -and $manifest.noteParam) {
    return ("自动快照：恢复 {0} 前" -f $manifest.noteParam)
  }
  return [string]$manifest.note
}

function Show-Points($points, $manifests) {
  Write-Head '可用还原点'
  for ($i = 0; $i -lt $points.Count; $i++) {
    $m = $manifests[$i]
    $label = '{0,2}. {1}  {2,10}  {3}' -f ($i + 1), $m.createdAtLocal, (Format-Size ([double]$m.totalBytes)), (Get-NoteText $m)
    Write-Host $label
  }
  Write-Host ''
  Write-Host ("备份目录: {0}" -f $ScriptDir)
}

function Expand-PointZip([string]$zipPath) {
  $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-restore-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  Expand-Archive -LiteralPath $zipPath -DestinationPath $temp -Force
  $found = Get-ChildItem -LiteralPath $temp -Recurse -Filter 'manifest.json' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $found) { throw "这个 zip 里没有还原点（缺少 manifest.json）：$zipPath" }
  return $found.Directory.FullName
}

function Resolve-PointFolder([string]$value) {
  $candidate = $value.Trim().Trim('"').Trim("'")
  if ($candidate -eq '') { throw '没有指定还原点' }
  if (Test-Path -LiteralPath $candidate) {
    $item = Get-Item -LiteralPath $candidate
    if ($item.PSIsContainer) {
      if (Test-Path -LiteralPath (Join-Path $item.FullName 'manifest.json')) { return $item.FullName }
      $child = Get-ChildItem -LiteralPath $item.FullName -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'manifest.json') } |
        Sort-Object Name -Descending | Select-Object -First 1
      if ($child) { return $child.FullName }
      throw "该文件夹不是还原点（缺少 manifest.json）：$candidate"
    }
    if ($item.Extension -ieq '.zip') { return Expand-PointZip $item.FullName }
    throw "请选择还原点文件夹或 .zip 文件：$candidate"
  }
  $byId = Join-Path $PointsDir $candidate
  if (Test-Path -LiteralPath (Join-Path $byId 'manifest.json')) { return $byId }
  throw "找不到还原点：$candidate"
}

function Get-DshProcesses {
  return @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(DeepSeek|Harness)' })
}

# Copy every entry of $Source into $Target, recursing through subdirectories.
# Unlike replacing a directory, this keeps files the source does not contain —
# most importantly the profile's node_modules, which no backup includes.
function Merge-Tree([string]$Source, [string]$Target, [string[]]$ExcludeTop = @()) {
  if (-not (Test-Path -LiteralPath $Target)) { New-Item -ItemType Directory -Force -Path $Target | Out-Null }
  foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
    if ($ExcludeTop -contains $item.Name) { continue }
    $destination = Join-Path $Target $item.Name
    if ($item.PSIsContainer) {
      Merge-Tree -Source $item.FullName -Target $destination
    } else {
      Copy-Item -LiteralPath $item.FullName -Destination $destination -Force
    }
  }
}

function Invoke-Restore([string]$folder) {
  $manifest = Read-Manifest $folder
  Write-Head '恢复预览'
  Write-Host ("还原点: {0}   {1}" -f $manifest.createdAtLocal, (Get-NoteText $manifest))
  Write-Host ("来源:   {0}" -f $folder)
  Write-Host ("目标:   {0}" -f $DshHome)
  Write-Host ("内容:   {0} 个文件，{1}" -f $manifest.fileCount, (Format-Size ([double]$manifest.totalBytes)))
  foreach ($part in @($manifest.parts)) {
    if ($part.missing -eq $true) {
      Write-Note ("  - 跳过 {0}（备份时不存在）" -f $part.label)
    } else {
      Write-Host ("  - {0} → {1}" -f $part.label, $part.target)
    }
  }
  Write-Host ''
  Write-Note '恢复会覆盖还原点中存在的文件；node_modules 以及还原点里没有的文件会原样保留。'
  if (-not $Yes) {
    $answer = Read-Host '确认覆盖恢复？输入 y 继续，输入其它内容取消'
    if ($answer -notmatch '^(y|yes|Y|YES|是)$') {
      Write-Note '已取消，没有修改任何文件。'
      return $false
    }
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $quarantine = Join-Path $DshHome (".dsh-backup\replaced-" + $stamp)
  New-Item -ItemType Directory -Force -Path $quarantine | Out-Null
  $results = @()
  foreach ($part in @($manifest.parts)) {
    if ($part.missing -eq $true) { continue }
    $source = Join-Path $folder $part.id
    if (-not (Test-Path -LiteralPath $source)) {
      $results += [pscustomobject]@{ id = $part.id; label = $part.label; ok = $false; message = '备份中缺少该部分' }
      continue
    }
    $target = Join-Path $DshHome ($part.target -replace '/', '\')
    $parent = Split-Path -Parent $target
    try {
      if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
      # Keep a copy of what the restore is about to overwrite. The profile copy
      # skips node_modules: it is huge, machine-specific, and never restored.
      if (Test-Path -LiteralPath $target) {
        $backupCopy = Join-Path $quarantine $part.id
        if ($part.kind -eq 'file') {
          Copy-Item -LiteralPath $target -Destination $backupCopy -Force
        } elseif ($part.id -eq 'profile') {
          Merge-Tree -Source $target -Target $backupCopy -ExcludeTop @('node_modules')
        } else {
          Merge-Tree -Source $target -Target $backupCopy
        }
      }
      # Merge instead of replacing the directory: a moved-away profile would take
      # node_modules with it, and every installed plugin would disappear.
      if ($part.kind -eq 'file') {
        Copy-Item -LiteralPath $source -Destination $target -Force
      } else {
        Merge-Tree -Source $source -Target $target
      }
      $results += [pscustomobject]@{ id = $part.id; label = $part.label; ok = $true; message = '' }
      Write-Ok ("  已恢复 {0}" -f $part.label)
      Write-RestoreLog 'INFO' ("part ok id={0}" -f $part.id)
    } catch {
      $results += [pscustomobject]@{ id = $part.id; label = $part.label; ok = $false; message = $_.Exception.Message }
      Write-Bad ("  恢复失败 {0}：{1}" -f $part.label, $_.Exception.Message)
      Write-RestoreLog 'ERROR' ("part failed id={0} error={1}" -f $part.id, $_.Exception.Message)
    }
  }

  $ok = -not ($results | Where-Object { -not $_.ok })
  $receiptDir = Join-Path $DshHome '.dsh-backup'
  New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
  $receipt = [ordered]@{
    restoredAt      = (Get-Date).ToString('o')
    source          = 'offline restore program'
    point           = [ordered]@{ id = $manifest.id; createdAt = $manifest.createdAt; note = $manifest.note }
    replacedDir     = $quarantine
    ok              = [bool]$ok
    results         = $results
    requiresRestart = $false
  }
  try {
    $receiptJson = $receipt | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText((Join-Path $receiptDir 'last-restore.json'), ($receiptJson + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    Write-Note ("恢复回执写入失败：{0}" -f $_.Exception.Message)
    Write-RestoreLog 'WARN' ("receipt write failed: {0}" -f $_.Exception.Message)
  }

  Write-RestoreLog ($(if ($ok) { 'INFO' } else { 'WARN' })) ("restore done ok={0} parts={1} replacedDir={2}" -f $ok, $results.Count, $quarantine)
  Write-Head '恢复结果'
  if ($ok) {
    Write-Ok '全部部分已恢复。请重新打开 DSH 桌面端。'
  } else {
    Write-Bad '部分内容没有恢复成功，详见上面的提示。'
    Write-Host ("恢复前的数据副本: {0}" -f $quarantine)
  }
  return $ok
}

# ---- 主流程 ----
Write-Host 'DSH 桌面端 · 离线恢复程序' -ForegroundColor Cyan
Write-Host ("DSH 数据目录: {0}" -f $DshHome)
Write-Host ("备份目录:     {0}" -f $ScriptDir)
Write-RestoreLog 'INFO' ("offline-restore start version={0} dshHome={1}" -f $ScriptVersion, $DshHome)

$running = Get-DshProcesses
if ($running.Count -gt 0 -and -not $Force) {
  Write-Host ''
  Write-Bad '检测到 DSH 仍在运行，无法安全覆盖数据：'
  foreach ($process in $running) { Write-Host ("  - {0} (PID {1})" -f $process.ProcessName, $process.Id) }
  Write-RestoreLog 'WARN' ("dsh still running pids={0}" -f (($running | ForEach-Object { $_.Id }) -join ','))
  Write-Note '请先完全退出 DSH：任务栏图标右键 → 退出，或使用任务管理器结束 DeepSeek Harness。'
  Write-Note '退出后重新双击“恢复DSH.cmd”。'
  Write-RestoreLog 'WARN' 'offline-restore exit code=2 (dsh running)'
  if (-not $Yes) { Read-Host '按回车键关闭窗口' | Out-Null }
  exit 2
}

Write-RestoreLog 'INFO' 'dsh process check passed'
$points = Get-RestorePoints
Write-RestoreLog 'INFO' ("points found={0}" -f $points.Count)
$manifests = @()
# `$point` would alias the case-insensitive `$Point` parameter and silently
# replace an empty selection with the last point in the list.
foreach ($candidate in $points) {
  try { $manifests += (Read-Manifest $candidate.FullName) } catch { $manifests += $null }
}

if ($Point -ne '') {
  try {
    $folder = Resolve-PointFolder $Point
  } catch {
    Write-Bad $_.Exception.Message
    Write-RestoreLog 'ERROR' ("resolve point failed: {0}" -f $_.Exception.Message)
    if (-not $Yes) { Read-Host '按回车键关闭窗口' | Out-Null }
    exit 4
  }
} else {
  if ($points.Count -eq 0) {
    Write-Host ''
    Write-Bad ("没有找到任何还原点：{0}" -f $PointsDir)
    Write-Note '请先正常打开 DSH，在“插件 → 备份与还原点”里创建备份。'
    Write-RestoreLog 'WARN' 'offline-restore exit code=3 (no restore points)'
    if (-not $Yes) { Read-Host '按回车键关闭窗口' | Out-Null }
    exit 3
  }
  Show-Points $points $manifests
  Write-Host ''
  $choice = Read-Host '输入还原点序号（1、2…），或直接粘贴还原点文件夹 / .zip 路径；输入 q 退出'
  if ($choice -match '^(q|Q)$') { Write-RestoreLog 'INFO' 'offline-restore cancelled at menu'; exit 0 }
  if ($choice -match '^\d+$') {
    $index = [int]$choice
    if ($index -lt 1 -or $index -gt $points.Count) {
      Write-Bad ("序号超出范围：{0}" -f $choice)
      Write-RestoreLog 'WARN' ("offline-restore exit code=4 (bad index={0})" -f $choice)
      if (-not $Yes) { Read-Host '按回车键关闭窗口' | Out-Null }
      exit 4
    }
    $folder = $points[$index - 1].FullName
  } else {
    try { $folder = Resolve-PointFolder $choice } catch {
      Write-Bad $_.Exception.Message
      if (-not $Yes) { Read-Host '按回车键关闭窗口' | Out-Null }
      exit 4
    }
  }
}

Write-RestoreLog 'INFO' ("restore selected point={0}" -f (Split-Path -Leaf $folder))
$code = 1
try {
  if (Invoke-Restore $folder) { $code = 0 } else { $code = 5 }
} catch {
  Write-Bad ("恢复出错：{0}" -f $_.Exception.Message)
  Write-RestoreLog 'ERROR' ("restore error={0}" -f $_.Exception.Message)
  $code = 1
}
Write-RestoreLog 'INFO' ("offline-restore exit code={0}" -f $code)

if (-not $Yes) { Read-Host '按回车键关闭窗口' | Out-Null }
exit $code
