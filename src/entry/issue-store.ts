import { basename } from 'node:path';

/** Parsed view of an issue `.md` file's lifecycle metadata and content. */
export interface IssueRecord {
  /** Value of the `Status:` line, or null when absent. */
  status: string | null;
  /** Value of the `Task:` back-link line, or null when absent. */
  taskId: string | null;
  /** First H1, or a filename-derived fallback when no H1 exists. */
  title: string;
  /** Full, unmodified file content. */
  body: string;
}

const TITLE_RE = /^# (.+)$/m;

const STATUS_RE = /^Status:\s*(.+)$/m;
const TASK_RE = /^Task:\s*(.+)$/m;

/**
 * IssueStore — the only reader/writer of an issue file's `Status:` and `Task:`
 * lines. Owns the issue lifecycle (`ready → claimed → done`) and the durable
 * two-way link between an issue and the task created from it.
 */
export class IssueStore {
  /** Read an issue file's lifecycle status and task back-link. */
  async read(path: string): Promise<IssueRecord> {
    const content = await Bun.file(path).text();
    return {
      status: match(content, STATUS_RE),
      taskId: match(content, TASK_RE),
      title: extractTitle(content, path),
      body: content,
    };
  }

  /** Mark the issue `claimed` and record the owning task as a back-link. */
  async claim(path: string, taskId: string): Promise<void> {
    let content = await Bun.file(path).text();
    content = upsertLine(content, 'Status', 'claimed');
    content = upsertLine(content, 'Task', taskId);
    await Bun.write(path, content);
  }

  /** Mark the issue `done`. The task back-link is left untouched. */
  async markDone(path: string): Promise<void> {
    const content = await Bun.file(path).text();
    await Bun.write(path, upsertLine(content, 'Status', 'done'));
  }

  /** Reset the issue to `ready` and remove its task back-link. */
  async release(path: string): Promise<void> {
    let content = await Bun.file(path).text();
    content = upsertLine(content, 'Status', 'ready');
    content = removeLine(content, 'Task');
    await Bun.write(path, content);
  }
}

/**
 * Replace `Key: value` if a line for `key` exists, otherwise insert one. New
 * lines go just after the first H1 title (or at the top when there is none).
 */
function upsertLine(content: string, key: string, value: string): string {
  const lineRe = new RegExp(`^${key}:\\s*.+$`, 'm');
  const line = `${key}: ${value}`;
  if (lineRe.test(content)) {
    return content.replace(lineRe, line);
  }

  const lines = content.split('\n');
  const titleIdx = lines.findIndex((l) => /^# .+/.test(l));
  const insertAt = titleIdx === -1 ? 0 : titleIdx + 1;
  lines.splice(insertAt, 0, '', line);
  return lines.join('\n');
}

/** Remove a `Key: value` line (and a trailing blank it leaves behind). */
function removeLine(content: string, key: string): string {
  return content.replace(new RegExp(`^${key}:\\s*.+\\n?`, 'm'), '');
}

function match(content: string, re: RegExp): string | null {
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

/** First H1, falling back to a filename-derived title. */
export function extractTitle(content: string, path: string): string {
  const m = content.match(TITLE_RE);
  if (m) return m[1].trim();
  return basename(path).replace(/\.md$/, '').replace(/[-_]/g, ' ');
}
