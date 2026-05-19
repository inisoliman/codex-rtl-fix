@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-to-installed-codex-as-admin.ps1" -RepairAcl
