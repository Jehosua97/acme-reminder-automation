param()

$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaStart = Join-Path $Raiz 'IniciarServicioWhatsApp.ps1'

if (-not (Test-Path -LiteralPath $RutaStart)) {
    throw "No existe $RutaStart"
}

$argumentos = @(
    '-NoProfile'
    '-ExecutionPolicy'
    'Bypass'
    '-File'
    "`"$RutaStart`""
)

Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList $argumentos `
    -WorkingDirectory $Proyecto `
    -WindowStyle Hidden

Write-Output 'Solicitud de inicio enviada al servicio de WhatsApp.'
