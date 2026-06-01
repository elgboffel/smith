import { basename } from 'node:path';
import type { Notifier } from '../notify.js';
import type { PipelineOutcome } from '../types.js';
import type { WorkItem } from './batch-planner.js';

/** Runs one work item through the pipeline and reports its terminal outcome. */
export type RunWorkItem = (item: WorkItem) => Promise<PipelineOutcome>;

/** Result of driving a folder's work list to completion or to a halt. */
export interface BatchRunResult {
  /** Number of work items attempted (including the one that halted the batch). */
  readonly processed: number;
  /** True when the batch stopped early because an item failed. */
  readonly halted: boolean;
  /** Issue path of the item that halted the batch, when `halted` is true. */
  readonly haltedAt?: string;
}

/**
 * Drive a folder's work list, halting at the first failure.
 *
 * Later lexical slices assume earlier ones landed, so a failed (or crashed)
 * item stops the batch immediately — leaving its issue `claimed` with a
 * non-terminal task, ready to resume on the next run. Items run strictly in
 * order; a thrown error is treated as a failure.
 */
export async function runBatch(
  workItems: readonly WorkItem[],
  runItem: RunWorkItem,
  notifier: Notifier,
): Promise<BatchRunResult> {
  let processed = 0;
  for (const item of workItems) {
    processed++;
    let outcome: PipelineOutcome;
    try {
      outcome = await runItem(item);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      notifier.send(
        `Folder batch halted at ${basename(item.issuePath)} (${reason}). Issue stays claimed — re-run to resume.`,
      );
      return { processed, halted: true, haltedAt: item.issuePath };
    }
    if (outcome === 'failed') {
      notifier.send(
        `Folder batch halted at ${basename(item.issuePath)}. Issue stays claimed — re-run to resume.`,
      );
      return { processed, halted: true, haltedAt: item.issuePath };
    }
  }
  notifier.send(`Folder batch complete: ${processed} issue(s) processed.`);
  return { processed, halted: false };
}
