import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { runConventionChecks } = await import('../commands/check.js');

let caseRoot: string;
let originalSmithDataDir: string | undefined;
let originalXdgConfigHome: string | undefined;

/**
 * Write a projects.json manifest + a target repo under a temp caseRoot.
 *
 * `conventional-commits` is always skipped here: that check shells out to git,
 * which the Bun test runner doesn't support cleanly. Skipping it (and asserting
 * it never runs) is also the behaviour under test.
 */
async function scaffold(opts: { skipChecks?: string[]; testCommand?: string } = {}): Promise<void> {
  const repoPath = join(caseRoot, 'target');
  await mkdir(repoPath, { recursive: true });
  // package.json deliberately lacks version/description/license → fails
  // package-json-fields unless that check is skipped.
  await writeFile(join(repoPath, 'package.json'), JSON.stringify({ name: 'target', scripts: { test: 'true' } }));
  await writeFile(join(repoPath, 'CLAUDE.md'), '# target');

  const repo = {
    name: 'target',
    evidenceStrategy: 'test-output',
    path: 'target',
    remote: 'git@example.com:target.git',
    description: 'x',
    language: 'typescript',
    packageManager: 'pnpm',
    commands: { setup: 'true', test: opts.testCommand ?? 'true' },
    skipChecks: ['conventional-commits', ...(opts.skipChecks ?? [])],
  };
  await writeFile(join(caseRoot, 'projects.json'), JSON.stringify({ repos: [repo] }));
}

describe('smith check — skipChecks', () => {
  beforeEach(async () => {
    caseRoot = await mkdtemp(join(tmpdir(), 'case-check-skip-'));
    // Point smith at an empty data dir (no config.json) so manifest resolution
    // falls through to the scaffolded caseRoot/projects.json instead of the
    // real ~/.config/smith one.
    originalSmithDataDir = process.env.SMITH_DATA_DIR;
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.SMITH_DATA_DIR = caseRoot;
    delete process.env.XDG_CONFIG_HOME;
    process.env.SMITH_QUIET = '1';
  });

  afterEach(async () => {
    if (originalSmithDataDir === undefined) delete process.env.SMITH_DATA_DIR;
    else process.env.SMITH_DATA_DIR = originalSmithDataDir;
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    delete process.env.SMITH_QUIET;
    await rm(caseRoot, { recursive: true, force: true });
  });

  it('reports package-json-fields as FAIL when not skipped', async () => {
    await scaffold();
    const [result] = await runConventionChecks({ caseRoot });
    expect(result?.checks.find((c) => c.id === 'package-json-fields')?.status).toBe('FAIL');
  });

  it('converts a listed check to SKIP', async () => {
    await scaffold({ skipChecks: ['package-json-fields'] });
    const [result] = await runConventionChecks({ caseRoot });
    const pkg = result?.checks.find((c) => c.id === 'package-json-fields');
    expect(pkg?.status).toBe('SKIP');
    expect(pkg?.message).toContain('skipped per projects.json');
  });

  it('leaves unlisted checks untouched', async () => {
    await scaffold({ skipChecks: ['package-json-fields'] });
    const [result] = await runConventionChecks({ caseRoot });
    expect(result?.checks.find((c) => c.id === 'claude-md')?.status).toBe('PASS');
  });

  it('does not execute a skipped check (a failing test command stays SKIP)', async () => {
    // test command exits non-zero — if the skipped check ran, it would FAIL.
    await scaffold({ skipChecks: ['tests'], testCommand: 'false' });
    const [result] = await runConventionChecks({ caseRoot, runTests: true });
    expect(result?.checks.find((c) => c.id === 'tests')?.status).toBe('SKIP');
  });
});
