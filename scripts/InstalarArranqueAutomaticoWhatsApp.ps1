$ErrorActionPreference = 'Stop'

$TaskName = 'ConfortPlace-WhatsApp-User'
$WatchdogTaskName = 'ConfortPlace-WhatsApp-Watchdog'
$ScriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptsRoot
$GuardianScript = Join-Path $ScriptsRoot 'IniciarServiciosWhatsApp.ps1'
$WatchdogScript = Join-Path $ScriptsRoot 'VerificarGuardianWhatsApp.ps1'

if (-not (Test-Path -LiteralPath $GuardianScript)) {
    throw "No existe $GuardianScript"
}
if (-not (Test-Path -LiteralPath $WatchdogScript)) {
    throw "No existe $WatchdogScript"
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$GuardianScript`""
$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument $arguments `
    -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$trigger.Delay = 'PT30S'
$watchdogLogonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$watchdogLogonTrigger.Delay = 'PT45S'
$watchdogRecoveryTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -Hidden `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Ejecuta el guardian oculto de los WhatsApp de Confort Place despues de iniciar sesion.'

$watchdogArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WatchdogScript`""
$watchdogAction = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument $watchdogArguments `
    -WorkingDirectory $ProjectRoot
$watchdogSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -Hidden `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$watchdogTask = New-ScheduledTask `
    -Action $watchdogAction `
    -Trigger @($watchdogLogonTrigger, $watchdogRecoveryTrigger) `
    -Principal $principal `
    -Settings $watchdogSettings `
    -Description 'Comprueba cada minuto que el guardian de WhatsApp siga activo y lo recupera si hace falta.'

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Register-ScheduledTask -TaskName $WatchdogTaskName -InputObject $watchdogTask -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-ScheduledTask -TaskName $WatchdogTaskName

Write-Output "Arranque automatico instalado en $TaskName y $WatchdogTaskName para $currentUser."
