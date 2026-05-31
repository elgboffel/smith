import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectArgumentType, fetchIssue } from '../../src/entry/issue-fetcher.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'smith-issue-fetcher-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('detectArgumentType', () => {
  it('routes a .md path to local-md', () => {
    expect(detectArgumentType('.scratch/issues/foo/01-bar.md')).toBe('local-md');
  });

  it('routes pure digits to github', () => {
    expect(detectArgumentType('1234')).toBe('github');
  });

  it('routes UPPER-N to linear', () => {
    expect(detectArgumentType('ENG-42')).toBe('linear');
  });

  it('routes anything else to freeform', () => {
    expect(detectArgumentType('fix the login redirect')).toBe('freeform');
  });
});

describe('fetchIssue — local-md routing', () => {
  it('reads the file contents into the issue body (not the path string)', async () => {
    const file = join(tmp, 'remove-highlights.md');
    await writeFile(
      file,
      `# Remove recommended-row highlight

## What to build

Remove the green success.light background from the recommended row.
`,
    );

    const issue = await fetchIssue('local-md', file);

    expect(issue.issueType).toBe('local-md');
    expect(issue.title).toBe('Remove recommended-row highlight');
    expect(issue.body).toContain('success.light background');
    // Regression guard: the body must be the file CONTENT, never the path.
    expect(issue.body).not.toBe(file);
  });

  it('throws a clear error when the .md file does not exist', async () => {
    await expect(fetchIssue('local-md', join(tmp, 'missing.md'))).rejects.toThrow('Issue file not found');
  });
});
