param(
  [string]$InstalledAppPath = "",
  [switch]$RepairAcl,
  [switch]$Elevated
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $scriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("apply-installed-rtl-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")

function Resolve-CodexAppPath {
  param([string]$RequestedPath)

  if ($RequestedPath -ne "") {
    $resolved = Resolve-Path -LiteralPath $RequestedPath
    return $resolved.Path
  }

  $processPath = Get-Process -Name "Codex" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "*\WindowsApps\OpenAI.Codex_*\app\Codex.exe" } |
    Select-Object -First 1 -ExpandProperty Path

  if ($processPath) {
    return Split-Path -Parent $processPath
  }

  $packageRoots = @(
    Get-ChildItem -Directory -LiteralPath "C:\Program Files\WindowsApps" -Filter "OpenAI.Codex_*" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending
  )

  foreach ($packageRoot in $packageRoots) {
    $candidate = Join-Path $packageRoot.FullName "app"
    if (Test-Path -LiteralPath (Join-Path $candidate "Codex.exe")) {
      return $candidate
    }
  }

  throw "Could not locate installed Codex. Start Codex once, then run this script again."
}

function Stop-CodexProcesses {
  for ($attempt = 1; $attempt -le 12; $attempt += 1) {
    $processes = @(Get-Process -Name Codex,codex -ErrorAction SilentlyContinue)
    if ($processes.Count -eq 0) {
      return
    }

    if ($attempt -eq 1) {
      Write-Host "Closing running Codex processes..."
    }

    foreach ($process in $processes) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }

    Start-Sleep -Seconds 2
  }

  $remaining = @(Get-Process -Name Codex,codex -ErrorAction SilentlyContinue)
  if ($remaining.Count -gt 0) {
    throw "Could not close all Codex processes. Close Codex manually from Task Manager, then run again."
  }
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

function Resolve-NodeExe {
  $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($systemNode) {
    return $systemNode.Source
  }

  $sideNode = Join-Path $scriptRoot "CodexPatched\app\resources\node.exe"
  if (Test-Path -LiteralPath $sideNode) {
    return $sideNode
  }

  $installedNode = Join-Path $InstalledAppPath "resources\node.exe"
  if (Test-Path -LiteralPath $installedNode) {
    return $installedNode
  }

  throw "Could not find node.exe. Install Node.js or rerun install-rtl-fix.ps1 to create the side copy."
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

function Enable-AppAsarWriteAccess {
  param(
    [string]$AsarPath
  )

  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  Invoke-Native -FilePath "takeown.exe" -Arguments @("/F", $AsarPath, "/A")
  Invoke-Native -FilePath "icacls.exe" -Arguments @($AsarPath, "/grant", "*S-1-5-32-544:F", "/grant", "${currentUser}:F")
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
      "-RepairAcl",
      "-Elevated"
    )

    if ($InstalledAppPath -ne "") {
      $argumentList += @("-InstalledAppPath", "`"$InstalledAppPath`"")
    }

    Write-Host "Requesting Administrator permission..."
    Start-Process -FilePath "PowerShell.exe" -Verb RunAs -ArgumentList $argumentList
    exit 0
  }

  throw "Run this script from an elevated PowerShell window."
}

Start-Transcript -LiteralPath $logPath -Force | Out-Null

try {
  $InstalledAppPath = Resolve-CodexAppPath -RequestedPath $InstalledAppPath
  $asarPath = Join-Path $InstalledAppPath "resources\app.asar"

  if (-not (Test-Path -LiteralPath $asarPath)) {
    throw "Could not find installed app.asar at $asarPath"
  }

  Stop-CodexProcesses

  $backupDir = Join-Path $scriptRoot ("installed-app-backups\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $scriptRoot "work") | Out-Null

  $backupAsar = Join-Path $backupDir "app.asar.before-installed-patch"
  $workAsar = Join-Path $scriptRoot "work\app.asar.patched"

  Write-Host "Installed Codex app:"
  Write-Host $InstalledAppPath
  Write-Host ""
  Write-Host "Creating backup..."
  Copy-Item -LiteralPath $asarPath -Destination $backupAsar -Force
  Copy-Item -LiteralPath $asarPath -Destination $workAsar -Force

  $nodeExe = Resolve-NodeExe
  $patcher = Join-Path $scriptRoot "patch-codex-rtl.mjs"

  Write-Host "Patching temporary copy..."
  Write-Host "Using Node:"
  Write-Host $nodeExe
  & $nodeExe $patcher --asar $workAsar
  if ($LASTEXITCODE -ne 0) {
    throw "RTL patcher failed."
  }

  Write-Host "Replacing installed app.asar..."
  try {
    Copy-FileBytesInPlace -Source $workAsar -Destination $asarPath
  } catch {
    if (-not $RepairAcl) {
      Write-Host ""
      Write-Host "Windows blocked writing to app.asar."
      Write-Host "Run again with -RepairAcl, or use APPLY_TO_INSTALLED_CODEX_AS_ADMIN.cmd."
      throw
    }

    Write-Host "Windows blocked writing to app.asar. Repairing ACL for this one file..."
    Enable-AppAsarWriteAccess -AsarPath $asarPath
    Copy-FileBytesInPlace -Source $workAsar -Destination $asarPath
    Invoke-Native -FilePath "icacls.exe" -Arguments @($asarPath, "/setowner", "NT SERVICE\TrustedInstaller")
  }

  Write-Host "Installed Codex app.asar was patched."
  Write-Host "Backup folder:"
  Write-Host $backupDir
  Write-Host ""
  Write-Host "Running verification..."
  & (Join-Path $scriptRoot "verify-installed-rtl-patch.ps1") -InstalledAppPath $InstalledAppPath
  if ($LASTEXITCODE -ne 0) {
    throw "Verification failed after patch."
  }

  Write-Host ""
  Write-Host "Now open Codex normally from the Start menu and test Arabic/English mixed text."
} finally {
  Write-Host ""
  Write-Host "Log file:"
  Write-Host $logPath
  Stop-Transcript | Out-Null
}
