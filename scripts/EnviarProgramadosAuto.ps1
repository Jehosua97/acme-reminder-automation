$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaExcel = Join-Path $Proyecto 'workbooks\RecordatoriosWhatsApp_Programados.xlsx'
$RutaNode = Join-Path $Raiz 'enviar_programados.js'
$RutaRuntime = Join-Path $Proyecto 'runtime'
$RutaEstado = Join-Path $RutaRuntime 'estado_programados.txt'
$RutaResultados = Join-Path $RutaRuntime 'resultados_programados.tsv'
$RutaLogAuto = Join-Path $RutaRuntime 'auto_programados.log'
$RutaLock = Join-Path $RutaRuntime 'auto_programados.lock'
$PasswordHoja = 'recordatorios'

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

function Quitar-Acentos([string]$Texto) {
    if ($null -eq $Texto) { return '' }
    $normalized = $Texto.Normalize([Text.NormalizationForm]::FormD)
    return -join ($normalized.ToCharArray() | Where-Object {
        [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne
        [Globalization.UnicodeCategory]::NonSpacingMark
    })
}

function Buscar-FilaEncabezado($ws) {
    for ($r = 1; $r -le 30; $r++) {
        $colGrupo = 0
        $colManual = 0
        $colMensaje = 0
        for ($c = 1; $c -le 25; $c++) {
            $valor = (Quitar-Acentos ([string]$ws.Cells.Item($r, $c).Text)).ToUpperInvariant()
            if ($valor.Contains('CASA') -or $valor.Contains('GRUPO')) { $colGrupo = $c }
            if ($valor.Contains('ENVIAR MANUAL')) { $colManual = $c }
            if ($valor.Contains('MENSAJE')) { $colMensaje = $c }
        }
        if ($colGrupo -gt 0 -and $colManual -gt 0 -and $colMensaje -gt 0) {
            return $r
        }
    }
    return 0
}

function Buscar-Columna($ws, [int]$FilaEncabezado, [string[]]$Patrones) {
    for ($c = 1; $c -le 30; $c++) {
        $valor = (Quitar-Acentos ([string]$ws.Cells.Item($FilaEncabezado, $c).Text)).ToUpperInvariant()
        foreach ($patron in $Patrones) {
            if ($valor.Contains($patron.ToUpperInvariant())) { return $c }
        }
    }
    return 0
}

function Agregar-UltimoEnvio([string]$Actual, [string]$NuevaFecha) {
    $lineas = @()
    if (-not [string]::IsNullOrWhiteSpace($NuevaFecha)) { $lineas += $NuevaFecha }
    if (-not [string]::IsNullOrWhiteSpace($Actual)) {
        $lineas += ($Actual -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    return ($lineas | Select-Object -First 2) -join "`r`n"
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
        $Texto -match 'disconnected'
    )
}

function Crear-Lock {
    if (Test-Path -LiteralPath $RutaLock) {
        $lock = Get-Item -LiteralPath $RutaLock
        $edadHoras = ((Get-Date) - $lock.LastWriteTime).TotalHours
        if ($edadHoras -lt $MaxEdadLockHoras) {
            $contenido = Get-Content -LiteralPath $RutaLock -ErrorAction SilentlyContinue
            $pidAnterior = ($contenido | Select-String -Pattern '^pid=(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
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
    $psi.Arguments = "/c cd /d `"$Proyecto`" && node `"$RutaNode`" `"$RutaExcel`" --auto --headless"
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

function Actualizar-Excel-Desde-Resultados {
    if (-not (Test-Path -LiteralPath $RutaResultados)) {
        Escribir-Log 'No hay resultados_programados.tsv para actualizar Excel.'
        return
    }

    $resultados = Import-Csv -LiteralPath $RutaResultados -Delimiter "`t" -Encoding UTF8
    if ($resultados.Count -eq 0) {
        Escribir-Log 'Resultados vacios; no se actualiza Excel.'
        return
    }

    $excel = $null
    $wb = $null
    $excelCreado = $false

    try {
        try {
            $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')
        } catch {
            $excel = New-Object -ComObject Excel.Application
            $excel.Visible = $false
            $excel.DisplayAlerts = $false
            $excelCreado = $true
        }

        foreach ($book in $excel.Workbooks) {
            if ($book.FullName -ieq $RutaExcel) {
                $wb = $book
                break
            }
        }
        if ($null -eq $wb) {
            $wb = $excel.Workbooks.Open($RutaExcel)
        }

        $ws = $wb.Worksheets.Item('Recordatorios Programados')
        $filaEncabezado = Buscar-FilaEncabezado $ws
        if ($filaEncabezado -eq 0) { throw 'No se encontro la fila de encabezados.' }

        $colEstado = Buscar-Columna $ws $filaEncabezado @('ESTADO')
        $colUltimo = Buscar-Columna $ws $filaEncabezado @('ULTIMO ENVIO')
        $colNotas = Buscar-Columna $ws $filaEncabezado @('NOTAS')

        try { $ws.Unprotect($PasswordHoja) } catch {}

        foreach ($resultado in $resultados) {
            $fila = [int]$resultado.fila
            $nombreHojaResultado = [string]$resultado.hoja
            $ok = ([string]$resultado.ok).Trim().ToUpperInvariant()
            $estado = [string]$resultado.estado
            $fecha = [string]$resultado.fecha
            $nota = [string]$resultado.nota

            if (-not [string]::IsNullOrWhiteSpace($nombreHojaResultado)) {
                try {
                    $ws = $wb.Worksheets.Item($nombreHojaResultado)
                    $filaEncabezado = Buscar-FilaEncabezado $ws
                    $colEstado = Buscar-Columna $ws $filaEncabezado @('ESTADO')
                    $colUltimo = Buscar-Columna $ws $filaEncabezado @('ULTIMO ENVIO')
                    $colNotas = Buscar-Columna $ws $filaEncabezado @('NOTAS')
                    try { $ws.Unprotect($PasswordHoja) } catch {}
                } catch {
                    Escribir-Log "Aviso: no se encontro hoja '$nombreHojaResultado' para actualizar fila $fila."
                    continue
                }
            }

            if ($colEstado -gt 0) {
                $ws.Cells.Item($fila, $colEstado).Value2 = $estado
                if ($ok -eq 'SI') {
                    $ws.Cells.Item($fila, $colEstado).Interior.Color = 15269853
                    $ws.Cells.Item($fila, $colEstado).Font.Color = 3434774
                } else {
                    $ws.Cells.Item($fila, $colEstado).Interior.Color = 14803425
                    $ws.Cells.Item($fila, $colEstado).Font.Color = 1776411
                }
                $ws.Cells.Item($fila, $colEstado).Font.Bold = $true
            }

            if ($ok -eq 'SI' -and $colUltimo -gt 0) {
                $actual = [string]$ws.Cells.Item($fila, $colUltimo).Text
                $ws.Cells.Item($fila, $colUltimo).Value2 = Agregar-UltimoEnvio $actual $fecha
                $ws.Cells.Item($fila, $colUltimo).Font.Strikethrough = $true
                $ws.Cells.Item($fila, $colUltimo).WrapText = $true
            }

            if ($colNotas -gt 0) {
                $ws.Cells.Item($fila, $colNotas).Value2 = $nota
                $ws.Cells.Item($fila, $colNotas).WrapText = $true
            }
        }

        $excel.CalculateFullRebuild()
        $ws.Protect($PasswordHoja, $false, $true, $true, $false, $false, $false, $false, $false, $false, $true, $false, $false, $true, $true, $false)
        $ws.EnableSelection = 0
        $wb.Save()
        Escribir-Log 'Excel actualizado desde resultados_programados.tsv.'
    } catch {
        Escribir-Log "ERROR al actualizar Excel: $($_.Exception.Message)"
    } finally {
        if ($wb -ne $null) {
            try { $wb.Save() } catch {}
        }
        if ($excelCreado -and $excel -ne $null) {
            try { $excel.Quit() } catch {}
        }
    }
}

try {
    Crear-Lock
    Escribir-Log 'Inicio de ejecucion automatica.'

    if (-not (Test-Path -LiteralPath $RutaExcel)) { throw "No existe $RutaExcel" }
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

    Actualizar-Excel-Desde-Resultados

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
