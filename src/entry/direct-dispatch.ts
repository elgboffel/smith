import { fetchIssue } from './issue-fetcher.js';
import { findTaskByIssue } from './task-scanner.js';
import { createTask } from './task-factory.js';
import { resolveDispatch } from './dispatch-resolver.js';
import { gitPolicyForMode } from './git-policy.js';
import { defaultEvidenceExpectations, resumeTask, setupStep, SETUP_PHASE } from './setup-phase.js';
import type { RendererKind } from './setup-phase.js';
import { buildPipelineConfig, loadProjectsManifest, resolveRepoPath } from '../config.js';
import { runPipeline } from '../pipeline.js';
import { runBootstrap } from '../commands/bootstrap.js';
import { createStructuredLogRenderer } from '../render/structured-log.js';
import { resolveEvidenceStrategy } from '../types.js';
import type { IssueContext, PipelineMode, ProjectEntry, TaskCreateRequest } from '../types.js';

export interface DirectDispatchOptions {
  /** Absolute path to the issue `.md` file. */
  issueArg: string;
  mode: PipelineMode;
  dryRun: boolean;
  /** Skip re-entry detection and create a fresh task. */
  fresh?: boolean;
  caseRoot: string;
  renderer?: RendererKind;
}

/**
 * Run the pipeline fully locally for a single issue file.
 *
 * The workspace is resolved by walking up from the issue file to its containing
 * project (never from `cwd`). Direct dispatch makes zero git writes — no branch,
 * no commit, no `.gitignore` mutation — per the git policy for `direct` mode.
 * The build/test baseline still runs; issues are read from the file only.
 */
export async function runDirectDispatch(options: DirectDispatchOptions): Promise<void> {
  const { issueArg, mode, dryRun, fresh, caseRoot, renderer } = options;

  const notifier = createStructuredLogRenderer({ mode });
  const setupStartedAt = Date.now();
  notifier.phaseStart(SETUP_PHASE, 'cli');

  // --- Resolve dispatch: classify + resolve workspace by walking up ---
  const manifest = await loadProjectsManifest(caseRoot);
  const projectRoots = manifest.repos.map((repo) => resolveRepoPath(manifest.repoBasePath, repo.path));
  const dispatch = await resolveDispatch(issueArg, { projectRoots });

  if (dispatch.mode !== 'direct') {
    // Defensive: callers only route existing `.md` files here.
    throw new Error(`Expected direct dispatch for ${issueArg}, got ${dispatch.mode}`);
  }

  const policy = gitPolicyForMode(dispatch.mode);
  const workspacePath = dispatch.workspacePath;
  const issuePath = dispatch.issuePaths[0];
  const project = projectFor(manifest.repos, manifest.repoBasePath, workspacePath);

  setupStep(notifier, 'Dispatch', 'direct (local, no git writes)');
  setupStep(notifier, 'Workspace', `${project.name} (${workspacePath})`);

  // --- Re-entry: resume an existing task for this issue file ---
  if (!fresh) {
    const matchId = (await fetchIssue('local-md', issuePath)).issueNumber;
    const match = await findTaskByIssue(caseRoot, project.name, 'local-md', matchId, workspacePath);
    if (match) {
      return resumeTask(match, workspacePath, mode, dryRun, notifier, setupStartedAt, renderer);
    }
  }

  // Re-entrancy guard: never create a new task from inside a pipeline run.
  if (process.env.SMITH_RUN_ID) {
    throw new Error(
      `Refusing to create a new task from inside a pipeline run (SMITH_RUN_ID=${process.env.SMITH_RUN_ID}). ` +
        `If this was intentional, unset SMITH_RUN_ID first.`,
    );
  }

  // --- Read the issue from the file only (no gh/Linear fetch) ---
  const issueContext: IssueContext = await fetchIssue('local-md', issuePath);
  setupStep(notifier, 'Fetch issue', issueContext.title);

  // --- No branch in direct mode (git policy) ---
  setupStep(notifier, 'Branch', policy.createsBranch ? '(managed)' : '(none — direct dispatch)');

  // --- Create task files (no branch recorded) ---
  const strategy = resolveEvidenceStrategy(project);
  const request: TaskCreateRequest = {
    repo: project.name,
    title: issueContext.title,
    description: issueContext.body || issueContext.title,
    issue: issueContext.issueNumber,
    issueType: issueContext.issueType,
    mode,
    trigger: { type: 'cli', user: 'local' },
    evidenceExpectations: defaultEvidenceExpectations(strategy, issueContext),
  };
  const taskResult = await createTask(caseRoot, request, { issueContext, branch: undefined, repoPath: workspacePath });
  setupStep(notifier, 'Task', taskResult.taskId);

  // --- Baseline (build/test gate still runs; .gitignore left untouched) ---
  const baseline = await runBootstrap(project.name, caseRoot, { ensureIgnored: policy.ensuresIgnored });
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

  // --- Dispatch to pipeline ---
  const config = await buildPipelineConfig({ taskJsonPath: taskResult.taskJsonPath, mode, dryRun });
  await runPipeline({ ...config, notifier, renderer });
}

/** Find the registered project whose resolved root is the workspace directory. */
function projectFor(repos: readonly ProjectEntry[], basePath: string, workspacePath: string): ProjectEntry {
  const match = repos.find((repo) => resolveRepoPath(basePath, repo.path) === workspacePath);
  if (!match) {
    throw new Error(`No registered project matches workspace: ${workspacePath}`);
  }
  return match;
}
