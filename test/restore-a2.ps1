$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop

$script:Pass = 0
$script:Fail = 0

function Check([string]$Label, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) {
    $script:Pass += 1
    Write-Host ("PASS  {0}" -f $Label)
  } else {
    $script:Fail += 1
    Write-Host ("FAIL  {0} :: {1}" -f $Label, $Detail) -ForegroundColor Red
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceScript = Join-Path $repoRoot 'restore\restore.ps1'
if (-not (Test-Path -LiteralPath $sourceScript)) {
  Write-Host "FAIL  missing restore script: $sourceScript" -ForegroundColor Red
  exit 1
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-restore-a2-' + [guid]::NewGuid().ToString('N'))
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
    createdAtLocal = '2026-11-26 16:00:00'
    note = 'A2 test'
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
  & "$PSHOME\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $backupScript -Point $PointPath -Yes -Force *> $log
  $code = $LASTEXITCODE
  $output = ''
  if (Test-Path -LiteralPath $log) { $output = Get-Content -LiteralPath $log -Raw }
  return [pscustomobject]@{ Code = $code; Output = $output }
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
  New-Item -ItemType Directory -Force -Path $dshHome, $backup, $points, $outside | Out-Null
  Copy-Item -LiteralPath $sourceScript -Destination $backupScript -Force
  Set-Content -LiteralPath $sentinel -Value 'sentinel' -Encoding Ascii
  $env:DSH_HOME = $dshHome

  # Normal relative restore and rollback copy.
  New-Item -ItemType Directory -Force -Path (Join-Path $dshHome 'profiles\desktop') | Out-Null
  Set-Content -LiteralPath (Join-Path $dshHome 'profiles\desktop\cordis.patch.yml') -Value 'current' -Encoding Ascii
  $normalPoint = New-Point '20261126-160000'
  New-Item -ItemType Directory -Force -Path (Join-Path $normalPoint 'profile') | Out-Null
  Set-Content -LiteralPath (Join-Path $normalPoint 'profile\cordis.patch.yml') -Value 'from-point' -Encoding Ascii
  Write-Manifest $normalPoint '20261126-160000' @((New-Part 'profile' 'profiles/desktop' 'dir'))

  $normalRun = Invoke-RestoreChild $normalPoint
  Check 'normal relative restore exits 0' ($normalRun.Code -eq 0) $normalRun.Output
  Check 'normal relative restore writes target' ((Get-Content -LiteralPath (Join-Path $dshHome 'profiles\desktop\cordis.patch.yml') -Raw).Trim() -eq 'from-point')
  $replaced = Get-ChildItem -LiteralPath (Join-Path $dshHome '.dsh-backup') -Directory -Filter 'replaced-*' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
  Check 'normal restore creates rollback copy' ($null -ne $replaced) 'no replaced-* directory'
  if ($null -ne $replaced) {
    $rollbackFile = Join-Path $replaced.FullName 'profile\cordis.patch.yml'
    Check 'rollback copy keeps previous content' ((Get-Content -LiteralPath $rollbackFile -Raw).Trim() -eq 'current')
  }

  # Old manifests may use backslashes in their relative target.
  $backslashPoint = New-Point '20261126-160001'
  New-Item -ItemType Directory -Force -Path (Join-Path $backslashPoint 'profile') | Out-Null
  Set-Content -LiteralPath (Join-Path $backslashPoint 'profile\cordis.patch.yml') -Value 'from-backslash' -Encoding Ascii
  Write-Manifest $backslashPoint '20261126-160001' @((New-Part 'profile' 'profiles\desktop' 'dir'))
  $backslashRun = Invoke-RestoreChild $backslashPoint
  Check 'normal backslash target exits 0' ($backslashRun.Code -eq 0) $backslashRun.Output
  Check 'normal backslash target writes target' ((Get-Content -LiteralPath (Join-Path $dshHome 'profiles\desktop\cordis.patch.yml') -Raw).Trim() -eq 'from-backslash')
  Set-Content -LiteralPath (Join-Path $dshHome 'profiles\desktop\cordis.patch.yml') -Value 'from-point' -Encoding Ascii

  # Invalid part.id values must be rejected before any write.
  $badIds = @('../outside', '..\outside', 'C:\outside', '\\server\share\outside', '/outside', '..', '.', '')
  $index = 0
  foreach ($badId in $badIds) {
    $index += 1
    $point = New-Point ("bad-id-$index")
    Write-Manifest $point ("bad-id-$index") @((New-Part $badId 'profiles/desktop' 'dir'))
    $run = Invoke-RestoreChild $point
    Check ("reject part.id {0}" -f $badId) ($run.Code -ne 0) $run.Output
    Check ("part.id {0} leaves outside sentinel" -f $badId) ((Get-Content -LiteralPath $sentinel -Raw).Trim() -eq 'sentinel')
  }
  Check 'invalid part.id leaves current profile unchanged' ((Get-Content -LiteralPath (Join-Path $dshHome 'profiles\desktop\cordis.patch.yml') -Raw).Trim() -eq 'from-point')

  # Invalid part.target values must be rejected before any write.
  $badTargets = @('../outside', '..\outside', 'C:\outside', '\\server\share\outside', '/outside', '..', '.', '', $dshHome, 'profiles/../../outside')
  $index = 0
  foreach ($badTarget in $badTargets) {
    $index += 1
    $point = New-Point ("bad-target-$index")
    New-Item -ItemType Directory -Force -Path (Join-Path $point 'profile') | Out-Null
    Set-Content -LiteralPath (Join-Path $point 'profile\cordis.patch.yml') -Value 'evil' -Encoding Ascii
    Write-Manifest $point ("bad-target-$index") @((New-Part 'profile' $badTarget 'dir'))
    $run = Invoke-RestoreChild $point
    Check ("reject part.target {0}" -f $badTarget) ($run.Code -ne 0) $run.Output
    Check ("part.target {0} leaves outside sentinel" -f $badTarget) ((Get-Content -LiteralPath $sentinel -Raw).Trim() -eq 'sentinel')
  }
  Check 'invalid part.target leaves current profile unchanged' ((Get-Content -LiteralPath (Join-Path $dshHome 'profiles\desktop\cordis.patch.yml') -Raw).Trim() -eq 'from-point')

  # Malicious ZIP entries must be rejected without extraction.
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
  $badZipEntries = @(
    @{ Name = '../outside/sentinel.txt'; Content = 'zip-evil' },
    @{ Name = 'C:\outside.txt'; Content = 'zip-evil' },
    @{ Name = '/outside.txt'; Content = 'zip-evil' },
    @{ Name = '\\server\share\outside.txt'; Content = 'zip-evil' },
    @{ Name = '..\outside\sentinel.txt'; Content = 'zip-evil' }
  )
  $index = 0
  foreach ($item in $badZipEntries) {
    $index += 1
    $zipPath = Join-Path $root ("bad-$index.zip")
    New-ZipWithEntries $zipPath @($item)
    $run = Invoke-RestoreChild $zipPath
    Check ("reject zip entry {0}" -f $item.Name) ($run.Code -ne 0) $run.Output
    Check ("zip entry {0} leaves outside sentinel" -f $item.Name) ((Get-Content -LiteralPath $sentinel -Raw).Trim() -eq 'sentinel')
  }

  # A normal ZIP must still restore through the validated extractor.
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
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("A2 checks: {0} PASS, {1} FAIL" -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { exit 1 }
exit 0
