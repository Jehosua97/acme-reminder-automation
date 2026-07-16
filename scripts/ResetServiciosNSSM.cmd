@echo off
setlocal
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de Administrador...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ResetServiciosNSSM.ps1" *>&1 | tee "%~dp0..\runtime\reset_servicios_nssm.log"
pause
