$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaExcel = Join-Path $Proyecto 'workbooks\RecordatoriosWhatsApp_Programados.xlsx'
$PasswordHoja = 'recordatorios'

if (-not (Test-Path -LiteralPath $RutaExcel)) {
    throw "No existe $RutaExcel"
}

$horas = 0..23 | ForEach-Object {
    $h = $_
    0..59 | ForEach-Object { '{0:00}:{1:00} hrs' -f $h, $_ }
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $null

try {
    $wb = $excel.Workbooks.Open($RutaExcel)
    $ws = $wb.Worksheets.Item('Recordatorios Programados')
    try { $ws.Unprotect($PasswordHoja) } catch {}

    $lastRow = $ws.Cells($ws.Rows.Count, 1).End(-4162).Row

    # Excel tiene límite de 255 caracteres en listas directas de validación,
    # por eso guardamos las 1440 horas en una hoja auxiliar oculta.
    $lista = $null
    foreach ($sheet in $wb.Worksheets) {
        if ($sheet.Name -eq 'Listas') { $lista = $sheet; break }
    }
    if ($null -eq $lista) {
        $lista = $wb.Worksheets.Add(
            [System.Type]::Missing,
            $wb.Worksheets.Item($wb.Worksheets.Count)
        )
        $lista.Name = 'Listas'
    }

    $lista.Cells.Clear()
    for ($i = 0; $i -lt $horas.Count; $i++) {
        $lista.Cells.Item($i + 1, 1).Value2 = $horas[$i]
    }
    $lista.Visible = 2 # xlSheetVeryHidden

    $range = $ws.Range("J5:J$lastRow")
    $range.Validation.Delete()
    $range.Validation.Add(3, 1, 1, '=Listas!$A$1:$A$1440')
    $range.Validation.IgnoreBlank = $true
    $range.Validation.InCellDropdown = $true

    for ($r = 5; $r -le $lastRow; $r++) {
        $cell = $ws.Cells.Item($r, 15) # Columna O: Proximo envio
        if ($cell.HasFormula) {
            $cell.Formula2 = $cell.Formula2.Replace('NOW()-TIME(0,3,0)', 'NOW()-TIME(3,30,0)')
        }
    }

    $ws.Range('A2:R2').Merge() | Out-Null
    $ws.Range('A2').Value2 = 'MODO PRUEBA: la columna Hora permite seleccionar cualquier minuto del día. Cuando termines, ejecuta CambiarHorasModoHorasFijas.ps1 para volver a horas fijas.'
    $ws.Range('A2').WrapText = $true

    $excel.CalculateFullRebuild()
    $ws.Protect($PasswordHoja, $false, $true, $true, $false, $false, $false, $false, $false, $false, $true, $false, $false, $true, $true, $false)
    $ws.EnableSelection = 0
    $wb.Save()
    Write-Output 'Modo prueba activado: Hora permite seleccionar cada minuto del día.'
}
finally {
    if ($wb -ne $null) { try { $wb.Close($true) } catch {} }
    if ($excel -ne $null) { try { $excel.Quit() } catch {} }
}
