import * as fs from 'node:fs';
import * as path from 'node:path';

export type IterationOutcome = 'passed' | 'rejected' | 'open' | 'error';
export type StepStatus = 'passed' | 'rejected' | 'working' | 'complete' | 'waiting' | 'error';

export interface IterationStepView {
  role: 'planner' | 'coder' | 'reviewer';
  status: StepStatus;
  model?: string;
  headline: string;
  content: string;
  contentKind: 'markdown' | 'log';
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  timingSource: 'ledger-timestamp' | 'file-mtime' | 'not-reported';
}

export interface IterationWarningView {
  code: string;
  iteration: number;
  timestamp: string | null;
  detail: string;
}

export interface AutoloopIterationView {
  iteration: number;
  outcome: IterationOutcome;
  headline: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  steps: IterationStepView[];
  warnings: IterationWarningView[];
  passingTests: number | null;
  verdict: string | null;
  metric: number | null;
}

export interface AutoloopHistoryView {
  iterations: AutoloopIterationView[];
  totals: {
    iterations: number;
    completed: number;
    rejected: number;
    passingTests: number | null;
  };
}

interface DirectiveArtifact {
  iter?: number;
  ts?: string;
  goal?: string;
}

interface EvalArtifact {
  eval_output?: { metric?: number; gates?: Array<{ name?: string; passed?: boolean; detail?: string }> };
}

interface VerdictArtifact {
  iter?: number;
  ts?: string;
  decision?: string;
  metric?: number;
  audit_notes?: string;
  flags?: string[];
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

function fileTime(file: string): string | null {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return null;
  }
}

function msBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function firstMeaningfulLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .find(Boolean) ?? ''
  );
}

function passingTestCount(text: string): number | null {
  const values: number[] = [];
  for (const match of text.matchAll(/\b(\d[\d,]*)\s+passed\b/gi)) {
    const value = Number(match[1].replaceAll(',', ''));
    if (Number.isFinite(value)) values.push(value);
  }
  return values.length ? Math.max(...values) : null;
}

function outcomeFor(verdict: VerdictArtifact | null, evalArtifact: EvalArtifact | null): IterationOutcome {
  if (!verdict) return evalArtifact ? 'open' : 'open';
  if (verdict.decision === 'advance') return 'passed';
  if (verdict.decision === 'hold' || verdict.decision === 'rollback') return 'rejected';
  return verdict.decision ? 'error' : 'open';
}

function reviewerStatus(outcome: IterationOutcome): StepStatus {
  if (outcome === 'passed') return 'passed';
  if (outcome === 'rejected') return 'rejected';
  if (outcome === 'error') return 'error';
  return 'working';
}

export function readAutoloopHistory(
  ledgerDir: string,
  models: { planner?: string; coder?: string; reviewer?: string } = {},
): AutoloopHistoryView {
  const iterRoot = path.join(ledgerDir, 'iter');
  if (!fs.existsSync(iterRoot)) {
    return { iterations: [], totals: { iterations: 0, completed: 0, rejected: 0, passingTests: null } };
  }
  const ids = fs
    .readdirSync(iterRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((a, b) => a - b);
  let previousCompletedAt: string | null = null;
  let highestPassingTests: number | null = null;
  const iterations = ids.map((iteration): AutoloopIterationView => {
    const dir = path.join(iterRoot, String(iteration));
    const directiveFile = path.join(dir, 'directive.json');
    const evalFile = path.join(dir, 'eval_output.json');
    const coderFile = path.join(dir, 'coder_summary.txt');
    const verdictFile = path.join(dir, 'verdict.json');
    const directive = readJson<DirectiveArtifact>(directiveFile);
    const evalArtifact = readJson<EvalArtifact>(evalFile);
    const verdict = readJson<VerdictArtifact>(verdictFile);
    const coderText = readText(coderFile);
    const outcome = outcomeFor(verdict, evalArtifact);
    const startedAt = directive?.ts ?? fileTime(directiveFile) ?? fileTime(dir);
    const coderCompletedAt = fileTime(evalFile) ?? fileTime(coderFile);
    const completedAt = verdict?.ts ?? fileTime(verdictFile);
    const tests = passingTestCount(coderText);
    if (tests !== null) highestPassingTests = Math.max(highestPassingTests ?? 0, tests);
    const warnings = (verdict?.flags ?? []).map((flag) => ({
      code: flag,
      iteration,
      timestamp: completedAt,
      detail: flag.replaceAll('_', ' '),
    }));
    const plannerContent = directive?.goal ?? '';
    const reviewerContent = verdict?.audit_notes ?? '';
    const steps: IterationStepView[] = [
      {
        role: 'planner',
        status: directive ? 'complete' : 'waiting',
        model: models.planner,
        headline: firstMeaningfulLine(plannerContent) || '— not reported',
        content: plannerContent,
        contentKind: 'markdown',
        startedAt: previousCompletedAt ?? startedAt,
        completedAt: startedAt,
        durationMs: msBetween(previousCompletedAt, startedAt),
        timingSource: previousCompletedAt ? 'ledger-timestamp' : 'not-reported',
      },
      {
        role: 'coder',
        status: coderText ? 'complete' : directive ? 'working' : 'waiting',
        model: models.coder,
        headline: firstMeaningfulLine(coderText) || (directive ? 'Coder turn in progress' : '— not reported'),
        content: coderText,
        contentKind: 'log',
        startedAt,
        completedAt: coderCompletedAt,
        durationMs: msBetween(startedAt, coderCompletedAt),
        timingSource: coderCompletedAt ? 'file-mtime' : 'not-reported',
      },
      {
        role: 'reviewer',
        status: reviewerStatus(outcome),
        model: models.reviewer,
        headline:
          verdict?.decision && firstMeaningfulLine(reviewerContent)
            ? `${verdict.decision} — ${firstMeaningfulLine(reviewerContent)}`
            : verdict?.decision ?? (coderText ? 'Reviewer turn in progress' : '— not reported'),
        content: reviewerContent,
        contentKind: 'markdown',
        startedAt: coderCompletedAt,
        completedAt,
        durationMs: msBetween(coderCompletedAt, completedAt),
        timingSource: completedAt ? 'ledger-timestamp' : 'not-reported',
      },
    ];
    const headline =
      outcome === 'passed'
        ? firstMeaningfulLine(coderText) || 'Iteration passed'
        : outcome === 'rejected'
          ? firstMeaningfulLine(reviewerContent) || `Reviewer ${verdict?.decision ?? 'rejected'}`
          : firstMeaningfulLine(plannerContent) || 'Iteration open';
    const view: AutoloopIterationView = {
      iteration,
      outcome,
      headline,
      startedAt,
      completedAt,
      durationMs: msBetween(startedAt, completedAt),
      steps,
      warnings,
      passingTests: tests,
      verdict: verdict?.decision ?? null,
      metric: typeof verdict?.metric === 'number' ? verdict.metric : (evalArtifact?.eval_output?.metric ?? null),
    };
    if (completedAt) previousCompletedAt = completedAt;
    return view;
  });
  return {
    iterations,
    totals: {
      iterations: iterations.length,
      completed: iterations.filter((entry) => entry.completedAt !== null).length,
      rejected: iterations.filter((entry) => entry.outcome === 'rejected').length,
      passingTests: highestPassingTests,
    },
  };
}
