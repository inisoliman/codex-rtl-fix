param(
  [string]$InstalledAppPath = "",
  [string]$AsarPath = ""
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$patcher = Join-Path $scriptRoot "patch-codex-rtl.mjs"

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

function Resolve-NodeExe {
  $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($systemNode) {
    return $systemNode.Source
  }

  if ($InstalledAppPath -ne "") {
    $installedNode = Join-Path $InstalledAppPath "resources\node.exe"
    if (Test-Path -LiteralPath $installedNode) {
      return $installedNode
    }
  }

  throw "Could not find node.exe."
}

if ($AsarPath -eq "") {
  $InstalledAppPath = Resolve-CodexAppPath -RequestedPath $InstalledAppPath
  $AsarPath = Join-Path $InstalledAppPath "resources\app.asar"
}

if (-not (Test-Path -LiteralPath $AsarPath)) {
  throw "Could not find app.asar at $AsarPath"
}

if (-not (Test-Path -LiteralPath $patcher)) {
  throw "Could not find patcher at $patcher"
}

$nodeExe = Resolve-NodeExe
$verifyScript = @'
import fs from 'node:fs';

const asarPath = process.argv[2];
if (!asarPath) throw new Error('Missing app.asar path.');
const fd = fs.openSync(asarPath, 'r');
try {
  const prefix = Buffer.alloc(16);
  fs.readSync(fd, prefix, 0, 16, 0);
  const headerPickleSize = prefix.readUInt32LE(4);
  const jsonSize = prefix.readUInt32LE(12);
  const jsonBuffer = Buffer.alloc(jsonSize);
  fs.readSync(fd, jsonBuffer, 0, jsonSize, 16);
  const header = JSON.parse(jsonBuffer.toString('utf8'));
  const dataStart = 8 + headerPickleSize;

  function entry(filePath) {
    let current = header;
    for (const part of filePath.split('/')) current = current.files?.[part];
    if (!current || current.files) throw new Error(`Missing file in ASAR: ${filePath}`);
    return current;
  }

  function read(filePath) {
    const file = entry(filePath);
    const buffer = Buffer.alloc(file.size);
    fs.readSync(fd, buffer, 0, file.size, dataStart + Number(file.offset || 0));
    return buffer.toString('utf8');
  }

  const html = read('webview/index.html');
  const scripts = Array.from(html.matchAll(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["'][^>]*>/gi))
    .map((match) => match[1].replace(/^\.\//, 'webview/'));
  const mainScript = scripts.find((candidate) => candidate.startsWith('webview/assets/') && candidate.endsWith('.js'));
  if (!mainScript) throw new Error('Could not find webview module script.');

  const source = read(mainScript);
  if (!source.includes('codex-rtl-runtime-fix v3')) {
    throw new Error(`RTL marker not found in ${mainScript}`);
  }

  entry('package.json');
  console.log(`RTL patch verified in ${mainScript}`);
} finally {
  fs.closeSync(fd);
}
'@

$tempScript = Join-Path $env:TEMP ("verify-codex-rtl-" + [Guid]::NewGuid().ToString("N") + ".mjs")
try {
  Set-Content -LiteralPath $tempScript -Value $verifyScript -Encoding UTF8
  & $nodeExe $tempScript $AsarPath
  if ($LASTEXITCODE -ne 0) {
    throw "Verification script failed."
  }
} finally {
  Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
}
