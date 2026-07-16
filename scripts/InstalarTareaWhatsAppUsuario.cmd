@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0InstalarTareaWhatsAppUsuario.ps1"
pause
