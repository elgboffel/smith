/**
 * Run-log reader/formatter.
 *
 * The run log is an append-only `run-log.jsonl` owned by the harness repo.
 * Each pipeline run appends one entry (see `writeRunMetrics`). This module
 * reads that log and renders the `smith status` view — recent runs and their
 * outcomes across all repos, so a missed live completion alert can still be
 * reconciled after the fact.
 */
import { parseJsonLines } from '../util/parse-jsonl.js';

export interface RunLogEntry {
  runId: string;
  date: string;
  task: string;
  repo: string;
  outcome: string;
  failedAgent?: string | null;
  metrics?: { totalDurationMs?: number | null } | null;
}

/** Parse `run-log.jsonl` content into entries, skipping malformed lines. */
export function parseRunLog(content: string): RunLogEntry[] {
  return parseJsonLines<RunLogEntry>(content);
}

export interface RunLogViewOptions {
  /** Max number of runs to show (default 20). */
  limit?: number;
  /** Restrict to a single repo. */
  repo?: string;
}

const DEFAULT_LIMIT = 20;

/**
 * Render recent runs and outcomes across all repos, newest first.
 *
 * Entries are appended chronologically, so the most recent runs are at the end
 * of the log; we reverse so the freshest run is at the top of the view.
 */
export function formatRunLog(entries: RunLogEntry[], opts: RunLogViewOptions = {}): string {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const filtered = opts.repo ? entries.filter((e) => e.repo === opts.repo) : entries;

  if (filtered.length === 0) {
    const scope = opts.repo ? ` for ${opts.repo}` : '';
    return `No runs recorded${scope} yet.\n`;
  }

  const recent = filtered.slice(-limit).reverse();
  const rows = recent.map((e) => {
    const outcome = e.outcome === 'failed' && e.failedAgent ? `failed (${e.failedAgent})` : e.outcome;
    return [e.date, e.repo, e.task, outcome];
  });

  const headers = ['DATE', 'REPO', 'TASK', 'OUTCOME'];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const fmt = (cols: string[]): string =>
    cols
      .map((c, i) => c.padEnd(widths[i]!))
      .join('  ')
      .trimEnd();

  return [fmt(headers), ...rows.map(fmt)].join('\n') + '\n';
}
