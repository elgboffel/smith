import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IssueStore } from '../../src/entry/issue-store.js';

function tmpBase(): string {
  return mkdtempSync(join(tmpdir(), 'issue-store-test-'));
}

describe('IssueStore', () => {
  let dir: string;
  let store: IssueStore;

  beforeEach(() => {
    dir = tmpBase();
    store = new IssueStore();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeIssue(name: string, content: string): string {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  }

  describe('read', () => {
    it('reads Status and Task lines from an issue file', async () => {
      const path = writeIssue(
        '01-thing.md',
        '# Do the thing\n\nStatus: claimed\nTask: cli-abc-do-the-thing\n\nBody text.\n',
      );

      const record = await store.read(path);

      expect(record.status).toBe('claimed');
      expect(record.taskId).toBe('cli-abc-do-the-thing');
    });

    it('returns null status and taskId when the lines are absent', async () => {
      const path = writeIssue('02-bare.md', '# Bare issue\n\nJust a body, no metadata.\n');

      const record = await store.read(path);

      expect(record.status).toBeNull();
      expect(record.taskId).toBeNull();
    });

    it('extracts the first H1 as the title and keeps the full body', async () => {
      const content = '# The real title\n\nStatus: ready\n\nSome body.\n';
      const path = writeIssue('07-title.md', content);

      const record = await store.read(path);

      expect(record.title).toBe('The real title');
      expect(record.body).toBe(content);
    });

    it('falls back to a filename-derived title when no H1 exists', async () => {
      const path = writeIssue('08-no-heading.md', 'Status: ready\n\nBody without heading.\n');

      const record = await store.read(path);

      expect(record.title).toBe('08 no heading');
    });
  });

  describe('claim', () => {
    it('sets Status: claimed and writes a Task back-link when absent', async () => {
      const path = writeIssue('03-ready.md', '# Ready issue\n\nStatus: ready\n\nBody.\n');

      await store.claim(path, 'cli-xyz-ready-issue');

      const record = await store.read(path);
      expect(record.status).toBe('claimed');
      expect(record.taskId).toBe('cli-xyz-ready-issue');
    });

    it('inserts Status and Task when neither line exists', async () => {
      const path = writeIssue('04-nometa.md', '# No meta\n\nBody only.\n');

      await store.claim(path, 'cli-123-no-meta');

      const record = await store.read(path);
      expect(record.status).toBe('claimed');
      expect(record.taskId).toBe('cli-123-no-meta');
    });
  });

  describe('markDone', () => {
    it('flips Status to done and leaves the Task back-link intact', async () => {
      const path = writeIssue(
        '05-claimed.md',
        '# Claimed issue\n\nStatus: claimed\nTask: cli-abc-claimed-issue\n\nBody.\n',
      );

      await store.markDone(path);

      const record = await store.read(path);
      expect(record.status).toBe('done');
      expect(record.taskId).toBe('cli-abc-claimed-issue');
    });
  });

  describe('release', () => {
    it('resets Status to ready and clears the Task back-link', async () => {
      const path = writeIssue(
        '06-claimed.md',
        '# Claimed issue\n\nStatus: claimed\nTask: cli-abc-claimed-issue\n\nBody.\n',
      );

      await store.release(path);

      const record = await store.read(path);
      expect(record.status).toBe('ready');
      expect(record.taskId).toBeNull();
    });
  });
});
