import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { BatchPlanner } from '../entry/batch-planner.js';

describe('BatchPlanner.plan', () => {
  let workspace: string;
  let folder: string;
  let planner: BatchPlanner;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'batch-planner-'));
    folder = join(workspace, '.scratch', 'issues');
    mkdirSync(folder, { recursive: true });
    planner = new BatchPlanner();
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  function writeIssue(name: string, content: string): string {
    const path = join(folder, name);
    writeFileSync(path, content);
    return path;
  }

  function writeTask(slug: string, issuePath: string, taskId: string): void {
    const activeDir = join(workspace, '.smith', 'tasks', 'active');
    mkdirSync(activeDir, { recursive: true });
    const task = { id: taskId, issue: slug, status: 'active', issuePath, agents: {} };
    writeFileSync(join(activeDir, `${slug}.task.json`), JSON.stringify(task));
  }

  async function plan(): Promise<ReturnType<BatchPlanner['plan']> extends Promise<infer T> ? T : never> {
    return planner.plan({ folderPath: folder, caseRoot: workspace, workspacePath: workspace });
  }

  it('returns ready-unclaimed issues as create work items in lexical order', async () => {
    writeIssue('02-second.md', '# Second\n\nStatus: ready\n\nBody.\n');
    writeIssue('01-first.md', '# First\n\nStatus: ready\n\nBody.\n');
    writeIssue('10-tenth.md', '# Tenth\n\nStatus: ready\n\nBody.\n');

    const items = await plan();

    expect(items.map((i) => basename(i.issuePath))).toEqual(['01-first.md', '02-second.md', '10-tenth.md']);
    expect(items.every((i) => i.kind === 'create')).toBe(true);
  });

  it('skips issues already marked done', async () => {
    writeIssue('01-ready.md', '# Ready\n\nStatus: ready\n\nBody.\n');
    writeIssue('02-done.md', '# Done\n\nStatus: done\n\nBody.\n');

    const items = await plan();

    expect(items.map((i) => basename(i.issuePath))).toEqual(['01-ready.md']);
  });

  it('ignores non-.md files in the folder', async () => {
    writeIssue('01-ready.md', '# Ready\n\nStatus: ready\n\nBody.\n');
    writeFileSync(join(folder, 'notes.txt'), 'not an issue');
    writeFileSync(join(folder, 'README'), 'nope');

    const items = await plan();

    expect(items.map((i) => basename(i.issuePath))).toEqual(['01-ready.md']);
  });

  it('marks a claimed issue with a live back-linked task as resume', async () => {
    const issuePath = writeIssue('01-claimed.md', '# Claimed\n\nStatus: claimed\nTask: cli-claimed-one\n\nBody.\n');
    writeTask('claimed', issuePath, 'cli-claimed-one');
    writeIssue('02-ready.md', '# Ready\n\nStatus: ready\n\nBody.\n');

    const items = await plan();

    expect(items.map((i) => i.kind)).toEqual(['resume', 'create']);
    const resume = items[0];
    if (resume.kind !== 'resume') throw new Error('expected resume');
    expect(resume.match.taskJson.id).toBe('cli-claimed-one');
  });
});
