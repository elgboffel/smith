import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTarget } from '../../src/entry/target-resolver.js';

let tempDir: string;

function writeProject(dir: string, name: string, config: Record<string, unknown>) {
  return writeFile(join(dir, `${name}.json`), JSON.stringify(config));
}

const baseProject = {
  evidenceStrategy: 'test-output' as const,
  language: 'typescript',
  packageManager: 'npm',
  commands: { test: 'npm test' },
};

describe('target-resolver', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'target-resolver-'));
    await mkdir(join(tempDir, 'projects'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resolves project by git remote match', async () => {
    const projectsDir = join(tempDir, 'projects');
    await writeProject(projectsDir, 'workos-node', {
      name: 'workos-node',
      remote: 'git@github.com:workos/workos-node.git',
      ...baseProject,
    });

    const repoDir = join(tempDir, 'my-repo');
    await mkdir(repoDir, { recursive: true });

    const result = await resolveTarget(repoDir, {
      projectsDir,
      gitRemoteUrl: 'git@github.com:workos/workos-node.git',
      gitToplevel: repoDir,
    });

    expect(result.project.name).toBe('workos-node');
    expect(result.workspaceDir).toBe(repoDir);
    expect(result.learningsKey).toBe('workos-node');
  });

  it('falls back to path match when no remote is available', async () => {
    const projectsDir = join(tempDir, 'projects');
    const repoDir = join(tempDir, 'my-repo');
    await mkdir(repoDir, { recursive: true });

    await writeProject(projectsDir, 'workos-node', {
      name: 'workos-node',
      remote: 'git@github.com:workos/workos-node.git',
      path: repoDir,
      ...baseProject,
    });

    const result = await resolveTarget(repoDir, {
      projectsDir,
      gitRemoteUrl: null,
      gitToplevel: repoDir,
    });

    expect(result.project.name).toBe('workos-node');
    expect(result.workspaceDir).toBe(repoDir);
  });

  it('uses git toplevel as workspaceDir, not cwd', async () => {
    const projectsDir = join(tempDir, 'projects');
    const repoRoot = join(tempDir, 'repo-root');
    const subDir = join(repoRoot, 'packages', 'sub');
    await mkdir(subDir, { recursive: true });

    await writeProject(projectsDir, 'my-lib', {
      name: 'my-lib',
      remote: 'git@github.com:org/my-lib.git',
      ...baseProject,
    });

    const result = await resolveTarget(subDir, {
      projectsDir,
      gitRemoteUrl: 'git@github.com:org/my-lib.git',
      gitToplevel: repoRoot,
    });

    expect(result.workspaceDir).toBe(repoRoot);
  });

  it('multiple worktrees with same remote resolve to same learningsKey', async () => {
    const projectsDir = join(tempDir, 'projects');
    await writeProject(projectsDir, 'sdk', {
      name: 'sdk',
      remote: 'git@github.com:org/sdk.git',
      learningsKey: 'sdk',
      ...baseProject,
    });

    const worktree1 = join(tempDir, 'worktree-main');
    const worktree2 = join(tempDir, 'worktree-feature');
    await mkdir(worktree1, { recursive: true });
    await mkdir(worktree2, { recursive: true });

    const result1 = await resolveTarget(worktree1, {
      projectsDir,
      gitRemoteUrl: 'git@github.com:org/sdk.git',
      gitToplevel: worktree1,
    });

    const result2 = await resolveTarget(worktree2, {
      projectsDir,
      gitRemoteUrl: 'git@github.com:org/sdk.git',
      gitToplevel: worktree2,
    });

    expect(result1.learningsKey).toBe('sdk');
    expect(result2.learningsKey).toBe('sdk');
    expect(result1.workspaceDir).not.toBe(result2.workspaceDir);
  });

  it('--project override bypasses detection', async () => {
    const projectsDir = join(tempDir, 'projects');
    await writeProject(projectsDir, 'cli', {
      name: 'cli',
      remote: 'git@github.com:org/cli.git',
      ...baseProject,
    });
    await writeProject(projectsDir, 'sdk', {
      name: 'sdk',
      remote: 'git@github.com:org/sdk.git',
      ...baseProject,
    });

    const someDir = join(tempDir, 'wherever');
    await mkdir(someDir, { recursive: true });

    // Remote points to sdk, but --project forces cli
    const result = await resolveTarget(someDir, {
      projectsDir,
      project: 'cli',
      gitRemoteUrl: 'git@github.com:org/sdk.git',
      gitToplevel: someDir,
    });

    expect(result.project.name).toBe('cli');
  });

  it('unknown repo throws error listing registered projects', async () => {
    const projectsDir = join(tempDir, 'projects');
    await writeProject(projectsDir, 'cli', {
      name: 'cli',
      remote: 'git@github.com:org/cli.git',
      ...baseProject,
    });
    await writeProject(projectsDir, 'sdk', {
      name: 'sdk',
      remote: 'git@github.com:org/sdk.git',
      ...baseProject,
    });

    const someDir = join(tempDir, 'mystery');
    await mkdir(someDir, { recursive: true });

    try {
      await resolveTarget(someDir, {
        projectsDir,
        gitRemoteUrl: 'git@github.com:org/unknown.git',
        gitToplevel: someDir,
      });
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('Project not found');
      expect(e.message).toContain('cli');
      expect(e.message).toContain('sdk');
    }
  });

  it('--project with unknown name throws error listing registered projects', async () => {
    const projectsDir = join(tempDir, 'projects');
    await writeProject(projectsDir, 'cli', {
      name: 'cli',
      remote: 'git@github.com:org/cli.git',
      ...baseProject,
    });

    const someDir = join(tempDir, 'wherever');
    await mkdir(someDir, { recursive: true });

    try {
      await resolveTarget(someDir, {
        projectsDir,
        project: 'nonexistent',
        gitToplevel: someDir,
      });
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('nonexistent');
      expect(e.message).toContain('cli');
    }
  });

  it('adopting a new repo requires only adding a JSON file', async () => {
    const projectsDir = join(tempDir, 'projects');
    const repoDir = join(tempDir, 'new-repo');
    await mkdir(repoDir, { recursive: true });

    // Initially no project matches
    try {
      await resolveTarget(repoDir, {
        projectsDir,
        gitRemoteUrl: 'git@github.com:org/new-thing.git',
        gitToplevel: repoDir,
      });
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('Project not found');
    }

    // Drop a JSON file — now it resolves
    await writeProject(projectsDir, 'new-thing', {
      name: 'new-thing',
      remote: 'git@github.com:org/new-thing.git',
      ...baseProject,
    });

    const result = await resolveTarget(repoDir, {
      projectsDir,
      gitRemoteUrl: 'git@github.com:org/new-thing.git',
      gitToplevel: repoDir,
    });

    expect(result.project.name).toBe('new-thing');
  });
});
