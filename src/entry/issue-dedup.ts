import { IssueStore } from './issue-store.js';
import { findTaskByBackLink } from './task-scanner.js';
import type { TaskMatch } from './task-scanner.js';
import { slugify } from '../util/slugify.js';

const issueStore = new IssueStore();

/** The terminal task status — a committed task has nothing left to resume. */
const TERMINAL_TASK_STATUS = 'committed';

/** Outcome of reconciling an issue file against existing task state. */
export type ReconcileDecision =
  | { readonly action: 'skip'; readonly reason: string }
  | { readonly action: 'resume'; readonly match: TaskMatch }
  | { readonly action: 'create' };

export interface ReconcileIssueOptions {
  /** Absolute path to the source issue `.md` file. */
  readonly issuePath: string;
  /** Case root (used to locate legacy task directories). */
  readonly caseRoot: string;
  /** Absolute path to the workspace whose `.smith/tasks/active` is scanned. */
  readonly repoPath: string;
}

/**
 * Decide whether to create, resume, or skip a task for an issue file by
 * reconciling two signals — the issue's `Status:` and any task that back-links
 * it — so re-running the same issue never spawns a duplicate task.
 */
export async function reconcileIssue(opts: ReconcileIssueOptions): Promise<ReconcileDecision> {
  const record = await issueStore.read(opts.issuePath);
  if (record.status === 'done') {
    return { action: 'skip', reason: 'issue already done' };
  }

  const match = await findTaskByBackLink(
    opts.caseRoot,
    { taskId: record.taskId, issuePath: opts.issuePath, slug: slugify(record.title, 40) },
    opts.repoPath,
  );
  if (match) {
    if (match.taskJson.status === TERMINAL_TASK_STATUS) {
      return { action: 'skip', reason: 'back-linked task already committed' };
    }
    return { action: 'resume', match };
  }

  return { action: 'create' };
}
