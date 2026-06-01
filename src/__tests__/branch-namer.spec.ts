import { describe, it, expect, mock } from 'bun:test';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BranchNamer } from '../entry/branch-namer.js';
import type { DerivedBranch } from '../entry/branch-namer.js';

describe('BranchNamer.fromFolderName', () => {
  const namer = new BranchNamer();

  it('slugifies the folder name into a branch name with a prefix', () => {
    const result = namer.fromFolderName('local-first-folder-dispatch');
    expect(result.prefix).toBe('fix');
    expect(result.name).toBe('fix/local-first-folder-dispatch');
  });

  it('uses the feat prefix when the folder name signals a feature', () => {
    const result = namer.fromFolderName('new-export-feature');
    expect(result.prefix).toBe('feat');
    expect(result.name).toBe('feat/new-export-feature');
  });

  it('uses the chore prefix for docs/maintenance folder names', () => {
    const result = namer.fromFolderName('docs-cleanup');
    expect(result.prefix).toBe('chore');
    expect(result.name).toBe('chore/docs-cleanup');
  });

  it('normalises spaces and casing in the folder name', () => {
    const result = namer.fromFolderName('My Cool Thing');
    expect(result.name).toBe('fix/my-cool-thing');
  });
});

describe('BranchNamer.resolve', () => {
  const synthesized: DerivedBranch = { prefix: 'feat', name: 'feat/export-pipeline' };

  it('uses the folder-name path for a meaningful folder, never calling the agent', async () => {
    const analyze = mock(async () => synthesized);
    const namer = new BranchNamer(analyze);

    const result = await namer.resolve({ folderPath: '/work/local-first-folder-dispatch' });

    expect(result.name).toBe('fix/local-first-folder-dispatch');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('synthesizes a name from the PRD via the agent seam when the folder name is generic', async () => {
    const analyze = mock(async () => synthesized);
    const namer = new BranchNamer(analyze);

    const result = await namer.resolve({ folderPath: '/work/.scratch/issues', prdPath: '/work/prd.md' });

    expect(result).toEqual(synthesized);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith('/work/prd.md');
  });

  it('treats issues/scratch/tmp folder names as generic', async () => {
    const analyze = mock(async () => synthesized);
    const namer = new BranchNamer(analyze);

    for (const generic of ['issues', '.scratch', 'tmp', 'tasks']) {
      analyze.mockClear();
      await namer.resolve({ folderPath: `/work/${generic}`, prdPath: '/work/prd.md' });
      expect(analyze).toHaveBeenCalledTimes(1);
    }
  });

  it('locates a co-located PRD when no prdPath is supplied', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'branch-namer-'));
    const issuesDir = join(dir, 'issues');
    await mkdir(issuesDir, { recursive: true });
    await writeFile(join(dir, 'prd.md'), '# Export pipeline\n');

    const analyze = mock(async (path: string) => ({ prefix: 'feat', name: `feat/from-${path.length}` }));
    const namer = new BranchNamer(analyze);

    const result = await namer.resolve({ folderPath: issuesDir });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith(join(dir, 'prd.md'));
    expect(result.prefix).toBe('feat');
  });

  it('falls back to the folder-name path when the folder is generic but no PRD exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'branch-namer-'));
    const issuesDir = join(dir, 'issues');
    await mkdir(issuesDir, { recursive: true });

    const analyze = mock(async () => synthesized);
    const namer = new BranchNamer(analyze);

    const result = await namer.resolve({ folderPath: issuesDir });

    expect(analyze).not.toHaveBeenCalled();
    expect(result.name).toBe('fix/issues');
  });
});
