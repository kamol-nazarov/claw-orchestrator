[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:LOCALAPPDATA 'ClawOrchestrator'
$pidFile = Join-Path $stateRoot 'server.pid'

if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host 'No Claw Orchestrator PID file exists. It may already be stopped.'
  exit 0
}

$processId = [int](Get-Content -Raw -LiteralPath $pidFile)
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $pidFile -Force
  Write-Host 'The recorded process is no longer running; removed the stale PID file.'
  exit 0
}

if ($process.ProcessName -notin @('node', 'node.exe')) {
  throw "Refusing to stop PID $processId because it is '$($process.ProcessName)', not Node."
}

$processDetails = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
if (-not $processDetails.CommandLine -or $processDetails.CommandLine -notmatch 'claw-orchestrator.+cli\.js.+serve') {
  throw "Refusing to stop PID $processId because its command line is not a Claw Orchestrator serve process."
}

Stop-Process -Id $processId
Remove-Item -LiteralPath $pidFile -Force
Write-Host "Stopped Claw Orchestrator (PID $processId)."
