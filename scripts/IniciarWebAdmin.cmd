@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ^
  "$process = New-Object System.Diagnostics.ProcessStartInfo; $process.FileName = 'node.exe'; $process.Arguments = '\"%~dp0web_server.js\"'; $process.WorkingDirectory = '%~dp0..'; $process.UseShellExecute = $false; $process.CreateNoWindow = $true; [System.Diagnostics.Process]::Start($process) | Out-Null"
endlocal
