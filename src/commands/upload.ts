import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, extname, isAbsolute, resolve } from 'node:path';
import { resolveDataDir } from '../paths.js';

export const description = 'Copy a screenshot or video into the local assets dir, print markdown reference';

const DEFAULT_ASSETS_DIR = '.smith/assets';

/**
 * Resolve the local directory where assets are stored.
 *
 * Precedence:
 *   1. SMITH_ASSETS_DIR env
 *   2. config.json `assetsDir`
 *   3. `.smith/assets` (gitignored in target repos)
 *
 * Relative values resolve against the current working directory (the target
 * repo the agent is operating in). Nothing is ever pushed to a remote.
 */
function getAssetsDir(): string {
  if (process.env.SMITH_ASSETS_DIR) return resolve(process.cwd(), process.env.SMITH_ASSETS_DIR);

  let dir = DEFAULT_ASSETS_DIR;
  let configPath: string | undefined;
  try {
    configPath = resolve(resolveDataDir(), 'config.json');
  } catch {
    /* no data dir */
  }
  if (configPath && existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (typeof config.assetsDir === 'string' && config.assetsDir) dir = config.assetsDir;
    } catch {
      /* malformed config — fall back to default */
    }
  }
  return isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
}

/**
 * Copy `file` into `dir`, returning the absolute destination path. Overwrites by
 * name.
 *
 * The path is deliberately absolute: the markdown reference it produces gets
 * pasted into task files under `.smith/tasks/active/`, while assets live under
 * `.smith/assets/`. A cwd-relative link would resolve against the task file's
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
    process.stderr.write(`Stored ${filename} -> ${dest}\n`);
    process.stdout.write(`![${filename}](${dest})\n`);
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
          process.stderr.write(`Stored ${basename(mp4Path)} -> ${mp4Path}\n`);
          process.stdout.write(`[▶ Verification video](${mp4Path})\n`);
          return 0;
        }
        process.stderr.write('ffmpeg conversion failed — storing original webm.\n');
      }
    }
    const dest = storeAsset(sourcePath, assetsDir);
    process.stderr.write(`Stored ${basename(dest)} -> ${dest}\n`);
    process.stdout.write(`[▶ Verification video](${dest})\n`);
  } else {
    const dest = storeAsset(filePath, assetsDir);
    process.stderr.write(`Stored ${filename} -> ${dest}\n`);
    process.stdout.write(`[${filename}](${dest})\n`);
  }
  return 0;
}
