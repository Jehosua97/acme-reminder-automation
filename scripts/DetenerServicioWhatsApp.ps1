$ErrorActionPreference = 'SilentlyContinue'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaRuntime = Join-Path $Proyecto 'runtime'
$RutaLock = Join-Path $RutaRuntime 'servicio_programados.lock'
$RutaSupervisorLock = Join-Path $RutaRuntime 'servicio_programados_supervisor.lock'
$RutaSesion = Join-Path $Proyecto '.wwebjs_auth'
$RutaPerfil = Join-Path $RutaSesion 'session-recordatorios-excel'
$RutaPerfilNormalizada = $RutaPerfil -replace '\\', '/'

function Remover-LocksPerfilWhatsApp {
    $locks = @('DevToolsActivePort', 'lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket')
    foreach ($lock in $locks) {
        $ruta = Join-Path $RutaPerfil $lock
        if (Test-Path -LiteralPath $ruta) {
            Remove-Item -LiteralPath $ruta -Force -ErrorAction SilentlyContinue
        }
    }
}

if (Test-Path -LiteralPath $RutaLock) {
    $contenido = Get-Content -LiteralPath $RutaLock
    $pidServicio = ($contenido | Select-String -Pattern 'pid=(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
    if ($pidServicio) {
        $pidInt = [int]$pidServicio
        taskkill.exe /PID $pidInt /T /F | Out-Null
    }
    Remove-Item -LiteralPath $RutaLock -Force
}

if (Test-Path -LiteralPath $RutaSupervisorLock) {
    $contenidoSupervisor = Get-Content -LiteralPath $RutaSupervisorLock
    $pidSupervisor = ($contenidoSupervisor | Select-String -Pattern 'pid=(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
    if ($pidSupervisor) {
        taskkill.exe /PID ([int]$pidSupervisor) /T /F | Out-Null
    }
    Remove-Item -LiteralPath $RutaSupervisorLock -Force
}

Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like '*enviar_programados.js*--service*' -or $_.CommandLine -like '*--service*enviar_programados.js*' } |
    ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }

Get-CimInstance Win32_Process |
    Where-Object {
        $_.ProcessId -ne $PID -and
        $_.Name -match '^powershell(\.exe)?$' -and
        [string]$_.CommandLine -like '*IniciarServicioWhatsApp.ps1*' -and
        [string]$_.CommandLine -notlike '*DetenerServicioWhatsApp.ps1*'
    } |
    ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }

Get-CimInstance Win32_Process |
    Where-Object {
        $cmd = [string]$_.CommandLine
        (
            $_.Name -match '^(chrome|msedge|chromium)\.exe$' -or
            $cmd -match 'chrome-win64\\chrome\.exe'
        ) -and (
            $cmd -like "*$RutaPerfil*" -or
            $cmd -like "*$RutaPerfilNormalizada*" -or
            $cmd -like '*session-recordatorios-excel*'
        )
    } |
    ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }

Remover-LocksPerfilWhatsApp

Write-Output 'Servicio de recordatorios detenido.'
