import { describe, test, expect } from 'bun:test';
import {
  formatDuration,
  formatHeartbeat,
  formatHeartbeatWhimsy,
  formatPhaseEnd,
  formatPhaseHeader,
  formatPipelineComplete,
  formatStepIndicator,
  formatTokenCount,
  formatToolLine,
} from '../render/format.js';

describe('formatDuration', () => {
  test('returns <1s for 0ms', () => {
    expect(formatDuration(0)).toBe('<1s');
  });

  test('returns <1s for 999ms', () => {
    expect(formatDuration(999)).toBe('<1s');
  });

  test('returns Ns for 1000ms', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  test('returns Ns for 59999ms', () => {
    expect(formatDuration(59_999)).toBe('59s');
  });

  test('returns Nm Ss boundary at 60000ms', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
  });

  test('formats minutes and seconds', () => {
    expect(formatDuration(102_000)).toBe('1m 42s');
  });
});

describe('formatPhaseHeader', () => {
  test('starts with arrow icon and includes phase+agent', () => {
    const out = formatPhaseHeader('implement', 'implementer');
    expect(out.startsWith('▶ implement (implementer)')).toBe(true);
  });

  test('pads to fixed width with separator', () => {
    const out = formatPhaseHeader('implement', 'implementer');
    expect(out.length).toBe(60);
    expect(out.includes('─')).toBe(true);
  });
});

describe('formatPhaseEnd', () => {
  test('uses ✓ for completed', () => {
    const out = formatPhaseEnd('implement', 'implementer', 102_000, 'completed');
    expect(out.startsWith('✓ implement completed')).toBe(true);
    expect(out.endsWith('1m 42s')).toBe(true);
  });

  test('uses ✗ for failed', () => {
    const out = formatPhaseEnd('implement', 'implementer', 102_000, 'failed');
    expect(out.startsWith('✗ implement failed')).toBe(true);
    expect(out.endsWith('1m 42s')).toBe(true);
  });

  test('shows shortened model + effort when provided', () => {
    const out = formatPhaseEnd('implement', 'implementer', 102_000, 'completed', 120_000, 'claude-sonnet-4-5-20250929', 'high');
    expect(out).toContain('(sonnet-4-5 high)');
    expect(out).toContain('120.0k ctx');
    expect(out.endsWith('1m 42s')).toBe(true);
  });
});

describe('formatToolLine', () => {
  test('renders tool name + args without duration', () => {
    expect(formatToolLine('Read', 'src/auth/handler.ts')).toBe('    ↳ Read src/auth/handler.ts');
  });

  test('renders tool name + args + duration right-aligned', () => {
    const out = formatToolLine('Read', 'src/auth/handler.ts', 2000);
    expect(out.startsWith('    ↳ Read src/auth/handler.ts')).toBe(true);
    expect(out.endsWith('2s')).toBe(true);
  });

  test('handles empty args', () => {
    expect(formatToolLine('Bash', '')).toBe('    ↳ Bash');
  });

  test('handles long args (no truncation in phase 1)', () => {
    const longArg = 'a/very/long/path/that/exceeds/the/normal/width/of/the/terminal.ts';
    const out = formatToolLine('Read', longArg);
    expect(out.includes(longArg)).toBe(true);
  });
});

describe('formatStepIndicator', () => {
  test('renders with no completed phases', () => {
    const out = formatStepIndicator([], 'implement', ['verify', 'review', 'close', 'retro']);
    expect(out).toBe('[1/5] ○ implement → · verify → · review → · close → · retro');
  });

  test('renders with active in middle', () => {
    const out = formatStepIndicator(['implement', 'verify'], 'review', ['close', 'retro']);
    expect(out).toBe('[3/5] ✓ implement → ✓ verify → ○ review → · close → · retro');
  });

  test('renders with all completed (no active)', () => {
    const out = formatStepIndicator(['implement', 'verify', 'review', 'close', 'retro'], '', []);
    expect(out.startsWith('[5/5]')).toBe(true);
    expect(out.includes('✓ retro')).toBe(true);
  });
});

describe('formatHeartbeat', () => {
  test('renders thinking line with elapsed duration', () => {
    expect(formatHeartbeat(34_000)).toBe('    ··· thinking (34s)');
  });

  test('handles sub-second elapsed', () => {
    expect(formatHeartbeat(500)).toBe('    ··· thinking (<1s)');
  });
});

