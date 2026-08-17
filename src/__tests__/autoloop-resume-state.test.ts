import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recoverAutoloopLedgerState } from '../session-manager.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Autoloop ledger resume state', () => {
  it('restores the next iteration and metric history from completed verdicts', () => {
    const ledger = fs.mkdtempSync(path.join(os.tmpdir(), 'autoloop-resume-'));
    roots.push(ledger);
    for (let iter = 0; iter <= 4; iter++) {
      const dir = path.join(ledger, 'iter', String(iter));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'verdict.json'),
        JSON.stringify({ schema_version: 1, iter, decision: iter === 4 ? 'hold' : 'advance', metric: iter }),
      );
    }

    expect(recoverAutoloopLedgerState(ledger)).toMatchObject({
      iter: 5,
      hadSubagents: true,
      metricHistory: [0, 1, 2, 3, 4],
    });
  });

  it('resumes an incomplete latest iteration without advancing or overwriting it', () => {
    const ledger = fs.mkdtempSync(path.join(os.tmpdir(), 'autoloop-resume-incomplete-'));
    roots.push(ledger);
    const completed = path.join(ledger, 'iter', '4');
    const incomplete = path.join(ledger, 'iter', '5');
    fs.mkdirSync(completed, { recursive: true });
    fs.mkdirSync(incomplete, { recursive: true });
    fs.writeFileSync(path.join(completed, 'verdict.json'), JSON.stringify({ iter: 4, metric: 9 }));
    fs.writeFileSync(path.join(incomplete, 'directive.json'), JSON.stringify({ iter: 5 }));

    expect(recoverAutoloopLedgerState(ledger)).toMatchObject({
      iter: 5,
      hadSubagents: true,
      metricHistory: [9],
    });
  });

  it('keeps a never-spawned run in planning at iteration zero', () => {
    const ledger = fs.mkdtempSync(path.join(os.tmpdir(), 'autoloop-resume-empty-'));
    roots.push(ledger);
    expect(recoverAutoloopLedgerState(ledger)).toEqual({
      iter: 0,
      hadSubagents: false,
      metricHistory: [],
      lastActivityAt: 0,
    });
  });
});
