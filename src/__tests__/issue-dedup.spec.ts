import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { reconcileIssue } from '../entry/issue-dedup.js';
import type { TaskJson } from '../types.js';

describe('reconcileIssue', () => {
  let repoPath: string;
  let caseRoot: string;
  let activeDir: string;

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), 'smith-dedup-repo-'));
    caseRoot = mkdtempSync(join(tmpdir(), 'smith-dedup-case-'));
    activeDir = join(repoPath, '.smith', 'tasks', 'active');
    mkdirSync(activeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(caseRoot, { recursive: true, force: true });
  });

  function writeIssue(name: string, content: string): string {
    const path = join(repoPath, name);
    writeFileSync(path, content);
    return resolve(path);
  }

  function writeTask(id: string, fields: Partial<TaskJson>): void {
    const task = { id, status: 'active', repo: 'demo', agents: {}, ...fields };
    writeFileSync(join(activeDir, `${id}.task.json`), JSON.stringify(task, null, 2));
  }

  it('creates a task for a ready issue with no back-link', async () => {
    const issuePath = writeIssue('01-ready.md', '# Ready issue\n\nStatus: ready\n\nBody.\n');

    const decision = await reconcileIssue({ issuePath, caseRoot, repoPath });

    expect(decision.action).toBe('create');
  });

  it('skips a done issue', async () => {
    const issuePath = writeIssue('02-done.md', '# Done issue\n\nStatus: done\nTask: demo-1-done-issue\n\nBody.\n');

    const decision = await reconcileIssue({ issuePath, caseRoot, repoPath });

    expect(decision.action).toBe('skip');
  });

  it('resumes a non-terminal task back-linked via the Task line', async () => {
    const issuePath = writeIssue(
      '03-claimed.md',
      '# Claimed issue\n\nStatus: claimed\nTask: demo-3-claimed-issue\n\nBody.\n',
    );
    writeTask('demo-3-claimed-issue', { status: 'implementing', issuePath });

    const decision = await reconcileIssue({ issuePath, caseRoot, repoPath });

    expect(decision.action).toBe('resume');
    if (decision.action !== 'resume') throw new Error('unreachable');
    expect(decision.match.taskJson.id).toBe('demo-3-claimed-issue');
  });

  it('skips when the back-linked task is already committed', async () => {
    const issuePath = writeIssue(
      '04-committed.md',
      '# Committed issue\n\nStatus: claimed\nTask: demo-4-committed-issue\n\nBody.\n',
    );
    writeTask('demo-4-committed-issue', { status: 'committed', issuePath });

    const decision = await reconcileIssue({ issuePath, caseRoot, repoPath });

    expect(decision.action).toBe('skip');
  });

  it('creates a clean restart when a human resets Status to ready despite a stale back-link', async () => {
    // Human forced a retry by editing Status back to `ready`; the old claimed
    // task is still on disk. The `ready` status is authoritative — a fresh task
    // is created rather than resuming the stale one.
    const issuePath = writeIssue('06-reset.md', '# Reset issue\n\nStatus: ready\nTask: demo-6-reset-issue\n\nBody.\n');
    writeTask('demo-6-reset-issue', { status: 'implementing', issuePath });

    const decision = await reconcileIssue({ issuePath, caseRoot, repoPath });

    expect(decision.action).toBe('create');
  });

  it('resumes a task matched by issuePath when the Task line is absent', async () => {
    const issuePath = writeIssue('05-orphan-link.md', '# Orphan link\n\nStatus: claimed\n\nBody.\n');
    writeTask('demo-5-orphan-link', { status: 'verifying', issuePath });

    const decision = await reconcileIssue({ issuePath, caseRoot, repoPath });

    expect(decision.action).toBe('resume');
    if (decision.action !== 'resume') throw new Error('unreachable');
    expect(decision.match.taskJson.id).toBe('demo-5-orphan-link');
  });
});
