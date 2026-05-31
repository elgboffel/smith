import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadIssue } from '../../src/entry/issue-source.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'smith-issue-source-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('loadIssue — local md parsing', () => {
  it('extracts title from first H1, full file as body, status as label', async () => {
    const file = join(tmp, 'task.md');
    await writeFile(
      file,
      `# Refactor the widget parser

Status: ready-for-agent

## What to build

Extract the widget parsing logic.
`,
    );

    const issue = await loadIssue(file);

    expect(issue.title).toBe('Refactor the widget parser');
    expect(issue.body).toContain('# Refactor the widget parser');
    expect(issue.body).toContain('Extract the widget parsing logic.');
    expect(issue.labels).toContain('ready-for-agent');
    expect(issue.issueType).toBe('local-md');
  });

  it('uses filename as title fallback when no H1 present', async () => {
    const file = join(tmp, 'fix-login-redirect.md');
    await writeFile(file, 'No heading here, just content.\n');

    const issue = await loadIssue(file);

    expect(issue.title).toBe('fix login redirect');
    expect(issue.body).toContain('No heading here');
  });

  it('extracts status into labels', async () => {
    const file = join(tmp, 'task.md');
    await writeFile(file, '# Do thing\n\nStatus: draft\n');

    const issue = await loadIssue(file);

    expect(issue.labels).toEqual(['draft']);
  });

  it('returns empty labels when no Status line', async () => {
    const file = join(tmp, 'task.md');
    await writeFile(file, '# Do thing\n\nNo status here.\n');

    const issue = await loadIssue(file);

    expect(issue.labels).toEqual([]);
  });
});

describe('loadIssue — status gate', () => {
  it('throws when status is not ready-for-agent', async () => {
    const file = join(tmp, 'task.md');
    await writeFile(file, '# Do thing\n\nStatus: draft\n');

    try {
      await loadIssue(file, { gate: true });
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('not ready');
    }
  });

  it('does not throw when gate is disabled', async () => {
    const file = join(tmp, 'task.md');
    await writeFile(file, '# Do thing\n\nStatus: draft\n');

    const issue = await loadIssue(file, { gate: false });
    expect(issue.title).toBe('Do thing');
  });

  it('passes gate when status is ready-for-agent', async () => {
    const file = join(tmp, 'task.md');
    await writeFile(file, '# Do thing\n\nStatus: ready-for-agent\n');

    const issue = await loadIssue(file, { gate: true });
    expect(issue.title).toBe('Do thing');
  });

  it('passes gate when no status line (permissive)', async () => {
    const file = join(tmp, 'task.md');
    await writeFile(file, '# Do thing\n\nJust content.\n');

    const issue = await loadIssue(file, { gate: true });
    expect(issue.title).toBe('Do thing');
  });
});

describe('loadIssue — freeform fallthrough', () => {
  it('non-existent path falls through to freeform', async () => {
    const issue = await loadIssue('implement the auth flow');

    expect(issue.issueType).toBe('freeform');
    expect(issue.title).toBe('implement the auth flow');
    expect(issue.body).toBe('implement the auth flow');
  });

  it('non-.md path falls through to freeform', async () => {
    const issue = await loadIssue('some random text that is not a file');

    expect(issue.issueType).toBe('freeform');
  });

  it('.md path that does not exist throws a clear error', async () => {
    const file = join(tmp, 'nonexistent.md');

    try {
      await loadIssue(file);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('not found');
    }
  });
});

describe('loadIssue — real fixtures', () => {
  const fixtureDir = join(import.meta.dir, 'fixtures');

  it('parses sample-issue.md (ready-for-agent)', async () => {
    const issue = await loadIssue(join(fixtureDir, 'sample-issue.md'), { gate: true });

    expect(issue.title).toBe('Refactor the widget parser');
    expect(issue.labels).toContain('ready-for-agent');
    expect(issue.body).toContain('## Acceptance criteria');
    expect(issue.issueType).toBe('local-md');
  });

  it('gates not-ready-issue.md', async () => {
    try {
      await loadIssue(join(fixtureDir, 'not-ready-issue.md'), { gate: true });
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('not ready');
      expect(e.message).toContain('draft');
    }
  });

  it('parses no-status-issue.md (no gate, permissive)', async () => {
    const issue = await loadIssue(join(fixtureDir, 'no-status-issue.md'), { gate: true });

    expect(issue.title).toBe('Quick fix for the login flow');
    expect(issue.labels).toEqual([]);
  });
});
