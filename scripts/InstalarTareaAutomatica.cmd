@echo off
setlocal
cd /d "%~dp0"
schtasks /Create /TN "RecordatoriosWhatsAppProgramados" /SC HOURLY /MO 3 /ST 00:00 /TR "\"%~dp0EnviarProgramadosAuto.cmd\"" /F
echo.
echo Tarea instalada. Se ejecutara cada 3 horas con el usuario actual.
pause
endlocal
