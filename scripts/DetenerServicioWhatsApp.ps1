$ErrorActionPreference = 'SilentlyContinue'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaRuntime = Join-Path $Proyecto 'runtime'
$RutaLock = Join-Path $RutaRuntime 'servicio_programados.lock'

if (Test-Path -LiteralPath $RutaLock) {
    $contenido = Get-Content -LiteralPath $RutaLock
    $pidServicio = ($contenido | Select-String -Pattern 'pid=(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
    if ($pidServicio) {
        $pidInt = [int]$pidServicio
        taskkill.exe /PID $pidInt /T /F | Out-Null
    }
    Remove-Item -LiteralPath $RutaLock -Force
}

Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like '*enviar_programados.js*--service*' -or $_.CommandLine -like '*--service*enviar_programados.js*' } |
    ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }

Write-Output 'Servicio de recordatorios detenido.'
