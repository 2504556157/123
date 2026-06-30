# 股票分析助手 - 启动脚本
param()

$ErrorActionPreference = "SilentlyContinue"

$logFile = Join-Path $PSScriptRoot "server.log"
$nodePath = "node.exe"
$appPath = Join-Path $PSScriptRoot "app.js"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$timestamp $Message"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

# Kill existing app.js process (if any)
Get-WmiObject Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
    $cmd = $_.CommandLine
    if ($cmd -match "app.js") {
        Stop-Process -Id $_.ProcessId -Force
    }
}

Start-Sleep -Seconds 1

# Start the server hidden
$process = Start-Process -FilePath $nodePath `
    -ArgumentList $appPath `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden `
    -PassThru

Start-Sleep -Seconds 2

if (!$process.HasExited) {
    Write-Log "Server started (PID: $($process.Id))"
} else {
    Write-Log "Server FAILED to start"
}
