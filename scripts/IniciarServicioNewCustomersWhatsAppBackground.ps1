$ErrorActionPreference = 'Stop'

$ScriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptsRoot
$StartScript = Join-Path $ScriptsRoot 'IniciarServicioNewCustomersWhatsApp.ps1'

Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$StartScript`"") `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden

Write-Output 'Solicitud de inicio enviada al WhatsApp exclusivo de clientes nuevos.'
