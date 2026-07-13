$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaExcel = Join-Path $Proyecto 'workbooks\RecordatoriosWhatsApp_Programados.xlsx'
$PasswordHoja = 'recordatorios'

if (-not (Test-Path -LiteralPath $RutaExcel)) {
    throw "No existe $RutaExcel"
}

$horas = (0..23 | ForEach-Object { '{0:00}:00 hrs' -f $_ }) -join ','

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $null

try {
    $wb = $excel.Workbooks.Open($RutaExcel)
    $ws = $wb.Worksheets.Item('Recordatorios Programados')
    try { $ws.Unprotect($PasswordHoja) } catch {}

    $lastRow = $ws.Cells($ws.Rows.Count, 1).End(-4162).Row
    $range = $ws.Range("J5:J$lastRow")
    $range.Validation.Delete()
    $range.Validation.Add(3, 1, 1, $horas)
    $range.Validation.IgnoreBlank = $true
    $range.Validation.InCellDropdown = $true

    for ($r = 5; $r -le $lastRow; $r++) {
        $cell = $ws.Cells.Item($r, 15) # Columna O: Proximo envio
        if ($cell.HasFormula) {
            $cell.Formula2 = $cell.Formula2.Replace('NOW()-TIME(0,3,0)', 'NOW()-TIME(3,30,0)')
        }
    }

    $ws.Range('A2:R2').Merge() | Out-Null
    $ws.Range('A2').Value2 = 'Marca los días activos con checkboxes y ajusta Hora/Activo. Último envío y Próximo envío están protegidas y se calculan automáticamente.'
    $ws.Range('A2').WrapText = $true

    $excel.CalculateFullRebuild()
    $ws.Protect($PasswordHoja, $false, $true, $true, $false, $false, $false, $false, $false, $false, $true, $false, $false, $true, $true, $false)
    $ws.EnableSelection = 0
    $wb.Save()
    Write-Output 'Modo horas fijas restaurado: Hora permite seleccionar saltos de 1 hora.'
}
finally {
    if ($wb -ne $null) { try { $wb.Close($true) } catch {} }
    if ($excel -ne $null) { try { $excel.Quit() } catch {} }
}
