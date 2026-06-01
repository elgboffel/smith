import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { reconcileIssue } from './issue-dedup.js';
import type { TaskMatch } from './task-scanner.js';

/** One issue to process in a folder-dispatch batch, with how to enter it. */
export type WorkItem =
  | { readonly kind: 'create'; readonly issuePath: string }
  | { readonly kind: 'resume'; readonly issuePath: string; readonly match: TaskMatch };

export interface PlanBatchOptions {
  /** Absolute path to the folder of issue `.md` files. */
  readonly folderPath: string;
  /** Case root (used to locate legacy task directories). */
  readonly caseRoot: string;
  /** Absolute path to the workspace whose `.smith/tasks/active` is scanned. */
  readonly workspacePath: string;
}

/**
 * BatchPlanner — turns a folder of issue files into an ordered work list.
 *
 * Issues are processed in lexical filename order (the numeric prefix encodes
 * intent). Each `.md` file is reconciled against its `Status:` and any task
 * that back-links it: `done` is skipped, a live back-linked task resumes, and a
 * `ready`-unclaimed issue is created. Non-`.md` files are ignored.
 */
export class BatchPlanner {
  /** List the folder's issues, classify each, and return ordered work items. */
  async plan(opts: PlanBatchOptions): Promise<WorkItem[]> {
    const entries = await readdir(opts.folderPath);
    const issueFiles = entries.filter((name) => name.endsWith('.md')).sort();

    const items: WorkItem[] = [];
    for (const name of issueFiles) {
      const issuePath = join(opts.folderPath, name);
      const decision = await reconcileIssue({
        issuePath,
        caseRoot: opts.caseRoot,
        repoPath: opts.workspacePath,
      });
      if (decision.action === 'skip') continue;
      if (decision.action === 'resume') {
        items.push({ kind: 'resume', issuePath, match: decision.match });
      } else {
        items.push({ kind: 'create', issuePath });
      }
    }
    return items;
  }
}
