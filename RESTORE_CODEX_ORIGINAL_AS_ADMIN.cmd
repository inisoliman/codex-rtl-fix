@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-installed-codex-as-admin.ps1" -RepairAcl %*
