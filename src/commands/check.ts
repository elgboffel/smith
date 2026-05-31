import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadProjectsManifest, resolveRepoPath } from '../config.js';
import { resolvePackageRoot } from '../paths.js';
import { runCommand, runCommandLine } from '../util/run-command.js';
import type { ProjectEntry } from '../types.js';

export const description = 'Run Case convention checks for target repos';

type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';

/** Human label shown when a check is skipped via projects.json. */
const CHECK_LABELS = {
  'claude-md': 'CLAUDE.md or CLAUDE.local.md exists',
  'required-commands': 'Required commands exist in package.json',
  'conventional-commits': 'Conventional commits (last 10)',
  'file-sizes': 'Source file size limit (src/)',
  'package-json-fields': 'package.json required fields',
  tests: 'Tests pass',
} as const;

interface CheckResult {
  /** Stable identifier used to opt out via a repo's `skipChecks` in projects.json. */
  id?: string;
  status: CheckStatus;
  message: string;
  remediation?: string;
}

interface RepoCheckResult {
  repo: ProjectEntry;
  repoPath: string | null;
  checks: CheckResult[];
}

export async function runConventionChecks(
  opts: {
    caseRoot?: string;
    repoName?: string;
    runTests?: boolean;
  } = {},
): Promise<RepoCheckResult[]> {
  const caseRoot = opts.caseRoot ?? resolvePackageRoot();
  const manifest = await loadProjectsManifest(caseRoot);
  const selected = opts.repoName ? manifest.repos.filter((repo) => repo.name === opts.repoName) : manifest.repos;
  if (opts.repoName && selected.length === 0) {
    throw new Error(`repo '${opts.repoName}' not found in projects.json`);
  }

  const results: RepoCheckResult[] = [];
  for (const repo of selected) {
    const repoPath = resolveRepoPath(manifest.repoBasePath, repo.path);
    if (!existsSync(repoPath)) {
      results.push({
        repo,
        repoPath: null,
        checks: [{ status: 'SKIP', message: `Repo not found at ${repo.path}` }],
      });
      continue;
    }

    // A repo can opt out of specific checks via `skipChecks` in projects.json
    // (e.g. a monorepo root that legitimately lacks package.json version/license,
    // or a repo that doesn't follow conventional commits). A skipped check is
    // never executed — it renders as SKIP and doesn't count toward pass/fail.
    const skip = new Set(repo.skipChecks ?? []);
    const checks: CheckResult[] = [];
    const add = async (id: keyof typeof CHECK_LABELS, run: () => CheckResult | Promise<CheckResult>): Promise<void> => {
      if (skip.has(id)) {
        checks.push({ id, status: 'SKIP', message: `${CHECK_LABELS[id]} (skipped per projects.json)` });
        return;
      }
      checks.push({ ...(await run()), id });
    };
    await add('claude-md', () => checkClaudeMd(repoPath));
    await add('required-commands', () => checkRequiredCommands(repo, repoPath));
    await add('conventional-commits', () => checkConventionalCommits(repoPath));
    await add('file-sizes', () => checkFileSizes(repoPath));
    await add('package-json-fields', () => checkPackageJsonFields(repoPath));
    if (opts.runTests) await add('tests', () => checkRunTests(repo, repoPath));
    results.push({ repo, repoPath, checks });
  }

  return results;
}

export async function handler(argv: string[]): Promise<number> {
  let repoName = '';
  let runTests = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repoName = argv[++i] ?? '';
    else if (argv[i] === '--run-tests') runTests = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      process.stdout.write(
        'Usage: smith check [--repo <name>] [--run-tests]\n' +
          '\nA repo can opt out of individual checks by adding a "skipChecks" array to its\n' +
          'projects.json entry, e.g. "skipChecks": ["conventional-commits", "package-json-fields"].\n' +
          'Check ids: claude-md, required-commands, conventional-commits, file-sizes,\n' +
          'package-json-fields, tests.\n',
      );
      return 0;
    } else {
      process.stderr.write(`Unknown option: ${argv[i]}\nUsage: smith check [--repo <name>] [--run-tests]\n`);
      return 1;
    }
  }

  let results: RepoCheckResult[];
  try {
    results = await runConventionChecks({ repoName: repoName || undefined, runTests });
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    return 1;
  }

  let total = 0;
  let passed = 0;
  for (const result of results) {
    process.stdout.write(`=== ${result.repo.name} (${result.repo.path}) ===\n`);
    for (const check of result.checks) {
      const idLabel = check.id ? `(${check.id}) ` : '';
      process.stdout.write(`  [${check.status}] ${idLabel}${check.message}\n`);
      if (check.remediation) process.stdout.write(`         FIX: ${check.remediation}\n`);
      if (check.status !== 'SKIP') total++;
      if (check.status === 'PASS') passed++;
    }
    process.stdout.write('\n');
  }

  process.stdout.write(`Summary: ${passed}/${total} checks passed across ${results.length} repos\n`);
  return passed === total ? 0 : 1;
}

