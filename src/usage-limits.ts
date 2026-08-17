import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as readline from 'node:readline';

export type UsageProvider = 'codex' | 'claude' | 'gemini';

export interface UsageLimitWindow {
  id: string;
  label: string;
  remainingPercent: number;
  usedPercent: number;
  resetsAt: string | null;
  resetsLabel: string;
  windowDurationMins?: number | null;
}

export interface ProviderUsageLimits {
  provider: UsageProvider;
  status: 'ok' | 'unavailable';
  source: string;
  fetchedAt: string;
  plan?: string | null;
  windows: UsageLimitWindow[];
  error?: string;
}

export interface UsageLimitsSnapshot {
  ok: true;
  scope: 'account-subscription';
  fetchedAt: string;
  providers: ProviderUsageLimits[];
}

const CACHE_MS = 60_000;
let cached: { at: number; value: UsageLimitsSnapshot } | null = null;
let inFlight: Promise<UsageLimitsSnapshot> | null = null;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unavailable(provider: UsageProvider, source: string, error: unknown): ProviderUsageLimits {
  return {
    provider,
    status: 'unavailable',
    source,
    fetchedAt: new Date().toISOString(),
    windows: [],
    error: error instanceof Error ? error.message : String(error),
  };
}

function executable(envName: string, fallback: string): string {
  const configured = process.env[envName]?.trim();
  if (configured) return configured;
  if (process.platform === 'win32' && !fallback.endsWith('.exe')) return fallback + '.cmd';
  return fallback;
}

function collectCommand(bin: string, args: string[], timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // best effort
      }
      finish(() => reject(new Error('usage command timed out after ' + timeoutMs + 'ms')));
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', (err) => finish(() => reject(err)));
    child.once('close', (code) => {
      if (code === 0) {
        finish(() => resolve(stdout));
      } else {
        finish(() =>
          reject(new Error((stderr || stdout || 'usage command exited ' + code).trim().slice(0, 500))),
        );
      }
    });
  });
}

export function parseClaudeUsage(text: string): ProviderUsageLimits {
  const patterns: Array<{ id: string; label: string; regex: RegExp }> = [
    {
      id: 'five-hour',
      label: 'Five hour (current session)',
      regex: /^Current session:\s*(\d+)% used\s*·\s*resets (.+)$/im,
    },
    {
      id: 'weekly-all',
      label: 'Weekly (all models)',
      regex: /^Current week \(all models\):\s*(\d+)% used\s*·\s*resets (.+)$/im,
    },
    {
      id: 'weekly-fable',
      label: 'Weekly (Fable)',
      regex: /^Current week \(Fable\):\s*(\d+)% used\s*·\s*resets (.+)$/im,
    },
  ];
  const windows: UsageLimitWindow[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (!match) continue;
    const usedPercent = clampPercent(Number(match[1]));
    windows.push({
      id: pattern.id,
      label: pattern.label,
      remainingPercent: 100 - usedPercent,
      usedPercent,
      resetsAt: null,
      resetsLabel: match[2].trim(),
    });
  }
  if (!windows.length) throw new Error('Claude /usage returned no recognized account limit windows');
  return {
    provider: 'claude',
    status: 'ok',
    source: 'Claude Code /usage',
    fetchedAt: new Date().toISOString(),
    windows,
  };
}

export function parseAgyUsage(text: string): ProviderUsageLimits {
  const windows: UsageLimitWindow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw
      .split('\t')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 4 || parts[0] !== 'Gemini Models') continue;
    const remainingMatch = parts[2].match(/^(\d+)%$/);
    if (!remainingMatch) continue;
    const remainingPercent = clampPercent(Number(remainingMatch[1]));
    const weekly = /weekly/i.test(parts[1]);
    windows.push({
      id: weekly ? 'weekly' : 'five-hour',
      label: weekly ? 'Weekly' : 'Five hour',
      remainingPercent,
      usedPercent: 100 - remainingPercent,
      resetsAt: Number.isNaN(Date.parse(parts[3])) ? null : new Date(parts[3]).toISOString(),
      resetsLabel: parts[3],
    });
  }
  if (!windows.length) throw new Error('Antigravity /usage returned no recognized Gemini limit windows');
  return {
    provider: 'gemini',
    status: 'ok',
    source: 'Antigravity /usage',
    fetchedAt: new Date().toISOString(),
    windows,
  };
}

interface CodexRateWindow {
  usedPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
}

interface CodexRateSnapshot {
  planType?: string | null;
  primary?: CodexRateWindow | null;
  secondary?: CodexRateWindow | null;
}

