$ErrorActionPreference = 'SilentlyContinue'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaRuntime = Join-Path $Proyecto 'runtime'
$RutaLock = Join-Path $RutaRuntime 'servicio_programados.lock'
$RutaSesion = Join-Path $Proyecto '.wwebjs_auth'
$RutaPerfil = Join-Path $RutaSesion 'session-recordatorios-excel'
$RutaSesionNormalizada = $RutaSesion -replace '\\', '/'

function Remover-LocksPerfilWhatsApp {
    $locks = @('DevToolsActivePort', 'lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket')
    foreach ($lock in $locks) {
        $ruta = Join-Path $RutaPerfil $lock
        if (Test-Path -LiteralPath $ruta) {
            Remove-Item -LiteralPath $ruta -Force -ErrorAction SilentlyContinue
        }
    }
}

function Detener-ChromeHuerfano {
    $procesos = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    $idsVivos = @{}
    foreach ($p in $procesos) { $idsVivos[[int]$p.ProcessId] = $true }
    $porId = @{}
    foreach ($p in $procesos) { $porId[[int]$p.ProcessId] = $p }

    $procesos |
        Where-Object { $_.Name -eq 'chrome.exe' } |
        ForEach-Object {
            $padre = $porId[[int]$_.ParentProcessId]
            if ($padre -and $padre.Name -match '^(node|powershell)\.exe$') {
                taskkill.exe /PID $padre.ProcessId /T /F | Out-Null
            }
        }

    $procesos |
        Where-Object {
            $_.Name -eq 'chrome.exe' -and
            -not $idsVivos.ContainsKey([int]$_.ParentProcessId)
        } |
        ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }
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
            $cmd -like "*$RutaSesion*" -or
            $cmd -like "*$RutaSesionNormalizada*" -or
            $cmd -like '*session-recordatorios-excel*'
        )
    } |
    ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }

Detener-ChromeHuerfano
Remover-LocksPerfilWhatsApp

Write-Output 'Servicio de recordatorios detenido.'
