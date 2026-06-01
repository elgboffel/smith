import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadIssue } from '../entry/issue-source.js';

describe('loadIssue (local-md)', () => {
  let dir: string;
  let mdPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'smith-issue-src-'));
    mdPath = join(dir, '01-remove-highlight.md');
    writeFileSync(mdPath, '# Remove highlight\n\nDo the thing.\n');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records the absolute source path so the closer can update it', async () => {
    const issue = await loadIssue(mdPath);
    expect(issue.issueType).toBe('local-md');
    expect(issue.sourcePath).toBe(resolve(mdPath));
  });

  it('freeform text carries no sourcePath', async () => {
    const issue = await loadIssue('just some freeform text, not a path');
    expect(issue.issueType).toBe('freeform');
    expect(issue.sourcePath).toBeUndefined();
  });
});
