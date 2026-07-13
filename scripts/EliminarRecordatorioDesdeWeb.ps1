param(
    [Parameter(Mandatory = $true)]
    [int]$Row
)

$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaExcel = Join-Path $Proyecto 'workbooks\RecordatoriosWhatsApp_Programados.xlsx'
$PasswordHoja = 'recordatorios'

if ($Row -lt 5) {
    throw "Fila invalida para eliminar: $Row"
}

if (-not (Test-Path -LiteralPath $RutaExcel)) {
    throw "No existe el Excel: $RutaExcel"
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
    try { $ws.Unprotect($PasswordHoja) } catch {}

    $grupo = [string]$ws.Cells.Item($Row, 1).Value2
    $mensaje = [string]$ws.Cells.Item($Row, 16).Value2
    if ([string]::IsNullOrWhiteSpace($grupo) -and [string]::IsNullOrWhiteSpace($mensaje)) {
        throw "La fila $Row no parece contener un recordatorio."
    }

    $ws.Rows.Item($Row).Delete() | Out-Null
    $excel.CalculateFullRebuild()
    $ws.Protect($PasswordHoja, $false, $true, $true, $false, $false, $true, $true, $true, $true, $true, $true, $true, $true, $true, $false)
    $ws.EnableSelection = 0
    $wb.Save()

    Write-Output "OK"
}
finally {
    if ($wb -ne $null) { try { $wb.Save() } catch {} }
    if ($excelCreado -and $excel -ne $null) { try { $excel.Quit() } catch {} }
}
