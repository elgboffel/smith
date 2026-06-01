import { detectRepo } from './repo-detector.js';
import { detectArgumentType, fetchIssue } from './issue-fetcher.js';
import { findTaskByIssue, findTaskByMarker } from './task-scanner.js';
import { createTask } from './task-factory.js';
import { stat } from 'node:fs/promises';
import { runDirectDispatch } from './direct-dispatch.js';
import { runFolderDispatch } from './folder-dispatch.js';
import { deriveBranchPrefix } from './branch-namer.js';
import { defaultEvidenceExpectations, ensureBranch, resumeTask, setupStep, SETUP_PHASE } from './setup-phase.js';
import type { RendererKind } from './setup-phase.js';
import { buildPipelineConfig } from '../config.js';
import { runPipeline } from '../pipeline.js';
import { runBootstrap } from '../commands/bootstrap.js';
import { createStructuredLogRenderer } from '../render/structured-log.js';
import type { IssueContext, PipelineMode, TaskCreateRequest } from '../types.js';
import { resolveEvidenceStrategy } from '../types.js';
import type { TaskMatch } from './task-scanner.js';

export interface CliOrchestratorOptions {
  /** Issue number, Linear ID, or free text. Undefined = re-entry via .smith/active. */
  argument?: string;
  mode: PipelineMode;
  dryRun: boolean;
  /** Skip re-entry detection and create a fresh task. */
  fresh?: boolean;
  caseRoot: string;
  /** Renderer override: 'tui' for full-screen TUI mode. */
  renderer?: RendererKind;
  /**
   * Branch strategy:
   * - `undefined`: derive a new branch from the issue context (default, current behavior)
   * - `"current"`: stay on the current branch, don't create or switch
   * - `string`:     use this exact branch name (create or checkout)
   */
  branch?: string;
}

/**
 * Standalone CLI orchestrator — Steps 0-3 as deterministic TypeScript.
 *
 * A `.md` file argument is dispatched fully locally (see `runDirectDispatch`):
 * workspace resolved from the issue file, zero git writes. Everything else runs
 * the legacy git-shaped flow:
 *   0. Detect repo from cwd
 *   0b. Check for existing task (re-entry)
 *   1. Fetch issue context
 *   2. Derive branch, create task files
 *   3. Run baseline
 *   4. Dispatch to runPipeline()
 */