describe('formatHeartbeatWhimsy', () => {
  test('tickCount 0 → "thinking..."', () => {
    expect(formatHeartbeatWhimsy(10_000, 0)).toBe('    ··· thinking... (10s)');
  });

  test('tickCount 1 → "pondering..."', () => {
    expect(formatHeartbeatWhimsy(10_000, 1)).toBe('    ··· pondering... (10s)');
  });

  test('tickCount 14 → "reticulating splines..."', () => {
    expect(formatHeartbeatWhimsy(10_000, 14)).toBe('    ··· reticulating splines... (10s)');
  });

  test('tickCount 15 wraps to "thinking..."', () => {
    expect(formatHeartbeatWhimsy(10_000, 15)).toBe('    ··· thinking... (10s)');
  });

  test('tickCount 29 wraps to "reticulating splines..." again', () => {
    // 29 % 15 === 14
    expect(formatHeartbeatWhimsy(10_000, 29)).toBe('    ··· reticulating splines... (10s)');
  });

  test('elapsed sub-second renders <1s', () => {
    expect(formatHeartbeatWhimsy(500, 0)).toBe('    ··· thinking... (<1s)');
  });

  test('elapsed minutes+seconds formats correctly', () => {
    expect(formatHeartbeatWhimsy(102_000, 0)).toBe('    ··· thinking... (1m 42s)');
  });

  test('negative tickCount is handled gracefully', () => {
    // Defensive: -1 should not crash and should land on a real message.
    const out = formatHeartbeatWhimsy(10_000, -1);
    expect(out.startsWith('    ··· ')).toBe(true);
    expect(out.endsWith(' (10s)')).toBe(true);
  });
});

describe('formatTokenCount', () => {
  test('sub-thousand renders as a bare integer', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
  });

  test('thousands render with one decimal and k suffix', () => {
    expect(formatTokenCount(1000)).toBe('1.0k');
    expect(formatTokenCount(12_345)).toBe('12.3k');
  });

  test('millions render with two decimals and M suffix', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.00M');
    expect(formatTokenCount(1_240_000)).toBe('1.24M');
  });
});

describe('formatPipelineComplete', () => {
  const rows = [
    { phase: 'scout', durationMs: 192_000, contextTokens: 47_000 },
    { phase: 'implement', durationMs: 604_000, contextTokens: 120_000 },
    { phase: 'close', durationMs: 45_000, contextTokens: 30_000 },
  ];

  test('header shows N/N and right-aligned total time', () => {
    const lines = formatPipelineComplete(rows, 841_000);
    expect(lines[0].startsWith('✓ Pipeline complete [3/3]')).toBe(true);
    expect(lines[0].endsWith('14m 1s')).toBe(true);
  });

  test('one indented row per phase with aligned duration + context columns', () => {
    const lines = formatPipelineComplete(rows, 841_000);
    expect(lines.slice(1)).toEqual([
      '    scout       3m 12s    47.0k ctx',
      '    implement   10m 4s   120.0k ctx',
      '    close          45s    30.0k ctx',
    ]);
    // Columns align: every row is the same width.
    const widths = new Set(lines.slice(1).map((l) => l.length));
    expect(widths.size).toBe(1);
  });

  test('empty rows yields just the header', () => {
    const lines = formatPipelineComplete([], 0);
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('✓ Pipeline complete [0/0]')).toBe(true);
  });

  test('adds model + effort columns when rows carry them', () => {
    const withMeta = [
      { phase: 'scout', durationMs: 192_000, contextTokens: 47_000, model: 'claude-sonnet-4-5-20250929', effort: 'high' },
      { phase: 'implement', durationMs: 604_000, contextTokens: 120_000, model: 'claude-sonnet-4-5-20250929', effort: 'medium' },
    ];
    const lines = formatPipelineComplete(withMeta, 796_000);
    expect(lines[1]).toContain('sonnet-4-5');
    expect(lines[1]).toContain('high');
    expect(lines[2]).toContain('medium');
    // Columns still align across rows.
    const widths = new Set(lines.slice(1).map((l) => l.length));
    expect(widths.size).toBe(1);
  });
});
