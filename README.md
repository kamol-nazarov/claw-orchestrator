<p align="center">
  <img src="./assets/banner.jpg" alt="Claw Orchestrator" width="100%">
</p>

# Claw Orchestrator — Organic Operator Console fork

This fork turns Claude Code, Codex, and Antigravity into one visible Planner → Coder → Reviewer workflow. It adds a five-screen operator console, live role status and CLI output, real provider quota windows, resumable Autoloops, and a Windows-first installer.

The original project is [Enderfga/claw-orchestrator](https://github.com/Enderfga/claw-orchestrator). This fork preserves its multi-engine runtime and adds the operator experience documented below.

## What this fork adds

- Organic operator console at `http://127.0.0.1:18796/dashboard`.
- Autoloop iteration history, warnings, test totals, pause/resume, directives, and real-time Planner/Coder/Reviewer activity.
- Live CLI streams for every active role.
- Provider usage cards for the five-hour and weekly windows actually reported by Claude, Codex, and Antigravity. Missing provider data is shown as unavailable; the console does not invent percentages.
- Sessions, Councils, Forge, and Models screens backed by the real server contracts.
- Model registry entries for Claude Opus 5/Sonnet 5, GPT-5.6 Sol/Terra/Luna, and Antigravity Gemini 3.7 Flash variants.
- Recommended routing presets in the **New Autoloop** dialog.
- Windows-safe builds and PowerShell install/start/stop helpers.
- Compatibility routes: `/dashboard/prototype` for the previous dark console and `/dashboard/legacy` for the upstream dashboard.

## Fastest Windows setup

### 1. Install prerequisites

Install:

- Windows 10 or 11.
- [Git for Windows](https://git-scm.com/download/win).
- [Node.js](https://nodejs.org/) 22 or newer, including npm.
- At least one coding-agent CLI. Install all three to use the recommended routing:
  - Claude Code (`claude`) for the Planner.
  - Antigravity (`agy`) for the fast Gemini Coder.
  - Codex CLI (`codex`) for the independent Reviewer.

Check the base tools in PowerShell:

```powershell
git --version
node --version
npm --version
```

### 2. Authenticate the three engines

#### Claude Code

Anthropic's native Windows installer:

```powershell
irm https://claude.ai/install.ps1 | iex
```

WinGet alternative:

```powershell
winget install Anthropic.ClaudeCode
```

Then run `claude` and complete browser sign-in. Verify with:

```powershell
claude --version
claude auth status
```

See Anthropic's official [setup](https://code.claude.com/docs/en/setup) and [authentication](https://code.claude.com/docs/en/authentication) guides.

#### Codex CLI

```powershell
npm install -g @openai/codex
codex login
codex --version
```

Use the ChatGPT sign-in flow if your Codex access is subscription-backed. The exact model IDs exposed to Codex depend on your account and installed CLI version.

#### Antigravity / AGY

Install Antigravity and its CLI through the Google distribution available to your account. Once `agy.exe` exists, configure its PATH integration and sign in interactively:

```powershell
agy install
agy
agy models
```

If Antigravity installed the binary but PowerShell cannot find it, this fork's installer detects the common location `%LOCALAPPDATA%\agy\bin\agy.exe` and adds that directory to your user PATH.

`gemini-3.7-flash-medium` is an Antigravity model identifier verified with the AGY engine used by this fork. It may be an account-specific identifier or alias, so `agy models` is the authority on a newly installed computer.

### 3. Clone and install this fork

```powershell
git clone --branch feat/organic-operator-console https://github.com/kamol-nazarov/claw-orchestrator.git
cd claw-orchestrator
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Install-ClawOrchestrator.ps1
```

The installer:

1. validates Node.js 22+;
2. runs the locked dependency install;
3. builds the package;
4. installs `clawo`, `clawo-mcp`, and `clawo-acp` globally;
5. checks the three provider CLIs;
6. starts Claw on `127.0.0.1:18796` in a hidden process;
7. opens an authenticated dashboard URL in your browser.

No provider credential or dashboard token is written into this repository. The local server token lives at `%USERPROFILE%\.openclaw\server-token`.

To install without starting the server:

```powershell
.\scripts\windows\Install-ClawOrchestrator.ps1 -SkipStart
```

## Start your first Autoloop

1. Open `http://127.0.0.1:18796/dashboard`.
2. Select **Autoloops** and click **New run**.
3. Enter the absolute repository path, for example `C:\Dev\VehicleDesk`.
4. Leave the routing preset on **Best balance**.
5. Give the Planner a goal, required outcomes, scope fence, and verification gates.
6. Approve its plan before allowing source edits when the repository is sensitive.

The recommended preset sends:

```text
Planner:  claude / claude-opus-5
Coder:    agy    / gemini-3.7-flash-medium
Reviewer: codex  / gpt-5.6-sol
```

The dashboard sends those exact engine/model values to the Autoloop API. It does not route them through an Anthropic-compatible proxy.

### Copy-ready first directive

```text
Inspect this repository read-only first. State the current branch, HEAD, working-tree
changes, and any protected or untracked files. Then propose a bounded implementation
plan for the following goal:

GOAL:
<describe the concrete outcome>

REQUIRED OUTCOMES:
1. <observable result>
2. <observable result>
3. <observable result>

SAFETY:
- Preserve all pre-existing user work.
- Do not reset, stash, clean, amend, force-push, deploy, or contact external systems.
- Use an isolated worktree if implementation begins.
- Stop for approval after the plan and before source changes.

GATES:
- Add or update regression tests for the requested behavior.
- Run targeted tests, typecheck, and build.
- Have the independent Reviewer inspect the exact final diff and reproduce the gates.
- Report exact changed files, commands, results, unresolved risks, branch, and commit SHA.
```

## Best model routing

The best default is role specialization, not asking the most expensive model to do every token of work.

| Role | Default | Why |
| --- | --- | --- |
| Planner / orchestrator | `claude-opus-5`, high effort | Holds the goal, scope fence, sequencing, and acceptance gates. Spend premium reasoning here because planning errors multiply downstream. |
| Coder / implementer | `gemini-3.7-flash-medium` through `agy` | Fast implementation and test iteration. It consumes the separate Gemini/Antigravity allowance instead of draining Claude or Codex. |
| Reviewer / adversary | `gpt-5.6-sol`, high or xhigh effort | Fresh provider and context for final-diff review. OpenAI describes Sol as the flagship coding model; use high for normal reviews and xhigh for difficult security or concurrency work. |

OpenAI's current model guidance positions [GPT-5.6 Sol](https://developers.openai.com/api/docs/guides/latest-model) as the flagship, Terra as the balance of capability/cost, and Luna for high-volume work. In this harness, Sol is therefore the preferred Reviewer; it is not the default Coder because Gemini Flash provides the speed and quota separation you are trying to exploit.

### Fallback routes

| Situation | Planner | Coder | Reviewer |
| --- | --- | --- | --- |
| Recommended | Opus 5 | Gemini 3.7 Flash medium | GPT-5.6 Sol |
| Gemini five-hour or weekly window exhausted | Opus 5 | Sonnet 5 | GPT-5.6 Sol |
| Codex window nearly exhausted | Opus 5 | Gemini 3.7 Flash medium | Sonnet 5, with a later Sol final review |
| Claude window nearly exhausted | Sonnet 5 | Gemini 3.7 Flash medium | GPT-5.6 Sol |
| Maximum compatibility | Opus 5 | Sonnet 5 | Opus 5 |

Keep the Reviewer on a different provider whenever possible. A same-provider fallback is useful for continuity, but it is less independent and should not be the only final review on security-sensitive work.

### Reasoning-effort guidance

- Planner: `high` by default; use the highest available tier only for architecture, migrations, auth, security, or concurrency.
- Coder: `medium` for normal implementation; raise it only after a concrete failure or difficult refactor.
- Reviewer: `high`; use `xhigh` for final release, security, data integrity, or race-condition audits.
- Do not run maximum effort continuously. It spends quota on routine file discovery and test loops that Flash or Sonnet can do more efficiently.

## Usage limits in the dashboard

The console refreshes provider usage frequently and labels the source:

- Codex: `account/rateLimits/read` from the authenticated Codex CLI.
- Claude: `/usage` from the authenticated Claude Code session.
- Gemini: `/usage` from Antigravity/AGY.

Five-hour and weekly windows appear only when the provider reports them. A missing five-hour limit is shown as **not reported**, not calculated from the weekly bar. Subscription dashboards remain the billing authority; Claw's cards are operational routing signals.

## Everyday commands

From the cloned repository:

```powershell
# Start and open the dashboard
.\scripts\windows\Start-ClawOrchestrator.ps1

# Start without opening a browser
.\scripts\windows\Start-ClawOrchestrator.ps1 -NoBrowser

# Stop the background server started by the helper
.\scripts\windows\Stop-ClawOrchestrator.ps1

# Confirm health
Invoke-RestMethod http://127.0.0.1:18796/health
```

Manual foreground start, useful for diagnostics:

```powershell
clawo serve --host 127.0.0.1 --port 18796
```

Logs from the background helper are stored under `%LOCALAPPDATA%\ClawOrchestrator\logs`.

### Update the fork

Preserve local work before updating. From a clean clone:

```powershell
git pull --ff-only
.\scripts\windows\Stop-ClawOrchestrator.ps1
.\scripts\windows\Install-ClawOrchestrator.ps1
```

## Manual and non-Windows installation

The build is cross-platform:

```bash
git clone --branch feat/organic-operator-console https://github.com/kamol-nazarov/claw-orchestrator.git
cd claw-orchestrator
npm ci
npm run build
npm install -g .
clawo serve --host 127.0.0.1 --port 18796
```

Node.js 22+ is required. On Linux, install and authenticate the provider CLIs for the same user account that runs `clawo`; otherwise the background process will not see their credentials.

## Private remote access with Tailscale

Keep Claw bound to `127.0.0.1`. On the host, expose that local service only through your tailnet using Tailscale Serve, then open the HTTPS tailnet URL from another authorized device. Do not use Tailscale Funnel unless you intentionally want public internet exposure.

Before enabling Serve, confirm both devices are in the same tailnet and restrict access with Tailscale ACLs/grants. The dashboard still requires Claw's token cookie in addition to tailnet access.

## Security and repository safety

- Default bind address is loopback. Do not bind `0.0.0.0` on an untrusted network.
- Server authentication is enabled by default. Never commit `%USERPROFILE%\.openclaw\server-token`.
- Provider login tokens remain in the provider CLIs' own user profiles.
- Autoloop writes its ledger under `<workspace>\tasks\<run-id>`. Add an appropriate repository ignore rule if the ledger must remain local.
- Give the Planner a scope fence and require exact-diff review before commits or pushes.
- Use worktrees for isolated implementation. Never let an automated loop reset, clean, stash, amend, force-push, deploy, or mutate production unless you have explicitly authorized that action.

## Troubleshooting

### Dashboard returns 401

Use the start helper so it reads the local token and opens the one-time login URL:

```powershell
.\scripts\windows\Start-ClawOrchestrator.ps1
```

If the server is already running, stop/start it or manually read `%USERPROFILE%\.openclaw\server-token` and visit `/login?token=<token>&redirect=/dashboard`. Do not paste that URL into tickets or chat logs.

### `agy` is not recognized

Run the installer again or add `%LOCALAPPDATA%\agy\bin` to your user PATH, open a new PowerShell window, then run:

```powershell
agy install
agy
agy models
```

### A model identifier fails

Provider availability changes independently of Claw. Check the native CLI first:

```powershell
claude --version
codex --version
agy models
```

If `gemini-3.7-flash-medium` is absent, choose an identifier printed by `agy models` and use the explicit engine/model API fields. If `gpt-5.6-sol` is absent, use Terra or another model the installed Codex CLI exposes.

### Provider usage looks wrong

Open the provider's own subscription usage page and compare timestamps/reset windows. Claw reports CLI data; it cannot infer account-wide usage that the CLI does not return. Reload the Models screen after re-authenticating a provider.

### Server does not start

Check:

```powershell
Get-Content "$env:LOCALAPPDATA\ClawOrchestrator\logs\server.stderr.log" -Tail 100
Get-NetTCPConnection -LocalPort 18796 -ErrorAction SilentlyContinue
```

Use a different port if another process owns `18796`:

```powershell
.\scripts\windows\Start-ClawOrchestrator.ps1 -Port 18797
```

## Development and verification

```powershell
npm ci
npm run build
npm run lint
npm run format:check
npm test
```

The operator-console work has targeted coverage for usage parsing, model registry output, ledger history, resume state, session lifecycle streaming, and multi-engine council launch. Some upstream tests encode POSIX-only path or process assumptions and can fail on Windows even when the Windows runtime path is healthy; investigate failures rather than suppressing them.

## Other integration modes

Standalone sessions:

```powershell
clawo session-start fix-tests --engine claude --cwd C:\Dev\Repository
clawo session-send fix-tests "Fix the failing tests"
```

MCP server:

```powershell
clawo-mcp
```

ACP agent:

```powershell
clawo acp
```

The upstream reference documentation remains under [`skills/references`](./skills/references), including sessions, multi-engine routing, councils, Autoloop, Forge/Ultraapp, CLI, MCP, and ACP.

## License and attribution

MIT — see [`LICENSE`](./LICENSE). Original project by Enderfga; operator-console fork maintained separately.
