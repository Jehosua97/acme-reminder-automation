$ErrorActionPreference = 'SilentlyContinue'

$ScriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptsRoot
$Runtime = Join-Path $ProjectRoot 'runtime'
$NodeLock = Join-Path $Runtime 'new_customers_whatsapp.lock'
$SupervisorLock = Join-Path $Runtime 'new_customers_whatsapp_supervisor.lock'
$SessionProfile = Join-Path $ProjectRoot '.wwebjs_auth\session-new-customers-info'
$SessionProfileNormalized = $SessionProfile -replace '\\', '/'

foreach ($lockFile in @($NodeLock, $SupervisorLock)) {
    if (-not (Test-Path -LiteralPath $lockFile)) { continue }
    $targetPid = Get-Content -LiteralPath $lockFile |
        Select-String -Pattern 'pid=(\d+)' |
        ForEach-Object { $_.Matches[0].Groups[1].Value } |
        Select-Object -First 1
    if ($targetPid) { taskkill.exe /PID ([int]$targetPid) /T /F | Out-Null }
    Remove-Item -LiteralPath $lockFile -Force
}

Get-CimInstance Win32_Process |
    Where-Object {
        $command = [string]$_.CommandLine
        $command -like '*new_customers_whatsapp.js*' -or
        $command -like '*IniciarServicioNewCustomersWhatsApp.ps1*' -or
        $command -like "*$SessionProfile*" -or
        $command -like "*$SessionProfileNormalized*" -or
        $command -like '*session-new-customers-info*'
    } |
    ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }

Write-Output 'Servicio exclusivo de clientes nuevos detenido. Recordatorios no fue modificado.'
