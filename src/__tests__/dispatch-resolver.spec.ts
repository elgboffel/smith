import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveDispatch } from '../entry/dispatch-resolver.js';
import type { DispatchMode } from '../entry/dispatch-resolver.js';

describe('resolveDispatch', () => {
  let projectRoot: string;
  let issuePath: string;

  beforeAll(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'smith-dispatch-'));
    const issuesDir = join(projectRoot, '.scratch', 'issues');
    mkdirSync(issuesDir, { recursive: true });
    issuePath = join(issuesDir, '01-do-the-thing.md');
    writeFileSync(issuePath, '# Do the thing\n\nBody.\n');
  });

  afterAll(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('classifies a .md file as direct dispatch with the absolute issue path', async () => {
    const result = await resolveDispatch(issuePath, { projectRoots: [projectRoot] });
    expect(result.mode).toBe('direct');
    if (result.mode !== 'direct') throw new Error('unreachable');
    expect(result.issuePaths).toEqual([resolve(issuePath)]);
  });

  it('resolves the workspace by walking up to the containing project root', async () => {
    const result = await resolveDispatch(issuePath, { projectRoots: [projectRoot] });
    if (result.mode !== 'direct') throw new Error('expected direct');
    expect(result.workspacePath).toBe(resolve(projectRoot));
  });

  it('picks the deepest project root when roots are nested', async () => {
    const nested = join(projectRoot, 'packages', 'inner');
    const nestedIssue = join(nested, 'docs', 'task.md');
    mkdirSync(join(nested, 'docs'), { recursive: true });
    writeFileSync(nestedIssue, '# Inner\n');
    const result = await resolveDispatch(nestedIssue, { projectRoots: [projectRoot, nested] });
    if (result.mode !== 'direct') throw new Error('expected direct');
    expect(result.workspacePath).toBe(resolve(nested));
  });

  it('throws when the issue file is outside every registered project root', async () => {
    const orphan = mkdtempSync(join(tmpdir(), 'smith-orphan-'));
    const orphanIssue = join(orphan, 'stray.md');
    writeFileSync(orphanIssue, '# Stray\n');
    try {
      await expect(resolveDispatch(orphanIssue, { projectRoots: [projectRoot] })).rejects.toThrow(
        /No registered project/,
      );
    } finally {
      rmSync(orphan, { recursive: true, force: true });
    }
  });

  const legacyCases: ReadonlyArray<{ arg: string; mode: DispatchMode }> = [
    { arg: '123', mode: 'github' },
    { arg: 'ABC-1', mode: 'linear' },
    { arg: 'fix the flaky login test', mode: 'freeform' },
  ];

  for (const { arg, mode } of legacyCases) {
    it(`classifies "${arg}" as ${mode} (legacy, argument preserved)`, async () => {
      const result = await resolveDispatch(arg, { projectRoots: [projectRoot] });
      expect(result.mode).toBe(mode);
      if (result.mode === 'direct') throw new Error('expected legacy');
      expect(result.argument).toBe(arg);
    });
  }

  it('throws when a .md argument does not exist as a file', async () => {
    const missing = join(projectRoot, 'nope.md');
    await expect(resolveDispatch(missing, { projectRoots: [projectRoot] })).rejects.toThrow(/not found/);
  });
});
