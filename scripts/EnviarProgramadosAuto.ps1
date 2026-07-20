$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaNode = Join-Path $Raiz 'enviar_programados.js'
$RutaRuntime = Join-Path $Proyecto 'runtime'
$RutaEstado = Join-Path $RutaRuntime 'estado_programados.txt'
$RutaResultados = Join-Path $RutaRuntime 'resultados_programados.tsv'
$RutaLogAuto = Join-Path $RutaRuntime 'auto_programados.log'
$RutaLock = Join-Path $RutaRuntime 'auto_programados.lock'
$MaxIntentos = 2
$TimeoutProcesoMinutos = 20
$MaxEdadLockHoras = 4

function Escribir-Log([string]$Mensaje) {
    if (-not (Test-Path -LiteralPath $RutaRuntime)) {
        New-Item -ItemType Directory -Force -Path $RutaRuntime | Out-Null
    }
    $linea = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Mensaje"
    Add-Content -LiteralPath $RutaLogAuto -Value $linea -Encoding UTF8
}

function Hay-Resultado-Exitoso {
    if (-not (Test-Path -LiteralPath $RutaResultados)) { return $false }
    try {
        $resultados = Import-Csv -LiteralPath $RutaResultados -Delimiter "`t" -Encoding UTF8
        return [bool]($resultados | Where-Object { ([string]$_.ok).Trim().ToUpperInvariant() -eq 'SI' } | Select-Object -First 1)
    } catch {
        Escribir-Log "Aviso: no se pudo leer resultados para decidir retry: $($_.Exception.Message)"
        return $false
    }
}

function Es-Error-Infraestructura([string]$Texto) {
    if ([string]::IsNullOrWhiteSpace($Texto)) { return $false }
    return (
        $Texto -match 'Runtime\.callFunctionOn timed out' -or
        $Texto -match 'protocolTimeout' -or
        $Texto -match 'Navigation timeout' -or
        $Texto -match 'Target closed' -or
        $Texto -match 'Execution context was destroyed' -or
        $Texto -match 'WebSocket' -or
        $Texto -match 'disconnected' -or
        $Texto -match 'browser is already running' -or
        $Texto -match 'userDataDir' -or
        $Texto -match 'session-recordatorios-excel'
    )
}

function Crear-Lock {
    if (Test-Path -LiteralPath $RutaLock) {
        $lock = Get-Item -LiteralPath $RutaLock
        $edadHoras = ((Get-Date) - $lock.LastWriteTime).TotalHours
        if ($edadHoras -lt $MaxEdadLockHoras) {
            $contenido = Get-Content -LiteralPath $RutaLock -ErrorAction SilentlyContinue
            $pidAnterior = ($contenido | Select-String -Pattern 'pid=(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
            if ($pidAnterior) {
                $procAnterior = Get-Process -Id ([int]$pidAnterior) -ErrorAction SilentlyContinue
                if ($null -ne $procAnterior) {
                    Escribir-Log "Otra ejecucion sigue activa con PID $pidAnterior. Se omite esta corrida."
                    exit 0
                }
            }
        }
        Escribir-Log 'Se encontro lock viejo o huerfano. Se reemplaza.'
        Remove-Item -LiteralPath $RutaLock -Force -ErrorAction SilentlyContinue
    }

    @(
        "pid=$PID"
        "inicio=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    ) | Set-Content -LiteralPath $RutaLock -Encoding UTF8
}

function Ejecutar-Node([int]$Intento) {
    Escribir-Log "Intento $Intento de $MaxIntentos."

    if (Test-Path -LiteralPath $RutaEstado) { Remove-Item -LiteralPath $RutaEstado -Force }
    if (Test-Path -LiteralPath $RutaResultados) { Remove-Item -LiteralPath $RutaResultados -Force }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = "/c cd /d `"$Proyecto`" && node `"$RutaNode`" --auto --headless"
    $psi.WorkingDirectory = $Proyecto
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()
    $termino = $proc.WaitForExit($TimeoutProcesoMinutos * 60 * 1000)

    if (-not $termino) {
        Escribir-Log "Timeout duro de $TimeoutProcesoMinutos minutos. Se mata el arbol de procesos."
        & taskkill.exe /PID $proc.Id /T /F | Out-Null
        Start-Sleep -Seconds 2
        return @{
            ExitCode = 124
            Stdout = ''
            Stderr = "Timeout duro de $TimeoutProcesoMinutos minutos"
            Timeout = $true
        }
    }

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result

    if ($stdout.Trim()) { Escribir-Log "NODE OUT: $($stdout.Trim())" }
    if ($stderr.Trim()) { Escribir-Log "NODE ERR: $($stderr.Trim())" }
    Escribir-Log "Node exit code: $($proc.ExitCode)"

    return @{
        ExitCode = $proc.ExitCode
        Stdout = $stdout
        Stderr = $stderr
        Timeout = $false
    }
}

try {
    Crear-Lock
    Escribir-Log 'Inicio de ejecucion automatica.'

    if (-not (Test-Path -LiteralPath $RutaNode)) { throw "No existe $RutaNode" }

    $ultimoResultado = $null
    for ($intento = 1; $intento -le $MaxIntentos; $intento++) {
        $ultimoResultado = Ejecutar-Node $intento
        $textoError = "$($ultimoResultado.Stdout)`n$($ultimoResultado.Stderr)"
        $infra = (Es-Error-Infraestructura $textoError) -or $ultimoResultado.Timeout
        $huboExito = Hay-Resultado-Exitoso

        if ($ultimoResultado.ExitCode -eq 0) { break }
        if ($huboExito) {
            Escribir-Log 'No se reintenta porque ya existe al menos un envio exitoso en esta corrida.'
            break
        }
        if (-not $infra) {
            Escribir-Log 'No se reintenta porque no parece error de infraestructura.'
            break
        }
        if ($intento -lt $MaxIntentos) {
            Escribir-Log 'Error de infraestructura sin envios exitosos. Se reintentara en 30 segundos.'
            Start-Sleep -Seconds 30
        }
    }

    if (Test-Path -LiteralPath $RutaEstado) {
        $estadoLineas = Get-Content -LiteralPath $RutaEstado -Encoding UTF8
        if ($estadoLineas.Count -gt 1) { Escribir-Log $estadoLineas[1] }
    } else {
        Escribir-Log 'No se genero estado_programados.txt.'
    }

    Escribir-Log 'Fin de ejecucion automatica.'
    if ($null -ne $ultimoResultado) { exit $ultimoResultado.ExitCode }
    exit 1
}
catch {
    Escribir-Log "ERROR: $($_.Exception.Message)"
    throw
}
finally {
    if (Test-Path -LiteralPath $RutaLock) {
        Remove-Item -LiteralPath $RutaLock -Force -ErrorAction SilentlyContinue
    }
}
