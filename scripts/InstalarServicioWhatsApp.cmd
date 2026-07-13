@echo off
setlocal
cd /d "%~dp0"
schtasks /Create /TN "RecordatoriosWhatsAppServicio" /SC ONLOGON /TR "\"%~dp0IniciarServicioWhatsApp.cmd\"" /F
echo.
echo Servicio instalado. Se iniciara al iniciar sesion de Windows.
echo Para iniciarlo ahora, ejecuta IniciarServicioWhatsApp.cmd.
pause
endlocal
