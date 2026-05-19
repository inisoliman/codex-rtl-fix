@echo off
setlocal
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-codex-with-rtl-injection.ps1"
