$ErrorActionPreference = 'Continue'

$Services = @('ConfortPlace-Web', 'ConfortPlace-WhatsApp')
Get-Service -Name $Services -ErrorAction SilentlyContinue | Format-Table Name, Status, StartType

Write-Host ''
Write-Host 'Dashboard check:'
try {
    Invoke-WebRequest 'http://localhost:3000' -UseBasicParsing -TimeoutSec 8 |
        Select-Object StatusCode, StatusDescription
} catch {
    Write-Warning $_.Exception.Message
}

Write-Host ''
Write-Host 'API status:'
try {
    Invoke-RestMethod 'http://localhost:3000/api/status' -TimeoutSec 8 |
        ConvertTo-Json -Depth 5
} catch {
    Write-Warning $_.Exception.Message
}
