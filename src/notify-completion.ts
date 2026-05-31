/**
 * Completion notifier — signals when a queued, walk-away run finishes or needs
 * input, so parallel-worktree runs are never invisible.
 *
 * Default channel: terminal bell + a single stdout line. Optional per-project
 * `notify` hook command (from projects/<repo>.json) invoked with documented
 * env vars. No OS-specific commands are baked in — the hook is whatever the
 * project configures — so the ast-rule banning macOS `open` stays satisfied.
 */

export type CompletionOutcome = 'done' | 'failed' | 'needs-input';

export interface CompletionEvent {
  /** Task / issue identifier. */
  task: string;
  /** Resolved project name. */
  repo: string;
  /** Run outcome. */
  outcome: CompletionOutcome;
  /** Current branch the run operated on. */
  branch?: string;
  /** Files touched by the run. */
  files?: string[];
}

export interface CompletionNotifierConfig {
  /** Per-project notify hook command. When absent, only the default channel fires. */
  hook?: string | null;
}

export interface CompletionNotifierDeps {
  /** Sink for the default bell + stdout line. Defaults to process.stdout.write. */
  write?: (chunk: string) => void;
  /** Run the per-project hook command with the documented env vars. */
  runHook?: (command: string, env: Record<string, string>) => void;
}

export interface CompletionNotifier {
  notify(event: CompletionEvent): void;
}

const BELL = '\u0007';

export function createCompletionNotifier(
  config: CompletionNotifierConfig,
  deps: CompletionNotifierDeps = {},
): CompletionNotifier {
  const write = deps.write ?? ((chunk: string) => process.stdout.write(chunk));
  const runHook = deps.runHook ?? defaultRunHook;

  return {
    notify(event) {
      // Default channel always fires so a walk-away run is never invisible.
      write(`${BELL}[smith] ${event.repo}: ${event.task} — ${event.outcome}\n`);

      // Optional per-project hook, fed the documented env vars.
      if (config.hook) {
        runHook(config.hook, buildHookEnv(event));
      }
    },
  };
}

function buildHookEnv(event: CompletionEvent): Record<string, string> {
  return {
    SMITH_TASK: event.task,
    SMITH_REPO: event.repo,
    SMITH_OUTCOME: event.outcome,
    SMITH_BRANCH: event.branch ?? '',
    SMITH_FILES: (event.files ?? []).join('\n'),
  };
}

/**
 * Spawns the configured hook command via the system shell. The command itself
 * is project-supplied — nothing OS-specific is baked in here — so the ast-rule
 * banning hardcoded macOS `open` calls stays satisfied.
 */
function defaultRunHook(command: string, env: Record<string, string>): void {
  Bun.spawn(['sh', '-c', command], {
    env: { ...process.env, ...env },
    stdout: 'inherit',
    stderr: 'inherit',
  });
}