export async function runCliOrchestrator(options: CliOrchestratorOptions): Promise<void> {
  const { argument, mode, dryRun, fresh, caseRoot, renderer } = options;

  // Direct dispatch: a `.md` file runs fully local with no git writes.
  if (argument?.endsWith('.md')) {
    return runDirectDispatch({ issueArg: argument, mode, dryRun, fresh, caseRoot, renderer });
  }

  // Folder dispatch: a directory runs a managed batch pass over its issues.
  if (argument && (await isDirectoryArg(argument))) {
    return runFolderDispatch({ folderArg: argument, mode, dryRun, caseRoot, renderer });
  }

  const notifier = createStructuredLogRenderer({ mode });
  const setupStartedAt = Date.now();
  notifier.phaseStart(SETUP_PHASE, 'cli');

  // --- Step 0: Detect repo ---
  const detected = await detectRepo(caseRoot);
  setupStep(notifier, 'Detect repo', detected.name);

  // --- Step 0b: Check for existing task (re-entry) ---
  let match: TaskMatch | null = null;

  if (!fresh) {
    if (argument) {
      const argType = detectArgumentType(argument);
      match = await findTaskByIssue(caseRoot, detected.name, argType, argument, detected.path);
    } else {
      match = await findTaskByMarker(caseRoot, detected.path);
    }
  }

  if (match) {
    await resumeTask(match, detected.path, mode, dryRun, notifier, setupStartedAt, renderer);
    return;
  }

  // No existing task found — create new or exit
  if (!argument) {
    notifier.phaseEnd(SETUP_PHASE, 'cli', Date.now() - setupStartedAt, 'failed');
    notifier.send('No active task found. Usage: bun src/index.ts <issue-number>');
    return;
  }

  // Re-entrancy guard: block task creation when running inside a pipeline.
  // Agents shell out to `smith` for status/mark-tested/etc., but must never
  // accidentally create new tasks (e.g. `smith skills` inside a verifier).
  if (process.env.SMITH_RUN_ID) {
    throw new Error(
      `Refusing to create a new task from inside a pipeline run (SMITH_RUN_ID=${process.env.SMITH_RUN_ID}). ` +
        `If this was intentional, unset SMITH_RUN_ID first.`,
    );
  }

  // --- Step 1: Fetch issue context ---
  const argType = detectArgumentType(argument);
  setupStep(notifier, 'Issue type', `${argType} (${argument})`);

  const issueContext: IssueContext = await fetchIssue(argType, argument, detected.project.remote);
  setupStep(notifier, 'Fetch issue', issueContext.title);

  // --- Step 2: Create branch + task files ---
  const branchName = await resolveBranch(options.branch, issueContext, detected.path);
  setupStep(notifier, 'Branch', branchName ?? '(current)');

  // Create task files
  const strategy = resolveEvidenceStrategy(detected.project);
  const request: TaskCreateRequest = {
    repo: detected.name,
    title: issueContext.title,
    description: issueContext.body || issueContext.title,
    issue: issueContext.issueNumber,
    issueType: issueContext.issueType,
    mode,
    trigger: { type: 'cli', user: 'local' },
    evidenceExpectations: defaultEvidenceExpectations(strategy, issueContext),
  };

  const taskResult = await createTask(caseRoot, request, {
    issueContext,
    branch: branchName ?? undefined,
    repoPath: detected.path,
  });
  setupStep(notifier, 'Task', taskResult.taskId);

  // --- Step 3: Run baseline ---
  const baseline = await runBootstrap(detected.name, caseRoot);

  if (!baseline.ok) {
    const failed = baseline.steps.find((step) => step.exitCode !== 0);
    setupStep(notifier, 'Baseline', 'failed');
    notifier.phaseEnd(SETUP_PHASE, 'cli', Date.now() - setupStartedAt, 'failed');
    process.stderr.write(`Baseline failed:\n${failed?.output ?? ''}\n`);
    process.stderr.write('Fix the issues above before retrying.\n');
    process.exit(1);
  }
  setupStep(notifier, 'Baseline', 'passed');

  notifier.phaseEnd(SETUP_PHASE, 'cli', Date.now() - setupStartedAt, 'completed');

  // --- Step 4: Dispatch to pipeline ---
  const config = await buildPipelineConfig({
    taskJsonPath: taskResult.taskJsonPath,
    mode,
    dryRun,
  });

  await runPipeline({ ...config, notifier, renderer });
}

/** Whether the positional argument points at an existing directory. */
async function isDirectoryArg(arg: string): Promise<boolean> {
  try {
    return (await stat(arg)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Derive a branch name from issue context.
 * Prefix from labels: feat/ for feature, fix/ for bug, chore/ for maintenance.
 * Suffix: issue-N (GitHub), ID (Linear), slug (freeform).
 */
function deriveBranchName(issue: IssueContext): string {
  const prefix = deriveBranchPrefix(issue.labels);
  switch (issue.issueType) {
    case 'github':
      return `${prefix}/issue-${issue.issueNumber}`;
    case 'linear':
      return `${prefix}/${issue.issueNumber}`;
    case 'freeform':
      return `${prefix}/${issue.issueNumber}`;
    case 'local-md':
      return `${prefix}/${issue.issueNumber}`;
  }
}

/**
 * Resolve which branch to use for a new task.
 *
 * - `"current"`: stay on whatever branch is checked out, return null (no branch in task.json)
 * - explicit string: use that branch name (create or checkout)
 * - `undefined`: derive a new branch from the issue context (legacy default)
 *
 * Returns the branch name stored in task.json, or null for "current".
 */
async function resolveBranch(
  branchOption: string | undefined,
  issue: IssueContext,
  repoPath: string,
): Promise<string | null> {
  if (branchOption === 'current') {
    // Stay on the current branch — don't create or switch
    return null;
  }

  const branchName = branchOption ?? deriveBranchName(issue);
  await ensureBranch(branchName, repoPath);
  return branchName;
}
