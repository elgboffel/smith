import { describe, it, expect } from 'bun:test';
import { createCompletionNotifier } from '../../src/notify-completion.js';

describe('completion-notifier', () => {
  it('fires the default bell + stdout line on done', () => {
    const written: string[] = [];
    const notifier = createCompletionNotifier({}, { write: (chunk) => written.push(chunk) });

    notifier.notify({ task: 'add-foo', repo: 'cli', outcome: 'done' });

    const output = written.join('');
    expect(output).toContain('\u0007'); // terminal bell
    expect(output).toContain('done');
    expect(output).toContain('add-foo');
    expect(output).toContain('cli');
  });

  it('fires the default bell + stdout line on needs-input', () => {
    const written: string[] = [];
    const notifier = createCompletionNotifier({}, { write: (chunk) => written.push(chunk) });

    notifier.notify({ task: 'add-foo', repo: 'cli', outcome: 'needs-input' });

    const output = written.join('');
    expect(output).toContain('\u0007');
    expect(output).toContain('needs-input');
  });

  it('invokes the per-project hook with the documented env vars', () => {
    const calls: Array<{ command: string; env: Record<string, string> }> = [];
    const notifier = createCompletionNotifier(
      { hook: 'notify-send' },
      { write: () => {}, runHook: (command, env) => calls.push({ command, env }) },
    );

    notifier.notify({
      task: 'add-foo',
      repo: 'cli',
      outcome: 'failed',
      branch: 'feat/add-foo',
      files: ['src/a.ts', 'src/b.ts'],
    });

    expect(calls.length).toBe(1);
    expect(calls[0].command).toBe('notify-send');
    expect(calls[0].env.SMITH_TASK).toBe('add-foo');
    expect(calls[0].env.SMITH_REPO).toBe('cli');
    expect(calls[0].env.SMITH_OUTCOME).toBe('failed');
    expect(calls[0].env.SMITH_BRANCH).toBe('feat/add-foo');
    expect(calls[0].env.SMITH_FILES).toContain('src/a.ts');
    expect(calls[0].env.SMITH_FILES).toContain('src/b.ts');
  });

  it('does not invoke a hook when none is configured', () => {
    const calls: string[] = [];
    const notifier = createCompletionNotifier({}, { write: () => {}, runHook: (command) => calls.push(command) });

    notifier.notify({ task: 'add-foo', repo: 'cli', outcome: 'done' });

    expect(calls.length).toBe(0);
  });
});
