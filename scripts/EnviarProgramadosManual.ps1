$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaExcel = Join-Path $Proyecto 'workbooks\RecordatoriosWhatsApp_Programados.xlsx'
$RutaNode = Join-Path $Raiz 'enviar_programados.js'
$RutaRuntime = Join-Path $Proyecto 'runtime'
$RutaEstado = Join-Path $RutaRuntime 'estado_programados.txt'
$RutaResultados = Join-Path $RutaRuntime 'resultados_programados.tsv'
$PasswordHoja = 'recordatorios'

Add-Type -AssemblyName System.Windows.Forms

function Quitar-Acentos([string]$Texto) {
    if ($null -eq $Texto) { return '' }
    $normalized = $Texto.Normalize([Text.NormalizationForm]::FormD)
    return -join ($normalized.ToCharArray() | Where-Object {
        [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne
        [Globalization.UnicodeCategory]::NonSpacingMark
    })
}

function Es-Si($Valor) {
    return ((Quitar-Acentos ([string]$Valor)).Trim().ToUpperInvariant() -eq 'SI')
}

function Buscar-FilaEncabezado($ws) {
    for ($r = 1; $r -le 30; $r++) {
        $colGrupo = 0
        $colManual = 0
        $colMensaje = 0
        for ($c = 1; $c -le 20; $c++) {
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

function Primeras-Lineas([string]$Texto, [int]$Max = 2) {
    if ([string]::IsNullOrWhiteSpace($Texto)) { return '' }
    $lineas = $Texto -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    return ($lineas | Select-Object -First $Max) -join "`r`n"
}

function Agregar-UltimoEnvio([string]$Actual, [string]$NuevaFecha) {
    $lineas = @()
    if (-not [string]::IsNullOrWhiteSpace($NuevaFecha)) { $lineas += $NuevaFecha }
    if (-not [string]::IsNullOrWhiteSpace($Actual)) {
        $lineas += ($Actual -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    return ($lineas | Select-Object -First 2) -join "`r`n"
}

if (-not (Test-Path -LiteralPath $RutaExcel)) {
    throw "No existe el archivo Excel: $RutaExcel"
}
if (-not (Test-Path -LiteralPath $RutaNode)) {
    throw "No existe el script Node: $RutaNode"
}

$excel = $null
$wb = $null
$excelCreado = $false

try {
    try {
        $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')
    } catch {
        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $true
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
    if ($filaEncabezado -eq 0) {
        throw 'No se encontro la fila de encabezados.'
    }

    $colGrupo = Buscar-Columna $ws $filaEncabezado @('CASA', 'GRUPO')
    $colCategoria = Buscar-Columna $ws $filaEncabezado @('CATEGORIA')
    try { $ws.Unprotect($PasswordHoja) } catch {}

    $colManual = Buscar-Columna $ws $filaEncabezado @('ENVIAR MANUAL')
    $colMensaje = Buscar-Columna $ws $filaEncabezado @('MENSAJE')

    if ($colGrupo -eq 0 -or $colManual -eq 0 -or $colMensaje -eq 0) {
        throw 'Faltan columnas requeridas: Casa/Grupo, Enviar manual o Mensaje.'
    }

    $ultimaFila = $ws.Cells($ws.Rows.Count, $colGrupo).End(-4162).Row
    $pendientes = @()
    for ($r = $filaEncabezado + 1; $r -le $ultimaFila; $r++) {
        if (Es-Si $ws.Cells.Item($r, $colManual).Text) {
            $grupo = [string]$ws.Cells.Item($r, $colGrupo).Text
            $categoria = if ($colCategoria -gt 0) { [string]$ws.Cells.Item($r, $colCategoria).Text } else { '' }
            $mensaje = [string]$ws.Cells.Item($r, $colMensaje).Text
            if (-not [string]::IsNullOrWhiteSpace($grupo) -and $grupo -notlike 'CASA / GRUPO:*') {
                $preview = Primeras-Lineas $mensaje 1
                if ($preview.Length -gt 15) { $preview = $preview.Substring(0, 15) + '...' }
                $pendientes += "- $grupo [$categoria]: $preview"
            }
        }
    }

    if ($pendientes.Count -eq 0) {
        [System.Windows.Forms.MessageBox]::Show(
            'No hay filas marcadas con Enviar manual = SI.',
            'Recordatorios WhatsApp',
            'OK',
            'Information'
        ) | Out-Null
        return
    }

    $mensajeConfirmacion = "Estas por enviar mensaje a estas casas:`r`n`r`n" +
        (($pendientes | Select-Object -First 25) -join "`r`n")
    if ($pendientes.Count -gt 25) {
        $mensajeConfirmacion += "`r`n... y $($pendientes.Count - 25) mas."
    }
    $mensajeConfirmacion += "`r`n`r`nTotal: $($pendientes.Count) recordatorio(s).`r`n`r`nQuieres continuar?"

    $respuesta = [System.Windows.Forms.MessageBox]::Show(
        $mensajeConfirmacion,
        'Confirmar envio manual',
        'YesNo',
        'Question',
        'Button2'
    )
    if ($respuesta -ne 'Yes') { return }

    $wb.Save()

    if (Test-Path -LiteralPath $RutaEstado) { Remove-Item -LiteralPath $RutaEstado -Force }
    if (Test-Path -LiteralPath $RutaResultados) { Remove-Item -LiteralPath $RutaResultados -Force }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = "/c cd /d `"$Proyecto`" && node `"$RutaNode`" `"$RutaExcel`""
    $psi.WorkingDirectory = $Proyecto
    $psi.UseShellExecute = $true
    $psi.WindowStyle = 'Normal'
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.WaitForExit()

    if (-not (Test-Path -LiteralPath $RutaEstado)) {
        throw 'No se encontro estado_programados.txt. Revisa la ventana de Node.'
    }

    $estadoLineas = Get-Content -LiteralPath $RutaEstado -Encoding UTF8
    $estadoGeneral = if ($estadoLineas.Count -gt 0) { $estadoLineas[0] } else { 'ERROR' }
    $resumen = if ($estadoLineas.Count -gt 1) { $estadoLineas[1] } else { 'Proceso terminado sin resumen.' }

    $filaEncabezado = Buscar-FilaEncabezado $ws
    $colManual = Buscar-Columna $ws $filaEncabezado @('ENVIAR MANUAL')
    $colEstado = Buscar-Columna $ws $filaEncabezado @('ESTADO')
    $colUltimo = Buscar-Columna $ws $filaEncabezado @('ULTIMO ENVIO')
    $colNotas = Buscar-Columna $ws $filaEncabezado @('NOTAS')

    if (Test-Path -LiteralPath $RutaResultados) {
        $resultados = Import-Csv -LiteralPath $RutaResultados -Delimiter "`t" -Encoding UTF8
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
                    $colManual = Buscar-Columna $ws $filaEncabezado @('ENVIAR MANUAL')
                    $colEstado = Buscar-Columna $ws $filaEncabezado @('ESTADO')
                    $colUltimo = Buscar-Columna $ws $filaEncabezado @('ULTIMO ENVIO')
                    $colNotas = Buscar-Columna $ws $filaEncabezado @('NOTAS')
                    try { $ws.Unprotect($PasswordHoja) } catch {}
                } catch {
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

            if ($ok -eq 'SI') {
                if ($colUltimo -gt 0) {
                    $actual = [string]$ws.Cells.Item($fila, $colUltimo).Text
                    $ws.Cells.Item($fila, $colUltimo).Value2 = Agregar-UltimoEnvio $actual $fecha
                    $ws.Cells.Item($fila, $colUltimo).Font.Strikethrough = $true
                    $ws.Cells.Item($fila, $colUltimo).WrapText = $true
                }
                if ($colManual -gt 0) {
                    $ws.Cells.Item($fila, $colManual).Value2 = 'NO'
                }
            }

            if ($colNotas -gt 0) {
                $ws.Cells.Item($fila, $colNotas).Value2 = $nota
                $ws.Cells.Item($fila, $colNotas).WrapText = $true
            }
        }
    }

    $wb.Save()

    try {
        $ws.Protect($PasswordHoja, $false, $true, $true, $false, $false, $false, $false, $false, $false, $true, $false, $false, $true, $true, $false)
        $ws.EnableSelection = 0
    } catch {}

    $icono = if ($estadoGeneral.Trim().ToUpperInvariant() -eq 'OK') { 'Information' } else { 'Warning' }
    [System.Windows.Forms.MessageBox]::Show(
        $resumen,
        'Recordatorios WhatsApp',
        'OK',
        $icono
    ) | Out-Null
}
catch {
    [System.Windows.Forms.MessageBox]::Show(
        "No se pudo completar el envio manual:`r`n$($_.Exception.Message)",
        'Recordatorios WhatsApp',
        'OK',
        'Error'
    ) | Out-Null
    throw
}
finally {
    if ($wb -ne $null) {
        try {
            $ws = $wb.Worksheets.Item('Recordatorios Programados')
            $ws.Protect($PasswordHoja, $false, $true, $true, $false, $false, $false, $false, $false, $false, $true, $false, $false, $true, $true, $false)
            $ws.EnableSelection = 0
        } catch {}
        try { $wb.Save() } catch {}
    }
    if ($excelCreado -and $excel -ne $null) {
        try { $excel.Quit() } catch {}
    }
}
