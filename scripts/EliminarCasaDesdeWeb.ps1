param(
    [Parameter(Mandatory = $true)]
    [string]$House
)

$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaExcel = Join-Path $Proyecto 'workbooks\RecordatoriosWhatsApp_Programados.xlsx'
$PasswordHoja = 'recordatorios'

if ([string]::IsNullOrWhiteSpace($House)) {
    throw 'Casa / grupo invalido.'
}

if (-not (Test-Path -LiteralPath $RutaExcel)) {
    throw "No existe el Excel: $RutaExcel"
}

$excel = $null
$wb = $null
$excelCreado = $false
$procesadas = 0

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
    try { $ws.Unprotect($PasswordHoja) } catch {}

    $usedRows = $ws.UsedRange.Rows.Count + $ws.UsedRange.Row - 1
    for ($r = 5; $r -le $usedRows; $r++) {
        $grupoActual = [string]$ws.Cells.Item($r, 1).Value2
        $filtroActual = [string]$ws.Cells.Item($r, 18).Value2
        if ($grupoActual -eq $House -or $filtroActual -eq $House) {
            $ws.Cells.Item($r, 1).Value2 = ''
            $ws.Cells.Item($r, 18).Value2 = ''
            $ws.Cells.Item($r, 11).Value2 = 'NO'
            $procesadas++
        }
    }

    $excel.CalculateFullRebuild()
    $ws.Protect($PasswordHoja, $false, $true, $true, $false, $false, $true, $true, $true, $true, $true, $true, $true, $true, $true, $false)
    $ws.EnableSelection = 0
    $wb.Save()

    Write-Output "OK $procesadas"
}
finally {
    if ($wb -ne $null) { try { $wb.Save() } catch {} }
    if ($excelCreado -and $excel -ne $null) { try { $excel.Quit() } catch {} }
}
