param(
    [Parameter(Mandatory = $true)]
    [string]$JsonPath
)

$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proyecto = Split-Path -Parent $Raiz
$RutaExcel = Join-Path $Proyecto 'workbooks\RecordatoriosWhatsApp_Programados.xlsx'
$PasswordHoja = 'recordatorios'

if (-not (Test-Path -LiteralPath $JsonPath)) {
    throw "No existe el JSON de actualizacion: $JsonPath"
}

if (-not (Test-Path -LiteralPath $RutaExcel)) {
    throw "No existe el Excel: $RutaExcel"
}

$data = Get-Content -LiteralPath $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$fila = [int]$data.row
if ($fila -lt 5) {
    throw "Fila invalida: $fila"
}

function Tiene-Propiedad($Objeto, [string]$Nombre) {
    return $null -ne ($Objeto.PSObject.Properties | Where-Object { $_.Name -eq $Nombre })
}

function Set-IfPresent($ws, [int]$Row, [int]$Column, $Objeto, [string]$Propiedad) {
    if (Tiene-Propiedad $Objeto $Propiedad) {
        $valor = $Objeto.$Propiedad
        if ($null -eq $valor) { $valor = '' }
        $ws.Cells.Item($Row, $Column).Value2 = [string]$valor
    }
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

    if (Tiene-Propiedad $data 'group') {
        $ws.Cells.Item($fila, 1).Value2 = [string]$data.group
        $ws.Cells.Item($fila, 18).Value2 = [string]$data.group
    }
    if (Tiene-Propiedad $data 'category') { $ws.Cells.Item($fila, 2).Value2 = [string]$data.category }

    if (Tiene-Propiedad $data 'days') {
        $dias = $data.days
        $mapa = @{
            lun = 3
            mar = 4
            mie = 5
            jue = 6
            vie = 7
            sab = 8
            dom = 9
        }
        foreach ($k in $mapa.Keys) {
            if (Tiene-Propiedad $dias $k) {
                $ws.Cells.Item($fila, $mapa[$k]).Value2 = [bool]$dias.$k
            }
        }
    }

    Set-IfPresent $ws $fila 10 $data 'hora'
    Set-IfPresent $ws $fila 11 $data 'activo'
    Set-IfPresent $ws $fila 12 $data 'enviarManual'
    Set-IfPresent $ws $fila 16 $data 'mensaje'
    Set-IfPresent $ws $fila 17 $data 'notas'

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
