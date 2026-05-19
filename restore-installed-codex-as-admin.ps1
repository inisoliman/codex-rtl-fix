param(
  [string]$BackupAsarPath = "",
  [string]$InstalledAppPath = "",
  [switch]$RepairAcl,
  [switch]$Elevated
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-CodexAppPath {
  param([string]$RequestedPath)

  if ($RequestedPath -ne "") {
    return (Resolve-Path -LiteralPath $RequestedPath).Path
  }

  $processPath = Get-Process -Name "Codex" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "*\WindowsApps\OpenAI.Codex_*\app\Codex.exe" } |
    Select-Object -First 1 -ExpandProperty Path

  if ($processPath) {
    return Split-Path -Parent $processPath
  }

  $packageRoot = Get-ChildItem -Directory -LiteralPath "C:\Program Files\WindowsApps" -Filter "OpenAI.Codex_*" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($packageRoot) {
    $candidate = Join-Path $packageRoot.FullName "app"
    if (Test-Path -LiteralPath (Join-Path $candidate "Codex.exe")) {
      return $candidate
    }
  }

  throw "Could not locate installed Codex."
}

function Invoke-Native {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

function Enable-AppAsarWriteAccess {
  param([string]$AsarPath)

  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  Invoke-Native -FilePath "takeown.exe" -Arguments @("/F", $AsarPath, "/A")
  Invoke-Native -FilePath "icacls.exe" -Arguments @($AsarPath, "/grant", "*S-1-5-32-544:F", "/grant", "${currentUser}:F")
}

function Copy-FileBytesInPlace {
  param(
    [string]$Source,
    [string]$Destination
  )

  $sourceStream = [System.IO.File]::Open($Source, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  try {
    $destStream = [System.IO.File]::Open($Destination, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      $sourceStream.CopyTo($destStream)
    } finally {
      $destStream.Dispose()
    }
  } finally {
    $sourceStream.Dispose()
  }
}

function Resolve-BackupAsarPath {
  param([string]$RequestedPath)

  if ($RequestedPath -ne "") {
    return (Resolve-Path -LiteralPath $RequestedPath).Path
  }

  $backupRoot = Join-Path $scriptRoot "installed-app-backups"
  if (-not (Test-Path -LiteralPath $backupRoot)) {
    throw "No backup folder was found at $backupRoot"
  }

  $latestBackup = Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object {
      $candidate = Join-Path $_.FullName "app.asar.before-installed-patch"
      if (Test-Path -LiteralPath $candidate) {
        Get-Item -LiteralPath $candidate
      }
    } |
    Select-Object -First 1

  if (-not $latestBackup) {
    throw "No app.asar.before-installed-patch backup was found under $backupRoot"
  }

  return $latestBackup.FullName
}

$BackupAsarPath = Resolve-BackupAsarPath -RequestedPath $BackupAsarPath

if (-not (Test-Path -LiteralPath $BackupAsarPath)) {
  throw "Backup ASAR was not found: $BackupAsarPath"
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  if (-not $Elevated) {
    $argumentList = @(
      "-NoExit",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "`"$PSCommandPath`"",
      "-BackupAsarPath",
      "`"$BackupAsarPath`"",
      "-Elevated"
    )

    if ($InstalledAppPath -ne "") {
      $argumentList += @("-InstalledAppPath", "`"$InstalledAppPath`"")
    }
    if ($RepairAcl) {
      $argumentList += "-RepairAcl"
    }

    Write-Host "Requesting Administrator permission..."
    Start-Process -FilePath "PowerShell.exe" -Verb RunAs -ArgumentList $argumentList
    exit 0
  }

  throw "Run this script from an elevated PowerShell window."
}

$InstalledAppPath = Resolve-CodexAppPath -RequestedPath $InstalledAppPath
$asarPath = Join-Path $InstalledAppPath "resources\app.asar"

Write-Host "Closing Codex..."
Get-Process -Name Codex,codex -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "Restoring:"
Write-Host $BackupAsarPath
Write-Host "to:"
Write-Host $asarPath

try {
  Copy-FileBytesInPlace -Source $BackupAsarPath -Destination $asarPath
} catch {
  if (-not $RepairAcl) {
    Write-Host "Windows blocked writing to app.asar. Re-run with -RepairAcl."
    throw
  }

  Enable-AppAsarWriteAccess -AsarPath $asarPath
  Copy-FileBytesInPlace -Source $BackupAsarPath -Destination $asarPath
  Invoke-Native -FilePath "icacls.exe" -Arguments @($asarPath, "/setowner", "NT SERVICE\TrustedInstaller")
}

Write-Host "Codex app.asar was restored from backup."
