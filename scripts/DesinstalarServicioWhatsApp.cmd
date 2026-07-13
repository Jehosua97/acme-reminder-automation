@echo off
setlocal
cd /d "%~dp0"
call "%~dp0DetenerServicioWhatsApp.cmd"
schtasks /Delete /TN "RecordatoriosWhatsAppServicio" /F
echo.
echo Servicio desinstalado.
pause
endlocal