function checkClaudeMd(repoPath: string): CheckResult {
  if (existsSync(join(repoPath, 'CLAUDE.md')) || existsSync(join(repoPath, 'CLAUDE.local.md'))) {
    return { status: 'PASS', message: 'CLAUDE.md or CLAUDE.local.md exists' };
  }
  return {
    status: 'FAIL',
    message: 'CLAUDE.md or CLAUDE.local.md exists',
    remediation: 'Create a CLAUDE.md file in the repo root. See docs/golden-principles.md',
  };
}

function checkRequiredCommands(repo: ProjectEntry, repoPath: string): CheckResult {
  const pkg = readPackageJson(repoPath);
  const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
  const missing = new Set<string>();

  if (!scripts.test) missing.add('test');

  for (const [name, rawCommand] of Object.entries(repo.commands ?? {})) {
    if (name === 'setup') continue;
    if (scripts[name]) continue;

    const command = String(rawCommand);
    const match = command.match(/\b(?:pnpm|npm|bun)\s+(?:run\s+)?(\S+)/);
    const scriptName = match?.[1] ?? name;
    if (!scripts[scriptName]) missing.add(name);
  }

  if (missing.size === 0) return { status: 'PASS', message: 'Required commands exist in package.json' };
  return {
    status: 'FAIL',
    message: 'Required commands exist in package.json',
    remediation: `Add missing scripts to package.json: ${[...missing].sort().join(', ')}`,
  };
}

async function checkConventionalCommits(repoPath: string): Promise<CheckResult> {
  const result = await runCommand('git', ['log', '--oneline', '-10'], { cwd: repoPath });
  if (result.exitCode !== 0) {
    return { status: 'SKIP', message: 'Conventional commits (git log unavailable)' };
  }

  const regex = /^[a-f0-9]+ (feat|fix|chore|refactor|docs|test|ci|perf|build|style|revert)(\(.+\))?!?:/;
  const bad = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !regex.test(line));

  if (bad.length === 0) return { status: 'PASS', message: 'Conventional commits (last 10)' };
  return {
    status: 'FAIL',
    message: 'Conventional commits (last 10)',
    remediation: `Use conventional commit format: type(scope): description. Non-conforming: ${bad.join('; ')}`,
  };
}

function checkFileSizes(repoPath: string): CheckResult {
  const src = join(repoPath, 'src');
  const oversized: string[] = [];
  if (existsSync(src)) {
    for (const file of walk(src)) {
      if (!/\.[jt]sx?$/.test(file)) continue;
      if (/\.(spec|test)\.[jt]sx?$/.test(file)) continue;
      if (file.includes('/__tests__/') || file.includes('/test/')) continue;
      const lines = readFileSync(file, 'utf-8').split(/\r?\n/).length;
      if (lines > 500) oversized.push(`${relative(repoPath, file)} (${lines} lines)`);
    }
  }

  if (oversized.length === 0) return { status: 'PASS', message: 'No source files over 500 lines in src/' };
  return {
    status: 'FAIL',
    message: 'File size limit exceeded in src/',
    remediation: `Split into smaller modules: ${oversized.join(', ')}`,
  };
}

function checkPackageJsonFields(repoPath: string): CheckResult {
  const pkg = readPackageJson(repoPath);
  const missing = ['name', 'version', 'description', 'license'].filter((field) => !pkg[field]);
  if (missing.length === 0) {
    return { status: 'PASS', message: 'package.json has required fields (name, version, description, license)' };
  }
  return {
    status: 'FAIL',
    message: `package.json missing fields: ${missing.join(', ')}`,
    remediation: 'Add missing fields to package.json',
  };
}

async function checkRunTests(repo: ProjectEntry, repoPath: string): Promise<CheckResult> {
  const command = repo.commands?.test;
  if (!command) return { status: 'SKIP', message: 'No test command defined' };
  const result = await runCommandLine(command, { cwd: repoPath, timeout: 120_000 });
  if (result.exitCode === 0) return { status: 'PASS', message: `Tests pass (${command})` };
  return {
    status: 'FAIL',
    message: `Tests fail (${command})`,
    remediation: `Run '${command}' locally and fix failures`,
  };
}

function readPackageJson(repoPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf-8')) as Record<string, unknown>;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (stat.isFile()) yield full;
  }
}
