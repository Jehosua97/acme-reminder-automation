$ErrorActionPreference = 'Stop'

$ScriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptsRoot
$RuntimeRoot = Join-Path $ProjectRoot 'runtime'
$GuardianLog = Join-Path $RuntimeRoot 'whatsapp_guardian.log'
$GuardianStatus = Join-Path $RuntimeRoot 'whatsapp_guardian_status.json'
$CheckIntervalSeconds = 30
$MaxGuardianLogBytes = 5MB

if (-not (Test-Path -LiteralPath $RuntimeRoot)) {
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
}

function Rotate-LogIfNeeded([string]$Path, [long]$MaxBytes) {
    try {
        $item = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
        if ($item -and $item.Length -ge $MaxBytes) {
            $previous = "$Path.previous"
            Remove-Item -LiteralPath $previous -Force -ErrorAction SilentlyContinue
            Move-Item -LiteralPath $Path -Destination $previous -Force
        }
    } catch {}
}

function Write-GuardianLog([string]$Message) {
    Rotate-LogIfNeeded -Path $GuardianLog -MaxBytes $MaxGuardianLogBytes
    Add-Content -LiteralPath $GuardianLog -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
}

function Get-ProjectProcesses([string]$CommandFragment, [string]$ExecutableName) {
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.ProcessId -ne $PID -and
            [string]$_.Name -ieq $ExecutableName -and
            [string]$_.CommandLine -like "*$ProjectRoot*" -and
            [string]$_.CommandLine -like "*$CommandFragment*"
        })
}

function Stop-OrphanWorkers([string]$NodeScript, [string]$LockFile) {
    $workers = @(Get-ProjectProcesses -CommandFragment $NodeScript -ExecutableName 'node.exe')
    foreach ($worker in $workers) {
        Write-GuardianLog "Cerrando proceso huerfano $NodeScript PID $($worker.ProcessId) antes de recuperar su supervisor."
        taskkill.exe /PID $worker.ProcessId /T /F | Out-Null
    }
    if ($workers.Count -gt 0) { Start-Sleep -Seconds 2 }
    if (Test-Path -LiteralPath $LockFile) {
        Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
    }
}

function Ensure-Supervisor([string]$Name, [string]$SupervisorScript, [string]$NodeScript, [string]$LockFile) {
    $supervisors = @(Get-ProjectProcesses -CommandFragment $SupervisorScript -ExecutableName 'powershell.exe')
    if ($supervisors.Count -gt 0) {
        return [pscustomobject]@{
            name = $Name
            supervisorPid = [int]$supervisors[0].ProcessId
            workerPids = @((Get-ProjectProcesses -CommandFragment $NodeScript -ExecutableName 'node.exe' | ForEach-Object { [int]$_.ProcessId }))
            action = 'already-running'
        }
    }

    Stop-OrphanWorkers -NodeScript $NodeScript -LockFile $LockFile

    $scriptPath = Join-Path $ScriptsRoot $SupervisorScript
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        throw "No existe el supervisor requerido: $scriptPath"
    }

    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$scriptPath`"")
    $started = Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList $arguments `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -PassThru

    Write-GuardianLog "Supervisor $Name recuperado con PID $($started.Id)."
    return [pscustomobject]@{
        name = $Name
        supervisorPid = [int]$started.Id
        workerPids = @()
        action = 'started'
    }
}

function Write-GuardianStatus($Services, [string]$Status = 'RUNNING', [string]$ErrorMessage = '') {
    $payload = [ordered]@{
        service = 'confort-place-whatsapp-guardian'
        status = $Status
        pid = $PID
        updatedAt = (Get-Date).ToUniversalTime().ToString('o')
        checkIntervalSeconds = $CheckIntervalSeconds
        services = @($Services)
    }
    if ($ErrorMessage) { $payload.error = $ErrorMessage }

    $temporary = "$GuardianStatus.tmp"
    $payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $GuardianStatus -Force
}

$mutex = New-Object System.Threading.Mutex($false, 'Local\ConfortPlaceWhatsAppGuardian')
$hasMutex = $false

try {
    $hasMutex = $mutex.WaitOne(0, $false)
    if (-not $hasMutex) {
        Write-GuardianLog 'Ya existe un guardian activo. Esta instancia termina sin crear duplicados.'
        exit 0
    }

    Write-GuardianLog "Guardian iniciado con PID $PID. Vigilando recordatorios y clientes nuevos cada $CheckIntervalSeconds segundos."

    while ($true) {
        try {
            $services = @(
                Ensure-Supervisor `
                    -Name 'recordatorios' `
                    -SupervisorScript 'IniciarServicioWhatsApp.ps1' `
                    -NodeScript 'enviar_programados.js' `
                    -LockFile (Join-Path $RuntimeRoot 'servicio_programados.lock')
                Ensure-Supervisor `
                    -Name 'clientes-nuevos' `
                    -SupervisorScript 'IniciarServicioNewCustomersWhatsApp.ps1' `
                    -NodeScript 'new_customers_whatsapp.js' `
                    -LockFile (Join-Path $RuntimeRoot 'new_customers_whatsapp.lock')
            )
            Write-GuardianStatus -Services $services
        } catch {
            $message = [string]$_.Exception.Message
            Write-GuardianLog "Error recuperable durante la revision: $message"
            Write-GuardianStatus -Services @() -Status 'DEGRADED' -ErrorMessage $message
        }

        Start-Sleep -Seconds $CheckIntervalSeconds
    }
}
finally {
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
