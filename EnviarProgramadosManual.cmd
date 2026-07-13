@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0automation\EnviarProgramadosManual.ps1"
endlocal
