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
    throw "No existe el JSON de alta: $JsonPath"
}

if (-not (Test-Path -LiteralPath $RutaExcel)) {
    throw "No existe el Excel: $RutaExcel"
}

$data = Get-Content -LiteralPath $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Tiene-Propiedad($Objeto, [string]$Nombre) {
    return $null -ne ($Objeto.PSObject.Properties | Where-Object { $_.Name -eq $Nombre })
}

function Valor([object]$Objeto, [string]$Propiedad, [string]$Default = '') {
    if (Tiene-Propiedad $Objeto $Propiedad) {
        $v = $Objeto.$Propiedad
        if ($null -ne $v) { return [string]$v }
    }
    return $Default
}

$grupo = Valor $data 'group'
$categoria = Valor $data 'category'
$mensaje = Valor $data 'mensaje'
if ([string]::IsNullOrWhiteSpace($grupo)) { throw 'La casa / grupo exacto es obligatorio.' }
if ([string]::IsNullOrWhiteSpace($mensaje)) { throw 'El mensaje es obligatorio.' }

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

    $ultimo = 4
    $usedRows = $ws.UsedRange.Rows.Count + $ws.UsedRange.Row - 1
    for ($r = 5; $r -le $usedRows; $r++) {
        $g = [string]$ws.Cells.Item($r, 1).Value2
        $m = [string]$ws.Cells.Item($r, 16).Value2
        if (-not [string]::IsNullOrWhiteSpace($g) -and -not [string]::IsNullOrWhiteSpace($m) -and -not $g.StartsWith('CASA / GRUPO:')) {
            $ultimo = $r
        }
    }

    if ($ultimo -lt 5) { throw 'No se encontro una fila base para copiar formato.' }
    $nuevaFila = $ultimo + 1

    # No copiar la fila completa con valores: eso arrastra estado, ultimo envio, notas
    # y otros datos operativos. Solo se reutilizan formato, validaciones y la formula
    # de Proximo envio.
    $ws.Rows.Item($ultimo).Copy() | Out-Null
    $ws.Rows.Item($nuevaFila).PasteSpecial(-4122) | Out-Null # xlPasteFormats
    $ws.Rows.Item($nuevaFila).PasteSpecial(6) | Out-Null     # xlPasteValidation

    $ws.Range("A${nuevaFila}:R${nuevaFila}").ClearContents() | Out-Null

    $formulaProximoEnvio = ''
    try {
        $formulaRaw = $ws.Cells.Item($ultimo, 15).Formula2R1C1
        if ($formulaRaw -is [string]) {
            $formulaProximoEnvio = $formulaRaw
        }
    } catch {
        $formulaProximoEnvio = ''
    }
    if (-not [string]::IsNullOrWhiteSpace($formulaProximoEnvio)) {
        $ws.Cells.Item($nuevaFila, 15).Formula2R1C1 = $formulaProximoEnvio
    }

    $ws.Cells.Item($nuevaFila, 1).Value2 = $grupo
    $ws.Cells.Item($nuevaFila, 2).Value2 = $categoria

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
        $valorDia = $false
        if ($null -ne $dias -and (Tiene-Propiedad $dias $k)) {
            $valorDia = [bool]$dias.$k
        }
        $ws.Cells.Item($nuevaFila, $mapa[$k]).Formula = if ($valorDia) { '=TRUE()' } else { '=FALSE()' }
    }

    $ws.Cells.Item($nuevaFila, 10).NumberFormat = '@'
    $ws.Cells.Item($nuevaFila, 10).Value2 = Valor $data 'hora'
    $ws.Cells.Item($nuevaFila, 11).Value2 = Valor $data 'activo' 'SI'
    $ws.Cells.Item($nuevaFila, 12).Value2 = Valor $data 'enviarManual' 'NO'
    $ws.Cells.Item($nuevaFila, 13).Value2 = 'PENDIENTE'
    $ws.Cells.Item($nuevaFila, 14).Value2 = ''
    if ([string]::IsNullOrWhiteSpace($formulaProximoEnvio)) {
        $ws.Cells.Item($nuevaFila, 15).Value2 = ''
    }
    $ws.Cells.Item($nuevaFila, 16).Value2 = $mensaje
    $ws.Cells.Item($nuevaFila, 17).Value2 = ''
    $ws.Cells.Item($nuevaFila, 18).Value2 = $grupo

    $excel.CalculateFullRebuild()
    $ws.Protect($PasswordHoja, $false, $true, $true, $false, $false, $true, $true, $true, $true, $true, $true, $true, $true, $true, $false)
    $ws.EnableSelection = 0
    $wb.Save()

    Write-Output "OK $nuevaFila"
}
finally {
    if ($wb -ne $null) { try { $wb.Save() } catch {} }
    if ($excelCreado -and $excel -ne $null) { try { $excel.Quit() } catch {} }
}
