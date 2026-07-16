$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Nssm = Join-Path $ProjectRoot 'tools\nssm\nssm-2.24\win64\nssm.exe'
$Runtime = Join-Path $ProjectRoot 'runtime'
$Services = @('ConfortPlace-Web', 'ConfortPlace-WhatsApp')
$WebService = 'ConfortPlace-Web'
$WhatsAppService = 'ConfortPlace-WhatsApp'

function Assert-Admin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Ejecuta este script desde PowerShell como Administrador.'
    }
}

function Stop-ManualProcesses {
    Get-CimInstance Win32_Process |
        Where-Object {
            ($_.Name -eq 'node.exe' -and ($_.CommandLine -match 'web_server\.js' -or $_.CommandLine -match 'enviar_programados\.js.*--service')) -or
            ($_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'IniciarServicioWhatsApp\.ps1')
        } |
        ForEach-Object {
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            } catch {}
        }
    Start-Sleep -Seconds 2
}

Assert-Admin
if (-not (Test-Path -LiteralPath $Nssm)) { throw "No existe NSSM: $Nssm" }
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

Write-Host 'Deteniendo procesos manuales viejos...' -ForegroundColor Cyan
Stop-ManualProcesses

Write-Host 'Forzando servicios a Automatic...' -ForegroundColor Cyan
foreach ($service in $Services) {
    if (-not (Get-Service -Name $service -ErrorAction SilentlyContinue)) {
        throw "No existe el servicio $service. Corre primero InstalarServiciosNSSM.cmd como Administrador."
    }
    & sc.exe config $service start= auto | Out-Null
    & $Nssm set $service Start SERVICE_AUTO_START | Out-Null
    & $Nssm set $service AppExit Default Restart | Out-Null
    & $Nssm set $service AppThrottle 1500 | Out-Null
    & $Nssm set $service AppRestartDelay 10000 | Out-Null
}

$lock = Join-Path $Runtime 'servicio_programados.lock'
if (Test-Path -LiteralPath $lock) {
    Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
}

Write-Host 'Arrancando Web Dashboard...' -ForegroundColor Cyan
if ((Get-Service -Name $WebService).Status -ne 'Running') {
    & $Nssm start $WebService | Out-Null
}
Start-Sleep -Seconds 5

Write-Host 'Arrancando WhatsApp Scheduler...' -ForegroundColor Cyan
if ((Get-Service -Name $WhatsAppService).Status -ne 'Running') {
    & $Nssm start $WhatsAppService | Out-Null
}
Start-Sleep -Seconds 10

Write-Host ''
Get-Service -Name $Services | Format-Table Name, Status, StartType

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
