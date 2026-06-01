import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { resolveDataDir, resolvePackageRoot, resolveRepoTaskJson } from '../paths.js';

export const description = 'Mark a repo as auto-tested (writes .smith/<slug>/tested with SHA-256 of test output)';

function resolveTaskSlug(): string | null {
  if (!existsSync('.smith/active')) return null;
  return readFileSync('.smith/active', 'utf-8').trim() || null;
}

/**
 * Extract a vitest JSON report from raw output that may be polluted with
 * stderr noise (e.g. when callers use `--reporter=json 2>&1`). Vitest prints
 * a single JSON object; we slice from the first `{` to the last `}` and try to
 * parse. Returns the parsed object's source string, or null if no valid
 * vitest report is found.
 */
function extractVitestJson(raw: string): string | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  const candidate = raw.slice(start, end + 1);
  try {
    const data = JSON.parse(candidate);
    // Require at least one vitest-shaped field so we don't misread arbitrary JSON.
    if (
      typeof data === 'object' &&
      data !== null &&
      ('numTotalTests' in data || 'numPassedTests' in data || 'testResults' in data)
    ) {
      return candidate;
    }
  } catch {
    /* not parseable — fall through to text mode */
  }
  return null;
}

function parseVitestJson(raw: string): {
  passed: number;
  failed: number;
  total: number;
  durationMs: number;
  suites: number;
  files: unknown[];
} {
  const data = JSON.parse(raw);
  const testResults = data.testResults ?? [];
  return {
    passed: data.numPassedTests ?? 0,
    failed: data.numFailedTests ?? 0,
    total: data.numTotalTests ?? 0,
    durationMs: testResults.reduce(
      (s: number, r: { perfStats?: { end?: number; start?: number } }) =>
        s + ((r.perfStats?.end ?? 0) - (r.perfStats?.start ?? 0)),
      0,
    ),
    suites: testResults.length,
    files: testResults.map(
      (r: {
        name?: string;
        status?: string;
        assertionResults?: unknown[];
        perfStats?: { end?: number; start?: number };
      }) => ({
        name: r.name?.split('/').pop() ?? 'unknown',
        status: r.status ?? 'unknown',
        tests: (r.assertionResults ?? []).length,
        duration_ms: (r.perfStats?.end ?? 0) - (r.perfStats?.start ?? 0),
      }),
    ),
  };
}

export async function handler(argv: string[]): Promise<number> {
  if (process.stdin.isTTY && !argv.find((a) => !a.startsWith('--') && existsSync(a))) {
    process.stderr.write(
      'mark-tested requires test output on stdin or as a file argument: <test-cmd> | smith mark-tested\n',
    );
    return 1;
  }

  const slug = resolveTaskSlug();
  if (!slug) {
    process.stderr.write('ERROR: No active task — .smith/active is missing or empty. Run the orchestrator first.\n');
    return 1;
  }

  const markerDir = `.smith/${slug}`;
  mkdirSync(markerDir, { recursive: true });

  let content: string;
  const fileArg = argv.find((a) => !a.startsWith('--') && existsSync(a));
  if (fileArg) {
    content = readFileSync(fileArg, 'utf-8');
  } else {
    content = await new Response(process.stdin as unknown as ReadableStream).text();
  }

  if (content.trim() === '') {
    process.stderr.write(
      'ERROR: mark-tested received empty test output — refusing to write a passing marker.\n' +
        'The test command produced no output on stdin. Common causes:\n' +
        '  - vitest wrote to a TTY instead of the pipe (run non-interactively)\n' +
        '  - output was redirected to a file: use `smith mark-tested <file>` instead\n' +
        '  - the test command failed before producing output\n',
    );
    return 1;
  }

  const hash = createHash('sha256').update(content).digest('hex');
  const timestamp = new Date().toISOString();
  const vitestJson = extractVitestJson(content);
  let markerContent: string;

  if (vitestJson !== null) {
    const parsed = parseVitestJson(vitestJson);
    markerContent = `timestamp: ${timestamp}\noutput_hash: ${hash}\npass_indicators: ${parsed.passed}\nfail_indicators: ${parsed.failed}\npassed: ${parsed.passed}\nfailed: ${parsed.failed}\ntotal: ${parsed.total}\nduration_ms: ${parsed.durationMs}\nsuites: ${parsed.suites}\nfiles: ${JSON.stringify(parsed.files)}\n`;
  } else {
    const passCount = (content.match(/pass|passed|✓|ok/gi) ?? []).length;
    const failCount = (content.match(/fail|failed|✗|error/gi) ?? []).length;
    markerContent = `timestamp: ${timestamp}\noutput_hash: ${hash}\npass_indicators: ${passCount}\nfail_indicators: ${failCount}\n`;
  }

  writeFileSync(resolve(markerDir, 'tested'), markerContent);
  process.stderr.write(`.smith/${slug}/tested created (hash: ${hash.slice(0, 12)}...)\n`);

  updateTaskJson(slug, 'tested');
  return 0;
}

export function updateTaskJson(slug: string, field: 'tested' | 'manualTested'): void {
  let dataRoot: string;
  try {
    dataRoot = resolveDataDir();
  } catch {
    dataRoot = resolvePackageRoot();
  }

  let taskJson = resolveRepoTaskJson(process.cwd(), slug);
  if (!existsSync(taskJson)) taskJson = resolve(dataRoot, 'tasks', 'active', `${slug}.task.json`);
  if (!existsSync(taskJson)) taskJson = resolve(resolvePackageRoot(), 'tasks', 'active', `${slug}.task.json`);
  if (!existsSync(taskJson)) {
    process.stderr.write(`WARNING: task JSON not found for ${slug}\n`);
    return;
  }

  try {
    const data = JSON.parse(readFileSync(taskJson, 'utf-8'));
    data[field] = true;
    writeFileSync(taskJson, JSON.stringify(data, null, 2) + '\n');
  } catch {
    /* best-effort */
  }
}
