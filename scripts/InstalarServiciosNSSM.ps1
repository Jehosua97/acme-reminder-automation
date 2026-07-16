$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Nssm = Join-Path $ProjectRoot 'tools\nssm\nssm-2.24\win64\nssm.exe'
$Runtime = Join-Path $ProjectRoot 'runtime'
$WebService = 'ConfortPlace-Web'
$WhatsAppService = 'ConfortPlace-WhatsApp'

function Assert-Admin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Ejecuta este script desde PowerShell como Administrador.'
    }
}

function Assert-Path([string]$Path, [string]$Description) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "No existe $Description`: $Path"
    }
}

function Get-NodePath {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $cmd) { throw 'No se encontro node.exe en PATH.' }
    return $cmd.Source
}

function Get-PuppeteerChromePath {
    $candidates = @()
    $userCache = Join-Path $env:USERPROFILE '.cache\puppeteer\chrome\win64'
    if (Test-Path -LiteralPath $userCache) {
        $candidates += Get-ChildItem -LiteralPath $userCache -Recurse -Filter chrome.exe -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\chrome-win64\\chrome\.exe$' } |
            Sort-Object LastWriteTime -Descending
    }

    $common = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    )
    foreach ($path in $common) {
        if ($path -and (Test-Path -LiteralPath $path)) {
            $candidates += Get-Item -LiteralPath $path
        }
    }

    return ($candidates | Select-Object -First 1).FullName
}

function Remove-ServiceIfExists([string]$Name) {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($svc) {
        & $Nssm stop $Name | Out-Null
        Start-Sleep -Seconds 2
        & $Nssm remove $Name confirm | Out-Null
    }
}

function Stop-ManualProcesses {
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.CommandLine -match 'web_server\.js' -or
            $_.CommandLine -match 'enviar_programados\.js.*--service' -or
            $_.CommandLine -match 'IniciarServicioWhatsApp\.ps1'
        } |
        ForEach-Object {
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            } catch {}
        }
    Start-Sleep -Seconds 2
}

function Set-CommonServiceOptions([string]$Name) {
    & $Nssm set $Name Start SERVICE_AUTO_START | Out-Null
    & $Nssm set $Name AppDirectory $ProjectRoot | Out-Null
    & $Nssm set $Name AppStdout (Join-Path $Runtime "$Name.out.log") | Out-Null
    & $Nssm set $Name AppStderr (Join-Path $Runtime "$Name.err.log") | Out-Null
    & $Nssm set $Name AppRotateFiles 1 | Out-Null
    & $Nssm set $Name AppRotateOnline 1 | Out-Null
    & $Nssm set $Name AppRotateBytes 10485760 | Out-Null
    & $Nssm set $Name AppThrottle 1500 | Out-Null
    & $Nssm set $Name AppRestartDelay 10000 | Out-Null
    & $Nssm set $Name AppExit Default Restart | Out-Null
}

Assert-Admin
Assert-Path $Nssm 'NSSM'
Assert-Path (Join-Path $ProjectRoot 'scripts\web_server.js') 'web_server.js'
Assert-Path (Join-Path $ProjectRoot 'scripts\IniciarServicioWhatsApp.ps1') 'IniciarServicioWhatsApp.ps1'
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

$Node = Get-NodePath
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Chrome = Get-PuppeteerChromePath

Stop-ManualProcesses
Remove-ServiceIfExists $WebService
Remove-ServiceIfExists $WhatsAppService

& $Nssm install $WebService $Node "`"$ProjectRoot\scripts\web_server.js`"" | Out-Null
Set-CommonServiceOptions $WebService
& $Nssm set $WebService DisplayName 'Confort Place - Web Dashboard' | Out-Null
& $Nssm set $WebService Description 'Local web dashboard for Confort Place WhatsApp reminder automation.' | Out-Null

& $Nssm install $WhatsAppService $PowerShell "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\IniciarServicioWhatsApp.ps1`"" | Out-Null
Set-CommonServiceOptions $WhatsAppService
& $Nssm set $WhatsAppService DisplayName 'Confort Place - WhatsApp Scheduler' | Out-Null
& $Nssm set $WhatsAppService Description 'Persistent WhatsApp Web scheduler for Confort Place reminders.' | Out-Null
& $Nssm set $WhatsAppService DependOnService $WebService | Out-Null
if ($Chrome) {
    & $Nssm set $WhatsAppService AppEnvironmentExtra "PUPPETEER_EXECUTABLE_PATH=$Chrome" | Out-Null
    Write-Host "Chrome fijado para Puppeteer: $Chrome"
} else {
    Write-Warning 'No se encontro chrome.exe para Puppeteer. Si el servicio falla, instala Chrome o ejecuta npm install para descargar Chromium.'
}

icacls $ProjectRoot /grant '*S-1-5-32-545:(OI)(CI)M' /T | Out-Null

& $Nssm start $WebService | Out-Null
Start-Sleep -Seconds 3
& $Nssm start $WhatsAppService | Out-Null

Write-Host ''
Write-Host 'Servicios NSSM instalados e iniciados:' -ForegroundColor Green
Get-Service -Name $WebService, $WhatsAppService | Format-Table Name, Status, StartType
Write-Host ''
Write-Host "Dashboard: http://localhost:3000"
Write-Host "Logs: $Runtime"
