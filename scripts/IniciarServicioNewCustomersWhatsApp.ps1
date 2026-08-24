$ErrorActionPreference = 'Stop'

$ScriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptsRoot
$NodeScript = Join-Path $ScriptsRoot 'new_customers_whatsapp.js'
$Runtime = Join-Path $ProjectRoot 'runtime'
$Log = Join-Path $Runtime 'new_customers_whatsapp.log'
$SupervisorLock = Join-Path $Runtime 'new_customers_whatsapp_supervisor.lock'
$SessionProfile = Join-Path $ProjectRoot '.wwebjs_auth\session-new-customers-info'
$MaxLogBytes = 20MB

if (-not (Test-Path -LiteralPath $Runtime)) { New-Item -ItemType Directory -Force -Path $Runtime | Out-Null }
if (-not (Test-Path -LiteralPath $NodeScript)) { throw "No existe $NodeScript" }

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

function Write-ServiceLog([string]$Message) {
    Rotate-LogIfNeeded -Path $Log -MaxBytes $MaxLogBytes
    Add-Content -LiteralPath $Log -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
}

if (Test-Path -LiteralPath $SupervisorLock) {
    $previous = Get-Content -LiteralPath $SupervisorLock -ErrorAction SilentlyContinue |
        Select-String -Pattern 'pid=(\d+)' |
        ForEach-Object { $_.Matches[0].Groups[1].Value } |
        Select-Object -First 1
    if ($previous -and (Get-Process -Id ([int]$previous) -ErrorAction SilentlyContinue)) {
        Write-ServiceLog "El supervisor de clientes nuevos ya está activo con PID $previous."
        exit 0
    }
    Remove-Item -LiteralPath $SupervisorLock -Force -ErrorAction SilentlyContinue
}

@("pid=$PID", "inicio=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')") |
    Set-Content -LiteralPath $SupervisorLock -Encoding UTF8

$projectChrome = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'tools\puppeteer') -Recurse -Filter chrome.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\chrome-win64\\chrome\.exe$' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -ExpandProperty FullName -First 1
if ($projectChrome) { $env:PUPPETEER_EXECUTABLE_PATH = $projectChrome }

try {
    while ($true) {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = 'node'
        $psi.Arguments = "`"$NodeScript`""
        $psi.WorkingDirectory = $ProjectRoot
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $psi
        $process.EnableRaisingEvents = $true
        $logOptions = @{ Path = $Log; MaxBytes = $MaxLogBytes }
        $outSubscription = Register-ObjectEvent -InputObject $process -EventName OutputDataReceived -MessageData $logOptions -Action {
            if ($EventArgs.Data) {
                $eventLog = [string]$Event.MessageData.Path
                try {
                    $item = Get-Item -LiteralPath $eventLog -ErrorAction SilentlyContinue
                    if ($item -and $item.Length -ge [long]$Event.MessageData.MaxBytes) {
                        $previous = "$eventLog.previous"
                        Remove-Item -LiteralPath $previous -Force -ErrorAction SilentlyContinue
                        Move-Item -LiteralPath $eventLog -Destination $previous -Force
                    }
                } catch {}
                Add-Content -LiteralPath $eventLog -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') NODE OUT: $($EventArgs.Data)"
            }
        }
        $errSubscription = Register-ObjectEvent -InputObject $process -EventName ErrorDataReceived -MessageData $logOptions -Action {
            if ($EventArgs.Data) {
                $eventLog = [string]$Event.MessageData.Path
                try {
                    $item = Get-Item -LiteralPath $eventLog -ErrorAction SilentlyContinue
                    if ($item -and $item.Length -ge [long]$Event.MessageData.MaxBytes) {
                        $previous = "$eventLog.previous"
                        Remove-Item -LiteralPath $previous -Force -ErrorAction SilentlyContinue
                        Move-Item -LiteralPath $eventLog -Destination $previous -Force
                    }
                } catch {}
                Add-Content -LiteralPath $eventLog -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') NODE ERR: $($EventArgs.Data)"
            }
        }

        try {
            [void]$process.Start()
            $process.BeginOutputReadLine()
            $process.BeginErrorReadLine()
            Write-ServiceLog "Proceso dedicado de clientes nuevos iniciado con PID $($process.Id)."
            $process.WaitForExit()
            $exitCode = $process.ExitCode
            Write-ServiceLog "Proceso dedicado terminó con exit code $exitCode."
        }
        finally {
            Unregister-Event -SubscriptionId $outSubscription.Id -ErrorAction SilentlyContinue
            Unregister-Event -SubscriptionId $errSubscription.Id -ErrorAction SilentlyContinue
            $process.Dispose()
        }

        foreach ($profileLock in @('DevToolsActivePort', 'lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket')) {
            $target = Join-Path $SessionProfile $profileLock
            if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
        }
        if ($exitCode -eq 0) {
            Write-ServiceLog 'El proceso termino sin error, pero el servicio debe permanecer activo. Reintentando en 10 segundos.'
        } else {
            Write-ServiceLog "El proceso termino con error $exitCode. Reintentando en 10 segundos."
        }
        Start-Sleep -Seconds 10
    }
}
finally {
    Remove-Item -LiteralPath $SupervisorLock -Force -ErrorAction SilentlyContinue
}
