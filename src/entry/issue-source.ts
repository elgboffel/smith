import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IssueContext } from '../types.js';
import { IssueStore } from './issue-store.js';
import { slugify } from '../util/slugify.js';

const issueStore = new IssueStore();

/**
 * Statuses that clear the readiness gate. Covers the current lifecycle value
 * (`ready`, per the local-md issue lifecycle `ready → claimed → done`) and the
 * legacy `ready-for-agent` marker so older issue files still dispatch.
 */
const READY_STATUSES: ReadonlySet<string> = new Set(['ready', 'ready-for-agent']);

export interface LoadIssueOptions {
  /** When true, refuse issues whose Status is not a ready value. Default: false. */
  gate?: boolean;
}

/**
 * Load an issue from a local markdown file or fall through to freeform text.
 *
 * Local-md parsing:
 * - First H1 (`# ...`) → title
 * - Full file content → body
 * - `Status: <value>` line → added to labels; gates execution if not ready
 *
 * If the argument is not a path to an existing .md file, falls through to
 * freeform text (same behavior as the inherited issue-fetcher).
 */
export async function loadIssue(arg: string, opts: LoadIssueOptions = {}): Promise<IssueContext> {
  // If it looks like a .md file path, treat it as local-md
  if (arg.endsWith('.md')) {
    if (!(await fileExists(arg))) {
      throw new Error(`Issue file not found: ${arg}`);
    }

    const record = await issueStore.read(arg);

    if (opts.gate && record.status && !READY_STATUSES.has(record.status)) {
      throw new Error(`Issue is not ready: status is '${record.status}' (expected 'ready')`);
    }

    return {
      title: record.title,
      body: record.body,
      labels: record.status ? [record.status] : [],
      issueType: 'local-md',
      issueNumber: slugify(record.title, 40),
      sourcePath: resolve(arg),
    };
  }

  // Fallthrough: freeform text
  return freeformIssue(arg);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

function freeformIssue(text: string): IssueContext {
  return {
    title: text,
    body: text,
    labels: [],
    issueType: 'freeform',
    issueNumber: slugify(text, 40),
  };
}
