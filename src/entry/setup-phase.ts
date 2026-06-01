import { buildPipelineConfig } from '../config.js';
import { runPipeline } from '../pipeline.js';
import { runCommand } from '../util/run-command.js';
import { formatSetupStep } from '../render/format.js';
import type { Notifier } from '../notify.js';
import type { EvidenceStrategy, IssueContext, PipelineMode, PipelineOutcome, PipelinePhase } from '../types.js';
import type { TaskMatch } from './task-scanner.js';

export const SETUP_PHASE: PipelinePhase = 'setup';

export type RendererKind = 'structured' | 'tui';

/**
 * Emit a setup-phase tool line via the notifier. We bypass the Notifier's
 * toolStart implementation (which uses `formatToolLine`) because setup steps
 * don't need a duration suffix — `formatSetupStep` gives us the right shape.
 */
export function setupStep(notifier: Notifier, label: string, detail?: string): void {
  notifier.send(formatSetupStep(label, detail));
}

/**
 * Resume an existing task from the correct pipeline phase.
 * Handles the terminal state (committed) and branch recovery.
 */
export async function resumeTask(
  match: TaskMatch,
  repoPath: string,
  mode: PipelineMode,
  dryRun: boolean,
  notifier: Notifier,
  setupStartedAt: number,
  renderer?: RendererKind,
): Promise<PipelineOutcome> {
  const { taskJson, taskJsonPath, entryPhase } = match;

  // Guard: task already completed (commit-only close already ran).
  if (taskJson.status === 'committed') {
    setupStep(notifier, 'Status', taskJson.status);
    notifier.phaseEnd(SETUP_PHASE, 'cli', Date.now() - setupStartedAt, 'completed');
    notifier.send('Task already committed. Nothing to do.');
    return 'completed';
  }

  setupStep(notifier, 'Resume task', `${taskJson.id} (entry: ${entryPhase})`);

  // Checkout the task's branch if it has one (skip when branch is null = "current"/direct mode)
  if (taskJson.branch) {
    await ensureBranch(taskJson.branch, repoPath, true);
    setupStep(notifier, 'Branch', taskJson.branch);
  }

  const config = await buildPipelineConfig({ taskJsonPath, mode, dryRun });

  notifier.phaseEnd(SETUP_PHASE, 'cli', Date.now() - setupStartedAt, 'completed');

  return runPipeline({ ...config, notifier, renderer });
}

/**
 * Create or checkout a git branch.
 * If branch exists, checkout. Otherwise, create from HEAD.
 * When `warnOnCreate` is true (resume flow), warns that the branch was recreated.
 */
export async function ensureBranch(branchName: string, repoPath: string, warnOnCreate = false): Promise<void> {
  const check = await runCommand('git', ['rev-parse', '--verify', branchName], { cwd: repoPath });

  if (check.exitCode === 0) {
    const co = await runCommand('git', ['checkout', branchName], { cwd: repoPath });
    if (co.exitCode !== 0) {
      throw new Error(`Failed to checkout branch ${branchName}: ${co.stderr.trim()}`);
    }
  } else {
    if (warnOnCreate) {
      process.stdout.write(`  Warning: branch ${branchName} not found, recreating from HEAD\n`);
    }
    const create = await runCommand('git', ['checkout', '-b', branchName], { cwd: repoPath });
    if (create.exitCode !== 0) {
      throw new Error(`Failed to create branch ${branchName}: ${create.stderr.trim()}`);
    }
  }
}

const EVIDENCE_TEMPLATES: Record<EvidenceStrategy, (issue: IssueContext) => string> = {
  'ui-screenshot': (issue) =>
    [
      `Before/after screenshots demonstrating the behavior change described in: ${issue.title}`,
      'Navigate to the affected page, reproduce the scenario from the issue, and capture the state before and after the fix.',
      'If auth is required, complete the AuthKit login flow with test credentials.',
    ].join('\n'),
  'scenario-script': (issue) =>
    [
      `Consumer script that imports the changed API and exercises the code path described in: ${issue.title}`,
      'Script should assert expected behavior and print PASS/FAIL.',
      'Full test suite and typecheck must also pass.',
    ].join('\n'),
  'test-output': (issue) =>
    [
      `Full test suite passes with no regressions. Typecheck and build succeed.`,
      `Specific tests covering the change described in: ${issue.title}`,
    ].join('\n'),
};

export function defaultEvidenceExpectations(strategy: EvidenceStrategy, issue: IssueContext): string {
  return EVIDENCE_TEMPLATES[strategy](issue);
}
