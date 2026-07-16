$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Nssm = Join-Path $ProjectRoot 'tools\nssm\nssm-2.24\win64\nssm.exe'
$Runtime = Join-Path $ProjectRoot 'runtime'
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$WebService = 'ConfortPlace-Web'
$WhatsAppService = 'ConfortPlace-WhatsApp'
$Services = @($WhatsAppService, $WebService)

function Assert-Admin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Ejecuta este script como Administrador.'
    }
}

function Stop-ProjectProcesses {
    Write-Host 'Deteniendo procesos del proyecto...' -ForegroundColor Cyan

    Get-CimInstance Win32_Process |
        Where-Object {
            ($_.Name -eq 'node.exe' -and ($_.CommandLine -match 'web_server\.js' -or $_.CommandLine -match 'enviar_programados\.js')) -or
            ($_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'IniciarServicioWhatsApp\.ps1')
        } |
        ForEach-Object {
            Write-Host "Matando PID $($_.ProcessId): $($_.Name)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}

function Stop-And-Delete-Service {
    param([string]$Name)

    $svc = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Host "Servicio $Name no existe; omitiendo."
        return
    }

    Write-Host "Procesando servicio $Name..." -ForegroundColor Cyan

    try {
        & sc.exe stop $Name | Out-Null
    } catch {}

    Start-Sleep -Seconds 2

    $svc = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
    if ($svc -and $svc.ProcessId -and $svc.ProcessId -ne 0) {
        Write-Host "Matando proceso de servicio $Name PID $($svc.ProcessId)"
        Stop-Process -Id $svc.ProcessId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    if (Test-Path -LiteralPath $Nssm) {
        try { & $Nssm stop $Name | Out-Null } catch {}
        try { & $Nssm remove $Name confirm | Out-Null } catch {}
    }

    try { & sc.exe delete $Name | Out-Null } catch {}
}

function Wait-Service-Deleted {
    param([string]$Name)

    for ($i = 1; $i -le 20; $i++) {
        $svc = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
        if (-not $svc) {
            Write-Host "Servicio $Name eliminado."
            return $true
        }
        Write-Host "Esperando eliminacion de $Name ($i/20)..."
        Start-Sleep -Seconds 2
    }

    return $false
}

Assert-Admin
if (-not (Test-Path -LiteralPath $Nssm)) { throw "No existe NSSM: $Nssm" }
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

Stop-ProjectProcesses

foreach ($service in $Services) {
    Stop-And-Delete-Service -Name $service
}

$allDeleted = $true
foreach ($service in $Services) {
    if (-not (Wait-Service-Deleted -Name $service)) {
        $allDeleted = $false
    }
}

if (-not $allDeleted) {
    Write-Host ''
    Write-Host 'Windows todavia mantiene algun servicio marcado para borrarse.' -ForegroundColor Yellow
    Write-Host 'Cierra Services.msc, ventanas de PowerShell/CMD relacionadas y reinicia la computadora.'
    Write-Host 'Despues del reinicio, ejecuta scripts\InstalarServiciosNSSM.cmd como Administrador.'
    exit 2
}

$projectChrome = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'tools\puppeteer') -Recurse -Filter chrome.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\chrome-win64\\chrome\.exe$' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -ExpandProperty FullName -First 1

$chromeCandidates = @(
    $projectChrome,
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
)
$chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

$webLogOut = Join-Path $Runtime 'ConfortPlace-Web.out.log'
$webLogErr = Join-Path $Runtime 'ConfortPlace-Web.err.log'
$waLogOut = Join-Path $Runtime 'ConfortPlace-WhatsApp.out.log'
$waLogErr = Join-Path $Runtime 'ConfortPlace-WhatsApp.err.log'

Write-Host 'Instalando servicio Web...' -ForegroundColor Cyan
& $Nssm install $WebService $Node "`"$ProjectRoot\scripts\web_server.js`"" | Out-Null
& $Nssm set $WebService DisplayName 'Confort Place - Web Dashboard' | Out-Null
& $Nssm set $WebService AppDirectory $ProjectRoot | Out-Null
& $Nssm set $WebService AppStdout $webLogOut | Out-Null
& $Nssm set $WebService AppStderr $webLogErr | Out-Null
& $Nssm set $WebService AppRotateFiles 1 | Out-Null
& $Nssm set $WebService AppRotateOnline 1 | Out-Null
& $Nssm set $WebService AppRotateBytes 1048576 | Out-Null
& $Nssm set $WebService Start SERVICE_AUTO_START | Out-Null
& $Nssm set $WebService AppExit Default Restart | Out-Null
& $Nssm set $WebService AppThrottle 1500 | Out-Null
& $Nssm set $WebService AppRestartDelay 10000 | Out-Null

Write-Host 'Instalando servicio WhatsApp...' -ForegroundColor Cyan
& $Nssm install $WhatsAppService powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\IniciarServicioWhatsApp.ps1`"" | Out-Null
& $Nssm set $WhatsAppService DisplayName 'Confort Place - WhatsApp Scheduler' | Out-Null
& $Nssm set $WhatsAppService AppDirectory $ProjectRoot | Out-Null
& $Nssm set $WhatsAppService AppStdout $waLogOut | Out-Null
& $Nssm set $WhatsAppService AppStderr $waLogErr | Out-Null
& $Nssm set $WhatsAppService AppRotateFiles 1 | Out-Null
& $Nssm set $WhatsAppService AppRotateOnline 1 | Out-Null
& $Nssm set $WhatsAppService AppRotateBytes 1048576 | Out-Null
& $Nssm set $WhatsAppService DependOnService $WebService | Out-Null
& $Nssm set $WhatsAppService Start SERVICE_AUTO_START | Out-Null
& $Nssm set $WhatsAppService AppExit Default Restart | Out-Null
& $Nssm set $WhatsAppService AppThrottle 1500 | Out-Null
& $Nssm set $WhatsAppService AppRestartDelay 10000 | Out-Null
if ($chrome) {
    & $Nssm set $WhatsAppService AppEnvironmentExtra "PUPPETEER_EXECUTABLE_PATH=$chrome" | Out-Null
}

icacls $ProjectRoot /grant 'Users:(OI)(CI)M' /T | Out-Null

$lock = Join-Path $Runtime 'servicio_programados.lock'
if (Test-Path -LiteralPath $lock) {
    Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
}

Write-Host 'Arrancando servicios...' -ForegroundColor Cyan
& $Nssm start $WebService | Out-Null
Start-Sleep -Seconds 5
& $Nssm start $WhatsAppService | Out-Null
Start-Sleep -Seconds 15

Write-Host ''
Get-Service -Name $WebService, $WhatsAppService | Format-Table Name, Status, StartType

Write-Host ''
Write-Host 'Dashboard check:' -ForegroundColor Cyan
try {
    Invoke-WebRequest 'http://localhost:3000' -UseBasicParsing -TimeoutSec 8 |
        Select-Object StatusCode, StatusDescription |
        Format-Table -AutoSize
} catch {
    Write-Warning $_.Exception.Message
}

Write-Host ''
Write-Host 'API status:' -ForegroundColor Cyan
try {
    Invoke-RestMethod 'http://localhost:3000/api/status' -TimeoutSec 8 |
        ConvertTo-Json -Depth 5
} catch {
    Write-Warning $_.Exception.Message
}
