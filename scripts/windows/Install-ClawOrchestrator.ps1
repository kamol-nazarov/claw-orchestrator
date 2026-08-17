[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 18796,

  [switch]$SkipStart
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Require-Command([string]$Name, [string]$InstallHint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "$Name was not found. $InstallHint"
  }
  return $command
}

$node = Require-Command 'node' 'Install Node.js 22 LTS or newer: https://nodejs.org/'
$npm = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if (-not $npm) {
  $npm = Require-Command 'npm' 'Install Node.js 22 LTS or newer: https://nodejs.org/'
}

$nodeMajor = [int]((& $node.Source --version).Trim().TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) {
  throw "Node.js 22 or newer is required; found $(& $node.Source --version)."
}

Write-Host "Installing dependencies in $repoRoot"
Push-Location $repoRoot
try {
  & $npm.Source ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }

  & $npm.Source run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }

  & $npm.Source install --global .
  if ($LASTEXITCODE -ne 0) { throw "npm install --global . failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Provider CLI check:'
$providers = @(
  @{ Name = 'claude'; Hint = 'Claude Code (Planner / fallback)' },
  @{ Name = 'codex'; Hint = 'Codex CLI (Reviewer)' },
  @{ Name = 'agy'; Hint = 'Antigravity CLI (fast Gemini Coder)' }
)
foreach ($provider in $providers) {
  $command = Get-Command $provider.Name -ErrorAction SilentlyContinue
  if (-not $command -and $provider.Name -eq 'agy') {
    $agyLocal = Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'
    if (Test-Path -LiteralPath $agyLocal) {
      $command = Get-Item -LiteralPath $agyLocal
      $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      $agyDir = Split-Path -Parent $agyLocal
      if (($userPath -split ';') -notcontains $agyDir) {
        [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $agyDir).TrimStart(';')), 'User')
        $env:Path = $env:Path + ';' + $agyDir
        Write-Host "  [configured] AGY added to your user PATH: $agyDir"
      }
    }
  }

  if ($command) {
    Write-Host "  [ready] $($provider.Hint)"
  } else {
    Write-Warning "Missing: $($provider.Hint). See README.md before using the recommended routing preset."
  }
}

Write-Host ''
Write-Host 'Claw Orchestrator was installed globally.'
if (-not $SkipStart) {
  & (Join-Path $PSScriptRoot 'Start-ClawOrchestrator.ps1') -Port $Port
} else {
  Write-Host "Start later with: .\scripts\windows\Start-ClawOrchestrator.ps1 -Port $Port"
}
