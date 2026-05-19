param(
  [int]$Port = 9333,
  [switch]$InjectOnly
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$injector = Join-Path $scriptRoot "inject-rtl-via-cdp.mjs"

function Resolve-CodexExe {
  $processPath = Get-Process -Name "Codex" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "*\WindowsApps\OpenAI.Codex_*\app\Codex.exe" } |
    Select-Object -First 1 -ExpandProperty Path

  if ($processPath) {
    return $processPath
  }

  $packageRoots = @(
    Get-ChildItem -Directory -LiteralPath "C:\Program Files\WindowsApps" -Filter "OpenAI.Codex_*" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending
  )

  foreach ($packageRoot in $packageRoots) {
    $candidate = Join-Path $packageRoot.FullName "app\Codex.exe"
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "Could not locate Codex.exe."
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

  throw "Could not find node.exe."
}

if (-not (Test-Path -LiteralPath $injector)) {
  throw "Could not find injector script at $injector"
}

$codexExe = Resolve-CodexExe
$nodeExe = Resolve-NodeExe

if (-not $InjectOnly) {
  Write-Host "Closing Codex..."
  Get-Process -Name Codex,codex -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3

  Write-Host "Starting Codex with local DevTools port $Port..."
  Write-Host $codexExe
  Start-Process -FilePath "cmd.exe" -ArgumentList @(
    "/c",
    "start",
    '""',
    "`"$codexExe`"",
    "--remote-debugging-port=$Port"
  ) -WindowStyle Hidden
}

Write-Host "Injecting RTL runtime fix..."
Write-Host "DevTools endpoint: http://127.0.0.1:$Port"
Write-Host "Using Node:"
Write-Host $nodeExe
& $nodeExe $injector $Port 30000
if ($LASTEXITCODE -ne 0) {
  throw "RTL runtime injector failed. If Codex is already open, close it and run this launcher again. If port $Port is busy, run with another -Port value."
}

Write-Host ""
Write-Host "RTL runtime fix injected. Keep using this launcher when you want Codex with Arabic RTL fixed."
