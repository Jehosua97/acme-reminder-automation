$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TaskName = 'ConfortPlace-WhatsApp-User'
$ServiceScript = Join-Path $PSScriptRoot 'IniciarServicioWhatsApp.ps1'
$HiddenLauncher = Join-Path $PSScriptRoot 'IniciarServicioWhatsAppHidden.vbs'
$Runtime = Join-Path $ProjectRoot 'runtime'

if (-not (Test-Path -LiteralPath $ServiceScript)) {
    throw "No existe $ServiceScript"
}
if (-not (Test-Path -LiteralPath $HiddenLauncher)) {
    throw "No existe $HiddenLauncher"
}

New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

$action = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument "`"$HiddenLauncher`"" `
    -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT1M'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
} catch {}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Confort Place WhatsApp scheduler running in the interactive user session.' |
    Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 20

Write-Host ''
Write-Host 'Tarea creada:' -ForegroundColor Cyan
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State | Format-Table -AutoSize

Write-Host ''
Write-Host 'Estado API:' -ForegroundColor Cyan
try {
    Invoke-RestMethod 'http://localhost:3000/api/status' -TimeoutSec 8 |
        Select-Object running, paused, pid, status |
        ConvertTo-Json -Depth 4
} catch {
    Write-Warning $_.Exception.Message
}

Write-Host ''
Write-Host 'Nota: esta tarea corre cuando el usuario inicia sesion. Puede estar la pantalla bloqueada, pero el usuario debe haber iniciado sesion despues de reiniciar Windows.'
