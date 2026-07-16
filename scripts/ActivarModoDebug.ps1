$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaSettings = Join-Path $Proyecto 'data\settings.json'
$RutaDetener = Join-Path $Raiz 'DetenerServicioWhatsApp.ps1'
$RutaIniciar = Join-Path $Raiz 'IniciarServicioWhatsAppBackground.ps1'

$settings = [ordered]@{
    mode = 'debug'
    timeStepMinutes = 1
    serviceIntervalMs = 120000
    sendWindowMinutes = 3
}

if (-not (Test-Path -LiteralPath (Split-Path -Parent $RutaSettings))) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RutaSettings) | Out-Null
}

$settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $RutaSettings -Encoding UTF8

Write-Output 'Modo DEBUG activado: revision cada 2 min, ventana 3 min, selector de hora cada minuto.'

if (Test-Path -LiteralPath $RutaDetener) {
    & $RutaDetener | Out-Null
}

if (Test-Path -LiteralPath $RutaIniciar) {
    & $RutaIniciar | Out-Null
    Write-Output 'Servicio reiniciado en modo DEBUG.'
} else {
    Write-Output 'No se encontro IniciarServicioWhatsAppBackground.ps1. Inicia el servicio manualmente.'
}
