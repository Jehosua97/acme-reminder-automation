@echo off
setlocal
cd /d "%~dp0"
schtasks /Delete /TN "RecordatoriosWhatsAppProgramados" /F
echo.
echo Tarea desinstalada.
pause
endlocal
