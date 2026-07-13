@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0DetenerServicioWhatsApp.ps1"
pause
endlocal
