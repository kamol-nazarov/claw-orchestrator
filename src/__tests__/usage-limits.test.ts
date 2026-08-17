import { describe, expect, it } from 'vitest';
import { parseAgyUsage, parseClaudeUsage, parseCodexUsage } from '../usage-limits.js';

describe('authoritative usage-limit parsers', () => {
  it('parses Claude account windows as remaining percentages', () => {
    const result = parseClaudeUsage(`
Current session: 5% used · resets Aug 17, 7:10pm (America/New_York)
Current week (all models): 29% used · resets Aug 19, 1pm (America/New_York)
Current week (Fable): 29% used · resets Aug 19, 12:59pm (America/New_York)
`);

    expect(result.source).toBe('Claude Code /usage');
    expect(result.windows).toMatchObject([
      { id: 'five-hour', usedPercent: 5, remainingPercent: 95 },
      { id: 'weekly-all', usedPercent: 29, remainingPercent: 71 },
      { id: 'weekly-fable', usedPercent: 29, remainingPercent: 71 },
    ]);
  });

  it('parses only Gemini account windows from Antigravity usage', () => {
    const result = parseAgyUsage(
      [
        'Gemini Models\tWeekly Limit Remaining\t36%\t2026-08-23T03:42:31Z',
        'Gemini Models\tFive Hour Limit Remaining\t78%\t2026-08-17T21:50:00Z',
        'Claude and GPT models\tWeekly Limit Remaining\t66%\t2026-08-23T18:06:09Z',
      ].join('\n'),
    );

    expect(result.source).toBe('Antigravity /usage');
    expect(result.windows).toMatchObject([
      { id: 'weekly', remainingPercent: 36, usedPercent: 64 },
      { id: 'five-hour', remainingPercent: 78, usedPercent: 22 },
    ]);
  });

  it('prefers the Codex account bucket and converts used to remaining', () => {
    const result = parseCodexUsage({
      rateLimitsByLimitId: {
        codex: {
          planType: 'pro',
          primary: { usedPercent: 75, windowDurationMins: 10_080, resetsAt: 1_787_196_570 },
          secondary: null,
        },
      },
    });

    expect(result.plan).toBe('pro');
    expect(result.windows).toMatchObject([
      { id: 'primary', label: 'Weekly', usedPercent: 75, remainingPercent: 25 },
    ]);
  });

  it('fails closed when a provider output format is unrecognized', () => {
    expect(() => parseClaudeUsage('not usage')).toThrow(/no recognized/i);
    expect(() => parseAgyUsage('not usage')).toThrow(/no recognized/i);
    expect(() => parseCodexUsage({})).toThrow(/no codex rate-limit bucket/i);
  });
});
