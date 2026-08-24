@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0InstalarArranqueAutomaticoWhatsApp.ps1"
endlocal