interface CodexRateResponse {
  rateLimits?: CodexRateSnapshot;
  rateLimitsByLimitId?: Record<string, CodexRateSnapshot> | null;
}

function readCodexRateLimits(timeoutMs = 20_000): Promise<CodexRateResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable('CODEX_BIN', 'codex'), ['app-server', '--stdio'], {
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const initId = 'init-' + randomUUID();
    const readId = 'usage-' + randomUUID();
    let settled = false;
    let stderr = '';
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.close();
      try {
        child.kill();
      } catch {
        // best effort
      }
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('Codex rate-limit query timed out after ' + timeoutMs + 'ms'))),
      timeoutMs,
    );
    timer.unref?.();
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const reader = readline.createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      let message: { id?: string; result?: CodexRateResponse; error?: { message?: string } };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        return;
      }
      if (message.id === initId) {
        child.stdin.write(JSON.stringify({ id: readId, method: 'account/rateLimits/read', params: {} }) + '\n');
      } else if (message.id === readId) {
        if (message.error) {
          finish(() => reject(new Error(message.error?.message ?? 'Codex rate-limit query failed')));
        } else {
          finish(() => resolve(message.result ?? {}));
        }
      }
    });
    child.once('error', (err) => finish(() => reject(err)));
    child.once('close', (code) => {
      if (!settled) {
        finish(() => reject(new Error((stderr || 'Codex app-server exited ' + code).trim().slice(0, 500))));
      }
    });
    child.stdin.write(
      JSON.stringify({
        id: initId,
        method: 'initialize',
        params: {
          clientInfo: { name: 'claw-orchestrator-usage', version: '1.0' },
          capabilities: { experimentalApi: true },
        },
      }) + '\n',
    );
  });
}

export function parseCodexUsage(payload: CodexRateResponse): ProviderUsageLimits {
  const snapshot = payload.rateLimitsByLimitId?.codex ?? payload.rateLimits;
  if (!snapshot) throw new Error('Codex app-server returned no codex rate-limit bucket');
  const windows: UsageLimitWindow[] = [];
  const addWindow = (id: string, label: string, window: CodexRateWindow | null | undefined): void => {
    if (!window) return;
    const usedPercent = clampPercent(window.usedPercent);
    windows.push({
      id,
      label,
      usedPercent,
      remainingPercent: 100 - usedPercent,
      resetsAt: window.resetsAt ? new Date(window.resetsAt * 1000).toISOString() : null,
      resetsLabel: window.resetsAt ? new Date(window.resetsAt * 1000).toISOString() : 'Reset time unavailable',
      windowDurationMins: window.windowDurationMins,
    });
  };
  addWindow('primary', snapshot.primary?.windowDurationMins === 10_080 ? 'Weekly' : 'Primary', snapshot.primary);
  addWindow('secondary', 'Secondary', snapshot.secondary);
  if (!windows.length) throw new Error('Codex app-server returned no active rate-limit windows');
  return {
    provider: 'codex',
    status: 'ok',
    source: 'Codex app-server account/rateLimits/read',
    fetchedAt: new Date().toISOString(),
    plan: snapshot.planType ?? null,
    windows,
  };
}

async function fetchProvider(provider: UsageProvider): Promise<ProviderUsageLimits> {
  if (provider === 'codex') return parseCodexUsage(await readCodexRateLimits());
  if (provider === 'claude') {
    const output = await collectCommand(executable('CLAUDE_BIN', 'claude'), [
      '-p',
      '/usage',
      '--output-format',
      'text',
    ]);
    return parseClaudeUsage(output);
  }
  const output = await collectCommand(
    executable('AGY_BIN', 'agy'),
    ['-p', '/usage', '--output-format', 'text', '--print-timeout', '30s'],
    40_000,
  );
  return parseAgyUsage(output);
}

export async function getUsageLimits(force = false): Promise<UsageLimitsSnapshot> {
  const now = Date.now();
  if (!force && cached && now - cached.at < CACHE_MS) return cached.value;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const providers = await Promise.all(
      (['codex', 'claude', 'gemini'] as UsageProvider[]).map(async (provider) => {
        const source =
          provider === 'codex'
            ? 'Codex app-server account/rateLimits/read'
            : provider === 'claude'
              ? 'Claude Code /usage'
              : 'Antigravity /usage';
        try {
          return await fetchProvider(provider);
        } catch (err) {
          return unavailable(provider, source, err);
        }
      }),
    );
    const value: UsageLimitsSnapshot = {
      ok: true,
      scope: 'account-subscription',
      fetchedAt: new Date().toISOString(),
      providers,
    };
    cached = { at: Date.now(), value };
    return value;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
