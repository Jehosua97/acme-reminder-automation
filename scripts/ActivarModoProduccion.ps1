$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaSettings = Join-Path $Proyecto 'data\settings.json'
$RutaDetener = Join-Path $Raiz 'DetenerServicioWhatsApp.ps1'
$RutaIniciar = Join-Path $Raiz 'IniciarServicioWhatsAppBackground.ps1'

$settings = [ordered]@{
    mode = 'production'
    timeStepMinutes = 30
    serviceIntervalMs = 300000
    sendWindowMinutes = 10
}

if (-not (Test-Path -LiteralPath (Split-Path -Parent $RutaSettings))) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RutaSettings) | Out-Null
}

$settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $RutaSettings -Encoding UTF8

Write-Output 'Modo PRODUCCION activado: revision cada 5 min, ventana 10 min, selector de hora cada 30 min.'

if (Test-Path -LiteralPath $RutaDetener) {
    & $RutaDetener | Out-Null
}

if (Test-Path -LiteralPath $RutaIniciar) {
    & $RutaIniciar | Out-Null
    Write-Output 'Servicio reiniciado en modo PRODUCCION.'
} else {
    Write-Output 'No se encontro IniciarServicioWhatsAppBackground.ps1. Inicia el servicio manualmente.'
}
