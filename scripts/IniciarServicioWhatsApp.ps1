$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaNode = Join-Path $Raiz 'enviar_programados.js'
$RutaRuntime = Join-Path $Proyecto 'runtime'
$RutaLog = Join-Path $RutaRuntime 'servicio_programados.log'
$RutaLock = Join-Path $RutaRuntime 'servicio_programados.lock'
$RutaSettings = Join-Path $Proyecto 'data\settings.json'

if (-not (Test-Path -LiteralPath $RutaRuntime)) {
    New-Item -ItemType Directory -Force -Path $RutaRuntime | Out-Null
}

function Escribir-Log([string]$Mensaje) {
    Add-Content -LiteralPath $RutaLog -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Mensaje"
}

if (Test-Path -LiteralPath $RutaLock) {
    $contenido = Get-Content -LiteralPath $RutaLock -ErrorAction SilentlyContinue
    $pidAnterior = ($contenido | Select-String -Pattern 'pid=(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
    if ($pidAnterior) {
        $procAnterior = Get-Process -Id ([int]$pidAnterior) -ErrorAction SilentlyContinue
        if ($null -ne $procAnterior) {
            Escribir-Log "Servicio ya esta corriendo con PID $pidAnterior. No se inicia otro."
            exit 0
        }
    }
    Remove-Item -LiteralPath $RutaLock -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $RutaNode)) { throw "No existe $RutaNode" }

$settings = $null
if (Test-Path -LiteralPath $RutaSettings) {
    try {
        $settings = Get-Content -LiteralPath $RutaSettings -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        $settings = $null
    }
}

$intervaloDefault = if ($settings -and $settings.serviceIntervalMs) { [string]$settings.serviceIntervalMs } else { '300000' }
$ventanaDefault = if ($settings -and $settings.sendWindowMinutes) { [string]$settings.sendWindowMinutes } else { '10' }
$env:INTERVALO_SERVICIO_MS = if ($env:INTERVALO_SERVICIO_MS) { $env:INTERVALO_SERVICIO_MS } else { $intervaloDefault }
$env:VENTANA_AUTO_MINUTOS = if ($env:VENTANA_AUTO_MINUTOS) { $env:VENTANA_AUTO_MINUTOS } else { $ventanaDefault }

Escribir-Log "Iniciando servicio permanente de recordatorios. Intervalo=$env:INTERVALO_SERVICIO_MS ms Ventana=$env:VENTANA_AUTO_MINUTOS min"

$CodigoReinicioWhatsApp = 75
$reiniciosConsecutivos = 0
$TimeoutArranqueSinSalidaSegundos = 180

while ($true) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'node'
    $psi.Arguments = "`"$RutaNode`" --service --headless"
    $psi.WorkingDirectory = $Proyecto
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $proc.EnableRaisingEvents = $true

    $outSub = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -MessageData $RutaLog -Action {
        if ($EventArgs.Data) {
            Add-Content -LiteralPath $Event.MessageData -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') NODE OUT: $($EventArgs.Data)"
        }
    }
    $errSub = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -MessageData $RutaLog -Action {
        if ($EventArgs.Data) {
            Add-Content -LiteralPath $Event.MessageData -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') NODE ERR: $($EventArgs.Data)"
        }
    }

    try {
        [void]$proc.Start()
        @(
            "pid=$($proc.Id)"
            "inicio=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        ) | Set-Content -LiteralPath $RutaLock -Encoding UTF8

        $proc.BeginOutputReadLine()
        $proc.BeginErrorReadLine()
        Escribir-Log "Servicio Node iniciado con PID $($proc.Id)."
        $marcaInicioNode = (Get-Item -LiteralPath $RutaLog).LastWriteTimeUtc
        $primeraSalidaNode = $false
        $reinicioForzadoPorArranque = $false

        while (-not $proc.WaitForExit(5000)) {
            if (-not $primeraSalidaNode) {
                $logActualizado = (Get-Item -LiteralPath $RutaLog).LastWriteTimeUtc
                if ($logActualizado -gt $marcaInicioNode.AddMilliseconds(500)) {
                    $primeraSalidaNode = $true
                    continue
                }

                $segundosSinSalida = ((Get-Date).ToUniversalTime() - $marcaInicioNode).TotalSeconds
                if ($segundosSinSalida -ge $TimeoutArranqueSinSalidaSegundos) {
                    Escribir-Log "Node no genero salida en $TimeoutArranqueSinSalidaSegundos segundos. Reiniciando servicio WhatsApp."
                    try {
                        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                    } catch {}
                    $proc.WaitForExit()
                    $reinicioForzadoPorArranque = $true
                    break
                }
            }
        }
        $exitCode = if ($reinicioForzadoPorArranque) { $CodigoReinicioWhatsApp } else { $proc.ExitCode }
        Escribir-Log "Servicio termino con exit code $exitCode."

        if ($exitCode -eq $CodigoReinicioWhatsApp) {
            $reiniciosConsecutivos += 1
            $espera = [Math]::Min(60, 8 * $reiniciosConsecutivos)
            Escribir-Log "Reinicio automatico solicitado por WhatsApp Web. Reintentando en $espera segundos."
            Start-Sleep -Seconds $espera
            continue
        }

        exit $exitCode
    }
    finally {
        Unregister-Event -SubscriptionId $outSub.Id -ErrorAction SilentlyContinue
        Unregister-Event -SubscriptionId $errSub.Id -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $RutaLock -Force -ErrorAction SilentlyContinue
    }
}
