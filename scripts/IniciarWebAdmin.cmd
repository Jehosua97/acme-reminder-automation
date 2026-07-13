@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0web_server.js"
endlocal
