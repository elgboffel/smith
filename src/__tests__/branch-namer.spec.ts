import { describe, it, expect } from 'bun:test';
import { BranchNamer } from '../entry/branch-namer.js';

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
