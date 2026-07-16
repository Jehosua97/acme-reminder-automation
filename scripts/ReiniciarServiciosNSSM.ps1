$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Nssm = Join-Path $ProjectRoot 'tools\nssm\nssm-2.24\win64\nssm.exe'
$Services = @('ConfortPlace-Web', 'ConfortPlace-WhatsApp')

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecuta este script desde PowerShell como Administrador.'
}
if (-not (Test-Path -LiteralPath $Nssm)) {
    throw "No existe NSSM: $Nssm"
}

foreach ($service in $Services) {
    if (Get-Service -Name $service -ErrorAction SilentlyContinue) {
        & $Nssm restart $service | Out-Null
    } else {
        Write-Warning "No existe el servicio $service"
    }
}

Get-Service -Name $Services -ErrorAction SilentlyContinue | Format-Table Name, Status, StartType
