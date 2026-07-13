@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0automation\EnviarProgramadosAuto.ps1"
endlocal
