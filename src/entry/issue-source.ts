import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IssueContext } from '../types.js';
import { slugify } from '../util/slugify.js';

export interface LoadIssueOptions {
  /** When true, refuse issues whose Status is not 'ready-for-agent'. Default: false. */
  gate?: boolean;
}

/**
 * Load an issue from a local markdown file or fall through to freeform text.
 *
 * Local-md parsing:
 * - First H1 (`# ...`) → title
 * - Full file content → body
 * - `Status: <value>` line → added to labels; gates execution if not ready-for-agent
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

    const issue = await parseLocalMd(arg);

    if (opts.gate) {
      const status = extractStatus(issue.body);
      if (status && status !== 'ready-for-agent') {
        throw new Error(`Issue is not ready: status is '${status}' (expected 'ready-for-agent')`);
      }
    }

    return issue;
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

async function parseLocalMd(filePath: string): Promise<IssueContext> {
  const content = await readFile(filePath, 'utf-8');

  const title = extractTitle(content, filePath);
  const status = extractStatus(content);
  const labels = status ? [status] : [];

  return {
    title,
    body: content,
    labels,
    issueType: 'local-md',
    issueNumber: slugify(title, 40),
    sourcePath: resolve(filePath),
  };
}

function extractTitle(content: string, filePath: string): string {
  const match = content.match(/^# (.+)$/m);
  if (match) return match[1].trim();

  // Fallback: derive from filename
  const basename = filePath.split('/').pop() ?? filePath;
  return basename.replace(/\.md$/, '').replace(/[-_]/g, ' ');
}

function extractStatus(content: string): string | null {
  const match = content.match(/^Status:\s*(.+)$/m);
  return match ? match[1].trim() : null;
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
