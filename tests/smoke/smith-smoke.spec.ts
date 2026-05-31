/**
 * Smoke tests for smith.
 *
 * These exercise the real binary/entry points in a hermetic temp environment.
 * Each issue extends this file with assertions for newly-wired behaviour.
 *
 * Current coverage:
 * - Binary starts (module resolution succeeds)
 * - Temp git repo scaffold works for integration tests
 *
 * Future (as issues land):
 * - Issue 02: issue-source parses fixture .md files
 * - Issue 03: target-resolver detects project from temp repo
 * - Issue 05: full pipeline fires in mock mode, commit appears
 * - Issue 06: squash commit + status flip
 *
 * Note: Full CLI invocation (--help, --version) requires Bun >=1.1 for
 * `parseArgs` support. Programmatic module imports are tested instead.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'smith-smoke-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Scaffold: temp git repo for integration tests
// ---------------------------------------------------------------------------

async function createTempGitRepo(dir: string): Promise<string> {
  const repoDir = join(dir, 'target-repo');
  await mkdir(repoDir, { recursive: true });
  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });
  await writeFile(join(repoDir, 'README.md'), '# Test repo\n');
  execSync('git add -A && git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });
  return repoDir;
}

async function addRemote(repoDir: string, url: string): Promise<void> {
  execSync(`git remote add origin ${url}`, { cwd: repoDir, stdio: 'pipe' });
}

// ---------------------------------------------------------------------------
// Module resolution: generated assets are valid
// ---------------------------------------------------------------------------

describe('smith module resolution', () => {
  it('package-assets.ts resolves all imports and exports the manifest', async () => {
    // If this import succeeds, all bundled asset paths are valid
    const assets = await import('../../src/generated/package-assets.js');
    expect(assets.embeddedPackageAssets).toBeDefined();
    expect(Object.keys(assets.embeddedPackageAssets).length).toBeGreaterThan(0);
  });

  it('core modules load without import errors', async () => {
    // These are smith's core modules that don't depend on parseArgs
    const dag = await import('../../src/dag/types.js');
    expect(dag).toBeDefined();
    const events = await import('../../src/events/schema.js');
    expect(events).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Temp repo scaffold
// ---------------------------------------------------------------------------

describe('smoke scaffold', () => {
  it('createTempGitRepo produces a valid git repo with a commit', async () => {
    const repo = await createTempGitRepo(tmp);
    const log = execSync('git log --oneline', { cwd: repo, encoding: 'utf-8' });
    expect(log.trim()).toContain('init');
  });

  it('addRemote sets origin on the temp repo', async () => {
    const repo = await createTempGitRepo(tmp);
    await addRemote(repo, 'git@github.com:test-org/test-repo.git');
    const remote = execSync('git remote get-url origin', { cwd: repo, encoding: 'utf-8' });
    expect(remote.trim()).toBe('git@github.com:test-org/test-repo.git');
  });
});

// ---------------------------------------------------------------------------
// Issue fixtures exist and are well-formed
// ---------------------------------------------------------------------------

describe('smoke fixtures', () => {
  it('sample-issue.md has H1 title and Status line', async () => {
    const content = await readFile(join(import.meta.dir, 'fixtures/sample-issue.md'), 'utf-8');
    expect(content).toMatch(/^# .+/m);
    expect(content).toMatch(/^Status: ready-for-agent/m);
  });

  it('not-ready-issue.md has a non-ready status', async () => {
    const content = await readFile(join(import.meta.dir, 'fixtures/not-ready-issue.md'), 'utf-8');
    expect(content).toMatch(/^Status: draft/m);
  });

  it('no-status-issue.md has no Status line', async () => {
    const content = await readFile(join(import.meta.dir, 'fixtures/no-status-issue.md'), 'utf-8');
    expect(content).not.toMatch(/^Status:/m);
  });
});
