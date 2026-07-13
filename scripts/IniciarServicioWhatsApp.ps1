$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaNode = Join-Path $Raiz 'enviar_programados.js'
$RutaExcel = Join-Path $Proyecto 'workbooks\RecordatoriosWhatsApp_Programados.xlsx'
$RutaRuntime = Join-Path $Proyecto 'runtime'
$RutaLog = Join-Path $RutaRuntime 'servicio_programados.log'
$RutaLock = Join-Path $RutaRuntime 'servicio_programados.lock'

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
if (-not (Test-Path -LiteralPath $RutaExcel)) { throw "No existe $RutaExcel" }

$env:INTERVALO_SERVICIO_MS = if ($env:INTERVALO_SERVICIO_MS) { $env:INTERVALO_SERVICIO_MS } else { '60000' }
$env:VENTANA_AUTO_MINUTOS = if ($env:VENTANA_AUTO_MINUTOS) { $env:VENTANA_AUTO_MINUTOS } else { '3' }

Escribir-Log 'Iniciando servicio permanente de recordatorios.'

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'node'
$psi.Arguments = "`"$RutaNode`" `"$RutaExcel`" --service --headless"
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

    $proc.WaitForExit()
    Escribir-Log "Servicio termino con exit code $($proc.ExitCode)."
    exit $proc.ExitCode
}
finally {
    Unregister-Event -SubscriptionId $outSub.Id -ErrorAction SilentlyContinue
    Unregister-Event -SubscriptionId $errSub.Id -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $RutaLock -Force -ErrorAction SilentlyContinue
}
