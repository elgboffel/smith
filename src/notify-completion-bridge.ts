/**
 * Bridge between the pipeline runtime and the pure completion notifier.
 *
 * Derives a CompletionEvent from the PipelineConfig + run outcome — resolving
 * the per-project notify hook, current branch, and touched files best-effort —
 * then fires the notifier. Kept separate from `notify-completion.ts` so that
 * module stays pure and hermetically testable.
 */
import { basename } from 'node:path';
import type { CompletionOutcome } from './notify-completion.js';
import { createCompletionNotifier } from './notify-completion.js';
import type { PipelineConfig } from './types.js';

/** Human-friendly task label, preferring the source issue filename. */
function taskLabel(config: PipelineConfig): string {
  const source = config.issuePath ?? config.taskMdPath ?? config.taskJsonPath;
  return source ? basename(source).replace(/\.(md|json)$/, '') : config.repoName;
}

/** Read the project's notify hook command, if configured. */
function resolveHook(config: PipelineConfig): string | null {
  const notify = config.project?.notify;
  if (!notify) return null;
  const hook = (notify as Record<string, unknown>).hook ?? (notify as Record<string, unknown>).command;
  return typeof hook === 'string' && hook.length > 0 ? hook : null;
}

/** Best-effort current branch via git; empty string when unavailable. */
function currentBranch(cwd: string): string {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    return proc.success ? new TextDecoder().decode(proc.stdout).trim() : '';
  } catch {
    return '';
  }
}

/** Best-effort list of files changed in the last commit; empty when unavailable. */
function changedFiles(cwd: string): string[] {
  try {
    const proc = Bun.spawnSync(['git', 'diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd });
    if (!proc.success) return [];
    return new TextDecoder()
      .decode(proc.stdout)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

export function notifyRunCompletion(config: PipelineConfig, outcome: CompletionOutcome): void {
  const notifier = createCompletionNotifier({ hook: resolveHook(config) });
  notifier.notify({
    task: taskLabel(config),
    repo: config.repoName,
    outcome,
    branch: currentBranch(config.repoPath),
    files: changedFiles(config.repoPath),
  });
}
