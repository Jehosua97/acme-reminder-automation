@echo off
setlocal
schtasks /Delete /TN "RecordatoriosWhatsAppProgramados" /F
echo.
echo Tarea desinstalada.
pause
endlocal
