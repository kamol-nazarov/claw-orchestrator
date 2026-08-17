[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 18796,

  [string]$HostAddress = '127.0.0.1',

  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$stateRoot = Join-Path $env:LOCALAPPDATA 'ClawOrchestrator'
$logRoot = Join-Path $stateRoot 'logs'
$pidFile = Join-Path $stateRoot 'server.pid'
$stdoutLog = Join-Path $logRoot 'server.stdout.log'
$stderrLog = Join-Path $logRoot 'server.stderr.log'
$healthUrl = "http://127.0.0.1:$Port/health"

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Test-ClawHealth {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    return $response.ok -eq $true
  } catch {
    return $false
  }
}

if (Test-ClawHealth) {
  Write-Host "Claw Orchestrator is already running at http://127.0.0.1:$Port/dashboard"
} else {
  $npm = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
  if (-not $npm) {
    $npm = Get-Command 'npm' -ErrorAction SilentlyContinue
  }
  $node = Get-Command 'node' -ErrorAction SilentlyContinue
  if (-not $npm -or -not $node) {
    throw 'Node.js/npm is not installed or is not on PATH.'
  }
  $npmRoot = (& $npm.Source root --global).Trim()
  $clawoEntry = Join-Path $npmRoot '@enderfga\claw-orchestrator\dist\bin\cli.js'
  if (-not (Test-Path -LiteralPath $clawoEntry)) {
    throw 'clawo is not installed. Run scripts\windows\Install-ClawOrchestrator.ps1 first.'
  }

  $process = Start-Process `
    -FilePath $node.Source `
    -ArgumentList @($clawoEntry, 'serve', '--host', $HostAddress, '--port', [string]$Port) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  Set-Content -LiteralPath $pidFile -Value ([string]$process.Id) -NoNewline

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-ClawHealth) {
      $ready = $true
      break
    }
    if ($process.HasExited) {
      break
    }
  }

  if (-not $ready) {
    $tail = if (Test-Path -LiteralPath $stderrLog) {
      (Get-Content -LiteralPath $stderrLog -Tail 30) -join [Environment]::NewLine
    } else {
      'No error log was written.'
    }
    throw "Claw Orchestrator did not become healthy. See $stderrLog`n$tail"
  }

  Write-Host "Claw Orchestrator started (PID $($process.Id))."
  Write-Host "Logs: $logRoot"
}

$tokenFile = Join-Path $HOME '.openclaw\server-token'
if (-not $NoBrowser) {
  if (Test-Path -LiteralPath $tokenFile) {
    $token = (Get-Content -Raw -LiteralPath $tokenFile).Trim()
    $encodedToken = [Uri]::EscapeDataString($token)
    $loginUrl = "http://127.0.0.1:$Port/login?token=$encodedToken&redirect=/dashboard"
    Start-Process $loginUrl
  } else {
    Write-Warning "Server is healthy, but the token file was not found at $tokenFile."
  }
}

Write-Host "Dashboard: http://127.0.0.1:$Port/dashboard"
