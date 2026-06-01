import { fetchIssue } from './issue-fetcher.js';
import { createTask } from './task-factory.js';
import { resolveDispatch } from './dispatch-resolver.js';
import { gitPolicyForMode } from './git-policy.js';
import { BranchNamer } from './branch-namer.js';
import { BatchPlanner } from './batch-planner.js';
import type { WorkItem } from './batch-planner.js';
import { runBatch } from './batch-runner.js';
import { defaultEvidenceExpectations, ensureBranch, resumeTask, setupStep, SETUP_PHASE } from './setup-phase.js';
import type { RendererKind } from './setup-phase.js';
import { buildPipelineConfig, loadProjectsManifest, resolveRepoPath } from '../config.js';
import { runPipeline } from '../pipeline.js';
import { runBootstrap } from '../commands/bootstrap.js';
import { createStructuredLogRenderer } from '../render/structured-log.js';
import { resolveEvidenceStrategy } from '../types.js';
import type { IssueContext, PipelineMode, PipelineOutcome, ProjectEntry, TaskCreateRequest } from '../types.js';

export interface FolderDispatchOptions {
  /** Path to the directory of issue `.md` files. */
  folderArg: string;
  mode: PipelineMode;
  dryRun: boolean;
  caseRoot: string;
  renderer?: RendererKind;
}

/**
 * Run a batch pass over a folder of issue files.
 *
 * Resolves the workspace from the folder location, derives one branch from the
 * folder name, then works each issue in lexical order through the existing
 * pipeline — creating a task (which commits in managed mode) or resuming a
 * stuck one — until the work list is exhausted, halting at the first failure so
 * later lexical slices never build on a broken base. The build/test baseline
 * runs once up front.
 */
export async function runFolderDispatch(options: FolderDispatchOptions): Promise<void> {
  const { folderArg, mode, dryRun, caseRoot, renderer } = options;

  const notifier = createStructuredLogRenderer({ mode });
  const setupStartedAt = Date.now();
  notifier.phaseStart(SETUP_PHASE, 'cli');

  // --- Resolve dispatch: classify + resolve workspace by walking up ---
  const manifest = await loadProjectsManifest(caseRoot);
  const projectRoots = manifest.repos.map((repo) => resolveRepoPath(manifest.repoBasePath, repo.path));
  const dispatch = await resolveDispatch(folderArg, { projectRoots });
  if (dispatch.mode !== 'folder') {
    throw new Error(`Expected folder dispatch for ${folderArg}, got ${dispatch.mode}`);
  }

  const policy = gitPolicyForMode(dispatch.mode);
  const { folderPath, workspacePath } = dispatch;
  const project = projectFor(manifest.repos, manifest.repoBasePath, workspacePath);
  setupStep(notifier, 'Dispatch', 'folder (batch pass)');
  setupStep(notifier, 'Workspace', `${project.name} (${workspacePath})`);

  // --- One branch for the whole folder (git policy: managed) ---
  // Meaningful folder name wins; a generic one (issues/.scratch/tmp) triggers
  // PRD-based name synthesis so the branch is human-meaningful by construction.
  const branch = await new BranchNamer().resolve({ folderPath });
  if (policy.createsBranch) {
    await ensureBranch(branch.name, workspacePath);
  }
  setupStep(notifier, 'Branch', policy.createsBranch ? branch.name : '(none)');

  // --- Plan the batch: lexical order, dedup-aware ---
  const planner = new BatchPlanner();
  const workItems = await planner.plan({ folderPath, caseRoot, workspacePath });
  setupStep(notifier, 'Batch', `${workItems.length} issue(s) to process`);

  // --- Baseline once (build/test gate still runs) ---
  const baseline = await runBootstrap(project.name, caseRoot, { ensureIgnored: policy.ensuresIgnored });
  if (!baseline.ok) {
    const failed = baseline.steps.find((step) => step.exitCode !== 0);
    setupStep(notifier, 'Baseline', 'failed');
    notifier.phaseEnd(SETUP_PHASE, 'cli', Date.now() - setupStartedAt, 'failed');
    process.stderr.write(`Baseline failed:\n${failed?.output ?? ''}\n`);
    process.exit(1);
  }
  setupStep(notifier, 'Baseline', 'passed');
  notifier.phaseEnd(SETUP_PHASE, 'cli', Date.now() - setupStartedAt, 'completed');

  // --- Work each issue in order, one commit per completed issue, halt on failure ---
  const ctx: RunWorkItemContext = { project, branch: branch.name, caseRoot, workspacePath, mode, dryRun, renderer };
  const result = await runBatch(workItems, (item) => runWorkItem(item, ctx), notifier);

  // A halt leaves later slices unprocessed; surface it so callers/CI can tell a
  // batch stopped early from one that ran clean to the end.
  if (result.halted) {
    process.exitCode = 1;
  }
}

interface RunWorkItemContext {
  project: ProjectEntry;
  branch: string;
  caseRoot: string;
  workspacePath: string;
  mode: PipelineMode;
  dryRun: boolean;
  renderer?: RendererKind;
}

/** Run one work item — resume a stuck task, or create and run a fresh one. */
async function runWorkItem(item: WorkItem, ctx: RunWorkItemContext): Promise<PipelineOutcome> {
  const notifier = createStructuredLogRenderer({ mode: ctx.mode });
  const startedAt = Date.now();
  notifier.phaseStart(SETUP_PHASE, 'cli');

  if (item.kind === 'resume') {
    return resumeTask(item.match, ctx.workspacePath, ctx.mode, ctx.dryRun, notifier, startedAt, ctx.renderer);
  }

  const issueContext: IssueContext = await fetchIssue('local-md', item.issuePath);
  setupStep(notifier, 'Issue', issueContext.title);

  const strategy = resolveEvidenceStrategy(ctx.project);
  const request: TaskCreateRequest = {
    repo: ctx.project.name,
    title: issueContext.title,
    // Empty body falls back to the title; `??` would keep an empty string.
    description: issueContext.body.trim().length > 0 ? issueContext.body : issueContext.title,
    issue: issueContext.issueNumber,
    issueType: issueContext.issueType,
    mode: ctx.mode,
    trigger: { type: 'cli', user: 'local' },
    evidenceExpectations: defaultEvidenceExpectations(strategy, issueContext),
  };
  const taskResult = await createTask(ctx.caseRoot, request, {
    issueContext,
    branch: ctx.branch,
    repoPath: ctx.workspacePath,
  });
  setupStep(notifier, 'Task', taskResult.taskId);
  notifier.phaseEnd(SETUP_PHASE, 'cli', Date.now() - startedAt, 'completed');

  const config = await buildPipelineConfig({
    taskJsonPath: taskResult.taskJsonPath,
    mode: ctx.mode,
    dryRun: ctx.dryRun,
  });
  return runPipeline({ ...config, notifier, renderer: ctx.renderer });
}

/** Find the registered project whose resolved root is the workspace directory. */
function projectFor(repos: readonly ProjectEntry[], basePath: string, workspacePath: string): ProjectEntry {
  const match = repos.find((repo) => resolveRepoPath(basePath, repo.path) === workspacePath);
  if (!match) {
    throw new Error(`No registered project matches workspace: ${workspacePath}`);
  }
  return match;
}
