$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaExcel = Join-Path $Proyecto 'workbooks\RecordatoriosWhatsApp_Programados.xlsx'
$RutaRuntime = Join-Path $Proyecto 'runtime'
$RutaResultados = Join-Path $RutaRuntime 'resultados_programados.tsv'
$RutaLog = Join-Path $RutaRuntime 'servicio_programados.log'
$PasswordHoja = 'recordatorios'

function Escribir-Log([string]$Mensaje) {
    if (-not (Test-Path -LiteralPath $RutaRuntime)) {
        New-Item -ItemType Directory -Force -Path $RutaRuntime | Out-Null
    }
    Add-Content -LiteralPath $RutaLog -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') UPDATE EXCEL: $Mensaje"
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
        for ($c = 1; $c -le 30; $c++) {
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
        $lineas += ($Actual -split "`r?`n" | Where-Object {
            -not [string]::IsNullOrWhiteSpace($_) -and $_ -ne $NuevaFecha
        })
    }
    return ($lineas | Select-Object -First 2) -join "`r`n"
}

if (-not (Test-Path -LiteralPath $RutaResultados)) {
    Escribir-Log 'No existe resultados_programados.tsv.'
    exit 0
}

$resultados = Import-Csv -LiteralPath $RutaResultados -Delimiter "`t" -Encoding UTF8
if ($resultados.Count -eq 0) {
    Escribir-Log 'Resultados vacios; no hay cambios.'
    exit 0
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

    $actualizados = 0
    foreach ($resultado in $resultados) {
        $fila = [int]$resultado.fila
        $ok = ([string]$resultado.ok).Trim().ToUpperInvariant()
        $estado = [string]$resultado.estado
        $fecha = [string]$resultado.fecha
        $nota = [string]$resultado.nota

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

        $actualizados++
    }

    $excel.CalculateFullRebuild()
    $ws.Protect($PasswordHoja, $false, $true, $true, $false, $false, $true, $true, $true, $true, $true, $true, $true, $true, $true, $false)
    $ws.EnableSelection = 0
    $wb.Save()
    Escribir-Log "Actualizacion completada. Filas procesadas: $actualizados."
}
catch {
    Escribir-Log "ERROR: $($_.Exception.Message)"
    throw
}
finally {
    if ($wb -ne $null) { try { $wb.Save() } catch {} }
    if ($excelCreado -and $excel -ne $null) { try { $excel.Quit() } catch {} }
}
