import { describe, it, expect } from 'bun:test';
import { parseRunLog, formatRunLog, type RunLogEntry } from '../metrics/run-log.js';

function line(entry: Record<string, unknown>): string {
  return JSON.stringify(entry);
}

describe('parseRunLog', () => {
  it('parses jsonl entries and skips malformed lines', () => {
    const content = [
      line({ runId: 'r1', date: '2026-05-01', task: 'task-1', repo: 'cli', outcome: 'success' }),
      'not json',
      '',
      line({ runId: 'r2', date: '2026-05-02', task: 'task-2', repo: 'skills', outcome: 'failed' }),
    ].join('\n');

    const entries = parseRunLog(content);
    expect(entries.map((e) => e.runId)).toEqual(['r1', 'r2']);
  });
});

function entry(over: Partial<RunLogEntry>): RunLogEntry {
  return { runId: 'r', date: '2026-05-01', task: 'task', repo: 'cli', outcome: 'success', ...over };
}

describe('formatRunLog', () => {
  it('lists recent runs across all repos, newest first', () => {
    const out = formatRunLog([
      entry({ runId: 'r1', date: '2026-05-01', task: 'task-1', repo: 'cli', outcome: 'success' }),
      entry({ runId: 'r2', date: '2026-05-02', task: 'task-2', repo: 'skills', outcome: 'failed' }),
    ]);

    // Both repos are represented (cross-repo view).
    expect(out).toContain('cli');
    expect(out).toContain('skills');
    expect(out).toContain('task-1');
    expect(out).toContain('task-2');
    // Newest run appears before the older one.
    expect(out.indexOf('task-2')).toBeLessThan(out.indexOf('task-1'));
  });

  it('reports an empty log clearly', () => {
    expect(formatRunLog([])).toContain('No runs recorded');
  });

  it('honors the limit, keeping the most recent runs', () => {
    const entries = [
      entry({ task: 'old', date: '2026-01-01' }),
      entry({ task: 'mid', date: '2026-02-01' }),
      entry({ task: 'new', date: '2026-03-01' }),
    ];
    const out = formatRunLog(entries, { limit: 2 });
    expect(out).toContain('new');
    expect(out).toContain('mid');
    expect(out).not.toContain('old');
  });

  it('filters to a single repo', () => {
    const out = formatRunLog(
      [entry({ task: 'task-cli', repo: 'cli' }), entry({ task: 'task-skills', repo: 'skills' })],
      { repo: 'cli' },
    );
    expect(out).toContain('task-cli');
    expect(out).not.toContain('task-skills');
  });
});
