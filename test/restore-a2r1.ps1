$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop

$script:Pass = 0
$script:Fail = 0
$script:Skip = 0

function Check([string]$Label, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) {
    $script:Pass += 1
    Write-Host ("PASS  {0}" -f $Label)
  } else {
    $script:Fail += 1
    Write-Host ("FAIL  {0} :: {1}" -f $Label, $Detail) -ForegroundColor Red
  }
}

function Skip([string]$Label) {
  $script:Skip += 1
  Write-Host ("SKIP  {0}" -f $Label) -ForegroundColor Yellow
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceScript = Join-Path $repoRoot 'restore\restore.ps1'
if (-not (Test-Path -LiteralPath $sourceScript)) {
  Write-Host "FAIL  missing restore script: $sourceScript" -ForegroundColor Red
  exit 1
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-restore-a2r1-' + [guid]::NewGuid().ToString('N'))
$originalDshHome = $env:DSH_HOME
$dshHome = Join-Path $root 'home'
$backup = Join-Path $root 'backup'
$points = Join-Path $backup 'points'
$outside = Join-Path $root 'outside'
$sentinel = Join-Path $outside 'sentinel.txt'
$backupScript = Join-Path $backup 'restore.ps1'

function New-Point([string]$Name) {
  $dir = Join-Path $points $Name
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

function New-Part([string]$Id, [string]$Target, [string]$Kind = 'dir') {
  return [pscustomobject]@{
    id = $Id
    label = $Id
    kind = $Kind
    target = $Target
    missing = $false
    files = 0
    bytes = 0
  }
}

function Write-Manifest([string]$PointDir, [string]$Id, $Parts) {
  $manifest = [ordered]@{
    format = 'dsh-desktop-restore-point'
    version = 1
    id = $Id
    createdAt = (Get-Date).ToString('o')
    createdAtLocal = '2026-11-26 17:00:00'
    note = 'A2-R1 test'
    noteKind = ''
    noteParam = ''
    includesCredentials = $false
    totalBytes = 0
    fileCount = 0
    parts = @($Parts)
  }
  $json = $manifest | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText((Join-Path $PointDir 'manifest.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-RestoreChild([string]$PointPath) {
  $log = Join-Path $root ('run-' + [guid]::NewGuid().ToString('N') + '.log')
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & "$PSHOME\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $backupScript -Point $PointPath -Yes -Force *> $log
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  $output = ''
  if (Test-Path -LiteralPath $log) { $output = Get-Content -LiteralPath $log -Raw }
  return [pscustomobject]@{ Code = $code; Output = $output }
}

function New-Junction([string]$Link, [string]$Target) {
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  cmd /c mklink /J "$Link" "$Target" *> $null
  return ($LASTEXITCODE -eq 0)
}

function Remove-TestPath([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -ne $item -and (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
    cmd /c rmdir "$Path" 2>$null | Out-Null
  } else {
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function New-ZipWithEntries([string]$ZipPath, $Entries) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
  $stream = [System.IO.File]::Open($ZipPath, [System.IO.FileMode]::Create)
  $archive = New-Object System.IO.Compression.ZipArchive -ArgumentList $stream, ([System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($item in $Entries) {
      $entry = $archive.CreateEntry([string]$item.Name)
      $writer = New-Object System.IO.StreamWriter -ArgumentList $entry.Open(), (New-Object System.Text.UTF8Encoding($false))
      try { $writer.Write([string]$item.Content) } finally { $writer.Dispose() }
    }
  } finally {
    $archive.Dispose()
    $stream.Dispose()
  }
}

try {
  New-Item -ItemType Directory -Force -Path $root, $dshHome, $backup, $points, $outside | Out-Null
  Copy-Item -LiteralPath $sourceScript -Destination $backupScript -Force
  Set-Content -LiteralPath $sentinel -Value 'sentinel' -Encoding Ascii
  $env:DSH_HOME = $dshHome

  # 1. Normal restore regression.
  New-Item -ItemType Directory -Force -Path (Join-Path $dshHome 'profiles\desktop') | Out-Null
  Set-Content -LiteralPath (Join-Path $dshHome 'profiles\desktop\cordis.patch.yml') -Value 'current' -Encoding Ascii
  $normalPoint = New-Point '20261126-170000'
  New-Item -ItemType Directory -Force -Path (Join-Path $normalPoint 'profile') | Out-Null
  Set-Content -LiteralPath (Join-Path $normalPoint 'profile\cordis.patch.yml') -Value 'from-point' -Encoding Ascii
  Write-Manifest $normalPoint '20261126-170000' @((New-Part 'profile' 'profiles/desktop' 'dir'))
  $normalRun = Invoke-RestoreChild $normalPoint
  Check 'normal restore exits 0' ($normalRun.Code -eq 0) $normalRun.Output
  Check 'normal restore writes target' ((Get-Content -LiteralPath (Join-Path $dshHome 'profiles\desktop\cordis.patch.yml') -Raw).Trim() -eq 'from-point')

  # 2. Restore target leaf is a junction to outside.
  Remove-TestPath (Join-Path $dshHome 'profiles\desktop')
  $targetJunction = Join-Path $outside 'targetJunction'
  New-Item -ItemType Directory -Force -Path $targetJunction | Out-Null
  Set-Content -LiteralPath (Join-Path $targetJunction 'keep.txt') -Value 'keep' -Encoding Ascii
  $madeTarget = New-Junction (Join-Path $dshHome 'profiles\desktop') $targetJunction
  Check 'target junction created' $madeTarget 'mklink /J failed'
  $badPoint = New-Point '20261126-170001'
  New-Item -ItemType Directory -Force -Path (Join-Path $badPoint 'profile') | Out-Null
  Set-Content -LiteralPath (Join-Path $badPoint 'profile\cordis.patch.yml') -Value 'evil' -Encoding Ascii
  Write-Manifest $badPoint '20261126-170001' @((New-Part 'profile' 'profiles/desktop' 'dir'))
  $targetRun = Invoke-RestoreChild $badPoint
  Check 'restore target junction rejected' ($targetRun.Code -ne 0) $targetRun.Output
  Check 'target junction keeps outside content' ((Get-Content -LiteralPath (Join-Path $targetJunction 'keep.txt') -Raw).Trim() -eq 'keep')
  Check 'target junction does not receive restored file' (-not (Test-Path -LiteralPath (Join-Path $targetJunction 'cordis.patch.yml')))
  Remove-TestPath (Join-Path $dshHome 'profiles\desktop')
  New-Item -ItemType Directory -Force -Path (Join-Path $dshHome 'profiles\desktop') | Out-Null
  Set-Content -LiteralPath (Join-Path $dshHome 'profiles\desktop\cordis.patch.yml') -Value 'current' -Encoding Ascii

  # 3. .dsh-backup (rollback parent) is a junction to outside.
  Remove-TestPath (Join-Path $dshHome '.dsh-backup')
  $rollbackJunction = Join-Path $outside 'rollbackJunction'
  New-Item -ItemType Directory -Force -Path $rollbackJunction | Out-Null
  Set-Content -LiteralPath (Join-Path $rollbackJunction 'keep.txt') -Value 'keep' -Encoding Ascii
  $madeRollback = New-Junction (Join-Path $dshHome '.dsh-backup') $rollbackJunction
  Check '.dsh-backup junction created' $madeRollback 'mklink /J failed'
  $rbPoint = New-Point '20261126-170002'
  New-Item -ItemType Directory -Force -Path (Join-Path $rbPoint 'profile') | Out-Null
  Set-Content -LiteralPath (Join-Path $rbPoint 'profile\cordis.patch.yml') -Value 'evil' -Encoding Ascii
  Write-Manifest $rbPoint '20261126-170002' @((New-Part 'profile' 'profiles/desktop' 'dir'))
  $rbRun = Invoke-RestoreChild $rbPoint
  Check '.dsh-backup junction rejected' ($rbRun.Code -ne 0) $rbRun.Output
  Check '.dsh-backup junction keeps outside content' ((Get-Content -LiteralPath (Join-Path $rollbackJunction 'keep.txt') -Raw).Trim() -eq 'keep')
  $rollbackDirs = Get-ChildItem -LiteralPath $rollbackJunction -Directory -Filter 'replaced-*' -ErrorAction SilentlyContinue
  Check '.dsh-backup junction gets no rollback dir' ($null -eq $rollbackDirs -or $rollbackDirs.Count -eq 0)
  Remove-TestPath (Join-Path $dshHome '.dsh-backup')

  # 4. Backup source subdirectory is a junction to outside.
  $sourceJunction = Join-Path $outside 'sourceJunction'
  New-Item -ItemType Directory -Force -Path $sourceJunction | Out-Null
  Set-Content -LiteralPath (Join-Path $sourceJunction 'keep.txt') -Value 'keep' -Encoding Ascii
  $srcPoint = New-Point '20261126-170003'
  New-Item -ItemType Directory -Force -Path (Join-Path $srcPoint 'profile') | Out-Null
  Set-Content -LiteralPath (Join-Path $srcPoint 'profile\cordis.patch.yml') -Value 'evil' -Encoding Ascii
  $madeSource = New-Junction (Join-Path $srcPoint 'profile\leak') $sourceJunction
  Check 'source junction created' $madeSource 'mklink /J failed'
  Write-Manifest $srcPoint '20261126-170003' @((New-Part 'profile' 'profiles/desktop' 'dir'))
  $srcRun = Invoke-RestoreChild $srcPoint
  Check 'source subdir junction rejected' ($srcRun.Code -ne 0) $srcRun.Output
  Check 'source junction keeps outside content' ((Get-Content -LiteralPath (Join-Path $sourceJunction 'keep.txt') -Raw).Trim() -eq 'keep')
  Check 'source junction content not leaked into target' (-not (Test-Path -LiteralPath (Join-Path $dshHome 'profiles\desktop\leak\keep.txt')))

  # 5. Existing target subdirectory is a junction to outside.
  $innerJunction = Join-Path $outside 'innerJunction'
  New-Item -ItemType Directory -Force -Path $innerJunction | Out-Null
  Set-Content -LiteralPath (Join-Path $innerJunction 'keep.txt') -Value 'keep' -Encoding Ascii
  $madeInner = New-Junction (Join-Path $dshHome 'profiles\desktop\sub') $innerJunction
  Check 'inner target junction created' $madeInner 'mklink /J failed'
  $innerPoint = New-Point '20261126-170004'
  New-Item -ItemType Directory -Force -Path (Join-Path $innerPoint 'profile\sub') | Out-Null
  Set-Content -LiteralPath (Join-Path $innerPoint 'profile\sub\cordis.patch.yml') -Value 'evil' -Encoding Ascii
  Write-Manifest $innerPoint '20261126-170004' @((New-Part 'profile' 'profiles/desktop' 'dir'))
  $innerRun = Invoke-RestoreChild $innerPoint
  Check 'inner target junction rejected' ($innerRun.Code -ne 0) $innerRun.Output
  Check 'inner target junction keeps outside content' ((Get-Content -LiteralPath (Join-Path $innerJunction 'keep.txt') -Raw).Trim() -eq 'keep')
  Remove-TestPath (Join-Path $dshHome 'profiles\desktop\sub')

  # 6. DSH_HOME itself is a junction.
  $realHome = Join-Path $root 'realhome'
  $dshHomeLink = Join-Path $root 'homelink'
  New-Item -ItemType Directory -Force -Path $realHome | Out-Null
  Set-Content -LiteralPath (Join-Path $realHome 'keep.txt') -Value 'keep' -Encoding Ascii
  $madeHomeLink = New-Junction $dshHomeLink $realHome
  Check 'DSH_HOME junction created' $madeHomeLink 'mklink /J failed'
  $env:DSH_HOME = $dshHomeLink
  $dshHomeLinkPoint = New-Point '20261126-170005'
  New-Item -ItemType Directory -Force -Path (Join-Path $dshHomeLinkPoint 'profile') | Out-Null
  Set-Content -LiteralPath (Join-Path $dshHomeLinkPoint 'profile\cordis.patch.yml') -Value 'evil' -Encoding Ascii
  Write-Manifest $dshHomeLinkPoint '20261126-170005' @((New-Part 'profile' 'profiles/desktop' 'dir'))
  $dshHomeLinkRun = Invoke-RestoreChild $dshHomeLinkPoint
  Check 'DSH_HOME junction rejected' ($dshHomeLinkRun.Code -ne 0) $dshHomeLinkRun.Output
  Check 'DSH_HOME junction target untouched' ((Get-Content -LiteralPath (Join-Path $realHome 'keep.txt') -Raw).Trim() -eq 'keep')
  $env:DSH_HOME = $dshHome

  # 7. Symlink supplement (optional, may be blocked without developer mode).
  Remove-TestPath (Join-Path $dshHome 'profiles\desktop')
  $symTarget = Join-Path $outside 'symTarget'
  New-Item -ItemType Directory -Force -Path $symTarget | Out-Null
  Set-Content -LiteralPath (Join-Path $symTarget 'keep.txt') -Value 'keep' -Encoding Ascii
  $symMade = $false
  try {
    New-Item -ItemType SymbolicLink -Path (Join-Path $dshHome 'profiles\desktop') -Target $symTarget -ErrorAction Stop | Out-Null
    $symMade = $true
  } catch {
    $symMade = $false
  }
  if ($symMade) {
    $symPoint = New-Point '20261126-170006'
    New-Item -ItemType Directory -Force -Path (Join-Path $symPoint 'profile') | Out-Null
    Set-Content -LiteralPath (Join-Path $symPoint 'profile\cordis.patch.yml') -Value 'evil' -Encoding Ascii
    Write-Manifest $symPoint '20261126-170006' @((New-Part 'profile' 'profiles/desktop' 'dir'))
    $symRun = Invoke-RestoreChild $symPoint
    Check 'symlink target rejected' ($symRun.Code -ne 0) $symRun.Output
    Check 'symlink target keeps outside content' ((Get-Content -LiteralPath (Join-Path $symTarget 'keep.txt') -Raw).Trim() -eq 'keep')
    Remove-TestPath (Join-Path $dshHome 'profiles\desktop')
  } else {
    Skip 'symlink test (symbolic links not permitted in this session)'
  }
  New-Item -ItemType Directory -Force -Path (Join-Path $dshHome 'profiles\desktop') | Out-Null
  Set-Content -LiteralPath (Join-Path $dshHome 'profiles\desktop\cordis.patch.yml') -Value 'current' -Encoding Ascii

  # 8. Normal ZIP restore still works with the new checks.
  $zipPoint = Join-Path $points 'zip-normal'
  New-Item -ItemType Directory -Force -Path (Join-Path $zipPoint 'profile') | Out-Null
  Set-Content -LiteralPath (Join-Path $zipPoint 'profile\cordis.patch.yml') -Value 'from-zip' -Encoding Ascii
  Write-Manifest $zipPoint 'zip-normal' @((New-Part 'profile' 'profiles/desktop' 'dir'))
  $normalZip = Join-Path $root 'normal.zip'
  New-ZipWithEntries $normalZip @(
    @{ Name = 'manifest.json'; Content = (Get-Content -LiteralPath (Join-Path $zipPoint 'manifest.json') -Raw) },
    @{ Name = 'profile/cordis.patch.yml'; Content = 'from-zip' }
  )
  $zipRun = Invoke-RestoreChild $normalZip
  Check 'normal ZIP restore exits 0' ($zipRun.Code -eq 0) $zipRun.Output
  Check 'normal ZIP restore writes target' ((Get-Content -LiteralPath (Join-Path $dshHome 'profiles\desktop\cordis.patch.yml') -Raw).Trim() -eq 'from-zip')

} finally {
  if ($null -eq $originalDshHome) {
    Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue
  } else {
    $env:DSH_HOME = $originalDshHome
  }
  cmd /c rmdir /s /q "$root" 2>$null | Out-Null
}

Write-Host ''
Write-Host ("A2-R1 checks: {0} PASS, {1} FAIL, {2} SKIP" -f $script:Pass, $script:Fail, $script:Skip)
if ($script:Fail -gt 0) { exit 1 }
exit 0
