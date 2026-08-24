$ErrorActionPreference = 'Stop'

$ScriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptsRoot
$GuardianScript = Join-Path $ScriptsRoot 'IniciarServiciosWhatsApp.ps1'

if (-not (Test-Path -LiteralPath $GuardianScript)) {
    throw "No existe $GuardianScript"
}

$guardian = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        [string]$_.Name -ieq 'powershell.exe' -and
        [string]$_.CommandLine -like "*$ProjectRoot*" -and
        [string]$_.CommandLine -like '*IniciarServiciosWhatsApp.ps1*'
    } |
    Select-Object -First 1

if ($guardian) {
    exit 0
}

$mainTaskName = 'ConfortPlace-WhatsApp-User'
$mainTask = Get-ScheduledTask -TaskName $mainTaskName -ErrorAction SilentlyContinue
if ($mainTask) {
    Start-ScheduledTask -TaskName $mainTaskName
    Start-Sleep -Seconds 3
    $guardian = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            [string]$_.Name -ieq 'powershell.exe' -and
            [string]$_.CommandLine -like "*$ProjectRoot*" -and
            [string]$_.CommandLine -like '*IniciarServiciosWhatsApp.ps1*'
        } |
        Select-Object -First 1
    if ($guardian) {
        exit 0
    }
}

# Respaldo en caso de que la tarea principal no exista o Windows no pueda
# iniciarla: se lanza el mismo guardian directamente y siempre oculto.
$arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$GuardianScript`"")
Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList $arguments `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden | Out-Null
