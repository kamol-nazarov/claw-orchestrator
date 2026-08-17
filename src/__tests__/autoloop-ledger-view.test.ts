import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readAutoloopHistory } from '../autoloop/ledger-view.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const ledger = fs.mkdtempSync(path.join(os.tmpdir(), 'clawo-ledger-view-'));
  roots.push(ledger);
  return ledger;
}

describe('Autoloop ledger view', () => {
  it('builds real iteration steps, rejection warnings, timings, and test totals from artifacts', () => {
    const ledger = fixture();
    const iter = path.join(ledger, 'iter', '4');
    fs.mkdirSync(iter, { recursive: true });
    fs.writeFileSync(
      path.join(iter, 'directive.json'),
      JSON.stringify({ iter: 4, ts: '2026-08-17T19:20:00.000Z', goal: 'Fix the comparison harness.' }),
    );
    fs.writeFileSync(path.join(iter, 'coder_summary.txt'), 'Implemented parity smoke test\n1075 passed');
    fs.writeFileSync(path.join(iter, 'eval_output.json'), JSON.stringify({ eval_output: { metric: 1 } }));
    fs.writeFileSync(
      path.join(iter, 'verdict.json'),
      JSON.stringify({
        iter: 4,
        ts: '2026-08-17T19:32:00.000Z',
        decision: 'hold',
        metric: 1,
        audit_notes: 'G7 FAIL — count pass-through remains.',
        flags: ['summary_count_privacy_bypass'],
      }),
    );

    const result = readAutoloopHistory(ledger, {
      planner: 'claude-opus-5',
      coder: 'gemini-3.7-flash-medium',
      reviewer: 'gpt-5.6-sol',
    });

    expect(result.totals).toMatchObject({ iterations: 1, completed: 1, rejected: 1, passingTests: 1075 });
    expect(result.iterations[0]).toMatchObject({
      iteration: 4,
      outcome: 'rejected',
      verdict: 'hold',
      passingTests: 1075,
      warnings: [{ code: 'summary_count_privacy_bypass', iteration: 4 }],
      steps: [
        { role: 'planner', model: 'claude-opus-5', content: 'Fix the comparison harness.' },
        { role: 'coder', model: 'gemini-3.7-flash-medium', contentKind: 'log' },
        { role: 'reviewer', model: 'gpt-5.6-sol', status: 'rejected' },
      ],
    });
  });

  it('returns an honest empty state when no iteration artifacts exist', () => {
    expect(readAutoloopHistory(fixture())).toEqual({
      iterations: [],
      totals: { iterations: 0, completed: 0, rejected: 0, passingTests: null },
    });
  });
});
