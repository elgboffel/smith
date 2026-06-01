import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { updateTaskJson } from './mark-tested.js';

export const description = 'Mark a repo as manually tested (writes .smith/<slug>/manual-tested)';

function resolveTaskSlug(): string | null {
  if (!existsSync('.smith/active')) return null;
  return readFileSync('.smith/active', 'utf-8').trim() || null;
}

function countRecentPngs(dir: string, maxAgeMinutes: number): number {
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
  let count = 0;
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.png')) continue;
      try {
        if (statSync(join(dir, entry)).mtimeMs > cutoff) count++;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* dir unreadable */
  }
  return count;
}

export async function handler(argv: string[]): Promise<number> {
  const slug = resolveTaskSlug();
  if (!slug) {
    process.stderr.write('ERROR: No active task — .smith/active is missing or empty. Run the orchestrator first.\n');
    return 1;
  }

  const markerDir = `.smith/${slug}`;
  mkdirSync(markerDir, { recursive: true });
  const timestamp = new Date().toISOString();
  const mode = argv.includes('--library') ? 'library' : 'playwright';
  let evidenceDetails = '';

  if (mode === 'library') {
    if (process.stdin.isTTY) {
      process.stderr.write(
        'REFUSED: No test output piped to stdin. Usage: pnpm test 2>&1 | smith mark-manual-tested --library\n',
      );
      return 1;
    }
    const content = await new Response(process.stdin as unknown as ReadableStream).text();
    if (content.length < 10) {
      process.stderr.write('REFUSED: No test output piped to stdin.\n');
      return 1;
    }
    const hash = createHash('sha256').update(content).digest('hex');
    const passCount = (content.match(/pass|passed|✓|ok/gi) ?? []).length;
    if (passCount < 1) {
      process.stderr.write('REFUSED: Test output contains no pass indicators. Tests may have failed.\n');
      return 1;
    }
    evidenceDetails = `library-test-verification: output_hash=${hash.slice(0, 16)} pass_indicators=${passCount}`;
  } else {
    // Search the capture dirs the browser-automation skill writes to, plus the
    // task's own assets dir (where uploaded before/after shots land).
    const searchDirs = ['.playwright-cli', `${markerDir}/assets`, '/tmp'];
    let location = '';
    let screenshotCount = 0;
    for (const dir of searchDirs) {
      const count = countRecentPngs(dir, 60);
      if (count > screenshotCount) {
        screenshotCount = count;
        location = dir;
      }
    }
    if (screenshotCount === 0) {
      process.stderr.write(
        'REFUSED: No evidence of manual testing found.\n\nExpected recent screenshots in one of:\n  - .playwright-cli/ (browser-automation skill output)\n  - .smith/<slug>/assets/ (uploaded evidence)\n  - /tmp\n\nTest the app in the browser first, then re-run this script.\n',
      );
      return 1;
    }
    // A UI change needs a BEFORE and an AFTER so the reviewer can compare. A
    // single screenshot proves a state, not a change.
    if (screenshotCount < 2) {
      process.stderr.write(
        `REFUSED: Only ${screenshotCount} recent screenshot found in ${location}.\n\nUI verification requires at least a BEFORE and an AFTER screenshot so the\nchange can be compared. Capture the initial state before interacting, then\nthe state after exercising the fix, and re-run this script.\n`,
      );
      return 1;
    }
    evidenceDetails = `screenshots: ${screenshotCount} files in ${location} (last hour, before+after)`;
  }

  writeFileSync(resolve(markerDir, 'manual-tested'), `timestamp: ${timestamp}\nevidence: ${evidenceDetails}\n`);
  process.stderr.write(`.smith/${slug}/manual-tested created (${evidenceDetails})\n`);
  updateTaskJson(slug, 'manualTested');
  return 0;
}
