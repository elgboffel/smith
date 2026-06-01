import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, resolve } from 'node:path';
import { resolveActiveSlug, resolveDataDir, resolveRepoActiveTaskDir } from '../paths.js';

export const description = "Copy a screenshot or video into the active task's assets dir, print markdown reference";

const FALLBACK_ASSETS_DIR = '.smith/assets';

/**
 * Resolve the local directory where assets are stored.
 *
 * Precedence:
 *   1. SMITH_ASSETS_DIR env — explicit per-invocation override, always wins.
 *   2. `.smith/<active-slug>/assets` — when a task is active, task-scoping wins
 *      over the config setting. Co-locating evidence with the task's markers is
 *      what `mark-manual-tested` (and the before/after ≥2 gate) depends on, so a
 *      stale global `assetsDir` must not silently scatter a run's screenshots
 *      into a shared dir the marker commands don't search.
 *   3. config.json `assetsDir` — used when no task is active (e.g. ad-hoc uploads).
 *   4. `.smith/assets` — shared fallback when neither applies.
 *
 * Relative values resolve against the current working directory (the target
 * repo the agent is operating in). Nothing is ever pushed to a remote.
 */
function getAssetsDir(): string {
  if (process.env.SMITH_ASSETS_DIR) return resolve(process.cwd(), process.env.SMITH_ASSETS_DIR);

  // Task-scoping wins over the config setting: a run's evidence must land where
  // the marker commands look for it.
  const slug = resolveActiveSlug();
  if (slug) return resolve(process.cwd(), `.smith/${slug}/assets`);

  let configuredDir: string | undefined;
  let configPath: string | undefined;
  try {
    configPath = resolve(resolveDataDir(), 'config.json');
  } catch {
    /* no data dir */
  }
  if (configPath && existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (typeof config.assetsDir === 'string' && config.assetsDir) configuredDir = config.assetsDir;
    } catch {
      /* malformed config — fall back to default */
    }
  }
  if (configuredDir) return isAbsolute(configuredDir) ? configuredDir : resolve(process.cwd(), configuredDir);

  return resolve(process.cwd(), FALLBACK_ASSETS_DIR);
}

/**
 * Copy `file` into `dir`, returning the absolute destination path. Overwrites by
 * name.
 *
 * The path is deliberately absolute: the markdown reference it produces gets
 * pasted into task files under `.smith/tasks/active/`, while assets live under
 * the active task's `.smith/<slug>/assets/`. A cwd-relative link would resolve against the task file's
 * own directory and break. Everything here is local + gitignored (never pushed),
 * so an absolute machine-local path is the only reference that renders reliably
 * regardless of which file embeds it.
 */
function storeAsset(file: string, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const dest = resolve(dir, basename(file));
  copyFileSync(file, dest);
  return dest;
}

/**
 * Append `markdown` to the active task's Progress Log under an auto-managed
 * "### Evidence (auto-captured)" heading.
 *
 * This decouples evidence-in-task from agent good behavior. The scout is
 * read-only — it can run `smith upload` but cannot edit the task file itself —
 * and a verifier's closing turn can be aborted mid-summary, losing the image
 * references. Writing the ref here means captured evidence lands in the task
 * file regardless of which agent uploaded it or whether its final turn
 * completed. Idempotent: a ref already present is skipped. Best-effort: any
 * failure (no active task, missing file, write error) is silently ignored so a
 * successful upload never reports failure on account of bookkeeping.
 */
function recordEvidenceRef(markdown: string): void {
  const slug = resolveActiveSlug();
  if (!slug) return;
  let taskMd: string;
  try {
    taskMd = resolve(resolveRepoActiveTaskDir(process.cwd()), `${slug}.md`);
  } catch {
    return;
  }
  if (!existsSync(taskMd)) return;

  let content: string;
  try {
    content = readFileSync(taskMd, 'utf-8');
  } catch {
    return;
  }
  if (content.includes(markdown)) return; // already recorded

  const heading = '### Evidence (auto-captured)';
  const bullet = `- ${markdown}`;

  try {
    if (!content.includes(heading)) {
      const prefix = content.endsWith('\n') ? '' : '\n';
      appendFileSync(taskMd, `${prefix}\n${heading}\n\n${bullet}\n`);
      return;
    }
    // Heading exists — group the new bullet with the existing evidence bullets.
    const lines = content.split('\n');
    const headingIdx = lines.findIndex((l) => l.trim() === heading);
    let insertAt = headingIdx + 1;
    while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
    while (insertAt < lines.length && lines[insertAt].startsWith('- ')) insertAt++;
    lines.splice(insertAt, 0, bullet);
    writeFileSync(taskMd, lines.join('\n'));
  } catch {
    /* best-effort — never fail an upload over Progress Log bookkeeping */
  }
}

export async function handler(argv: string[]): Promise<number> {
  const filePath = argv.find((a) => !a.startsWith('--'));
  if (!filePath || !existsSync(filePath)) {
    process.stderr.write(`upload: file not found: ${filePath ?? '<none>'}\n`);
    return 1;
  }

  const assetsDir = getAssetsDir();
  const ext = extname(filePath).slice(1).toLowerCase();
  const filename = basename(filePath);

  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    const dest = storeAsset(filePath, assetsDir);
    const markdown = `![${filename}](${dest})`;
    process.stderr.write(`Stored ${filename} -> ${dest}\n`);
    process.stdout.write(`${markdown}\n`);
    recordEvidenceRef(markdown);
  } else if (['mp4', 'mov', 'webm'].includes(ext)) {
    const sourcePath = filePath;
    if (ext === 'webm') {
      const ffmpegCheck = Bun.spawn(['which', 'ffmpeg'], { stdout: 'ignore', stderr: 'ignore' });
      if ((await ffmpegCheck.exited) === 0) {
        const stem = basename(filePath, `.${ext}`);
        const mp4Path = resolve(assetsDir, `${stem}.mp4`);
        mkdirSync(assetsDir, { recursive: true });
        process.stderr.write('Converting webm to mp4...\n');
        const convert = Bun.spawn(
          [
            'ffmpeg',
            '-y',
            '-i',
            filePath,
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
            mp4Path,
          ],
          { stdout: 'ignore', stderr: 'ignore' },
        );
        if ((await convert.exited) === 0) {
          const markdown = `[▶ Verification video](${mp4Path})`;
          process.stderr.write(`Stored ${basename(mp4Path)} -> ${mp4Path}\n`);
          process.stdout.write(`${markdown}\n`);
          recordEvidenceRef(markdown);
          return 0;
        }
        process.stderr.write('ffmpeg conversion failed — storing original webm.\n');
      }
    }
    const dest = storeAsset(sourcePath, assetsDir);
    const markdown = `[▶ Verification video](${dest})`;
    process.stderr.write(`Stored ${basename(dest)} -> ${dest}\n`);
    process.stdout.write(`${markdown}\n`);
    recordEvidenceRef(markdown);
  } else {
    const dest = storeAsset(filePath, assetsDir);
    const markdown = `[${filename}](${dest})`;
    process.stderr.write(`Stored ${filename} -> ${dest}\n`);
    process.stdout.write(`${markdown}\n`);
    recordEvidenceRef(markdown);
  }
  return 0;
}
