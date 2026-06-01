import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type DispatchMode = 'direct' | 'github' | 'linear' | 'freeform';

export interface DirectDispatch {
  readonly mode: 'direct';
  /** Absolute paths of the issue files to run (one for direct dispatch). */
  readonly issuePaths: readonly string[];
  /** Absolute path of the working tree the agent edits. */
  readonly workspacePath: string;
}

export interface LegacyDispatch {
  readonly mode: 'github' | 'linear' | 'freeform';
  readonly argument: string;
}

export type DispatchResolution = DirectDispatch | LegacyDispatch;

export interface ResolveDispatchOptions {
  /** Absolute paths of registered project roots; the workspace is the deepest match. */
  readonly projectRoots: readonly string[];
}

/**
 * Classify a CLI positional argument and resolve where the work happens.
 *
 * A `.md` file argument is `direct` dispatch: the issue is read from the file
 * and the workspace is resolved by walking up to the containing project root.
 * Everything else falls through to the legacy detection (github/linear/freeform).
 */
export async function resolveDispatch(arg: string, opts: ResolveDispatchOptions): Promise<DispatchResolution> {
  if (await isMarkdownFile(arg)) {
    const issuePath = resolve(arg);
    const workspacePath = resolveWorkspace(issuePath, opts.projectRoots);
    return { mode: 'direct', issuePaths: [issuePath], workspacePath };
  }

  if (arg.endsWith('.md')) {
    throw new Error(`Issue file not found: ${arg}`);
  }

  return { mode: detectLegacyMode(arg), argument: arg };
}

/** A `.md` argument that exists as a regular file: direct dispatch. */
async function isMarkdownFile(arg: string): Promise<boolean> {
  if (!arg.endsWith('.md')) return false;
  try {
    return (await stat(arg)).isFile();
  } catch {
    return false;
  }
}

/** Legacy detection: digits = github, `ABC-1` = linear, else freeform. */
function detectLegacyMode(arg: string): 'github' | 'linear' | 'freeform' {
  if (/^\d+$/.test(arg)) return 'github';
  if (/^[A-Z]+-\d+$/.test(arg)) return 'linear';
  return 'freeform';
}

/**
 * Walk up from the issue file to the deepest registered project root that
 * contains it. Replaces the implicit `detectRepo(cwd)` coupling.
 */
function resolveWorkspace(issuePath: string, projectRoots: readonly string[]): string {
  const roots = projectRoots.map((root) => resolve(root));
  let candidate: string | null = null;
  for (let dir = dirname(issuePath); ; dir = dirname(dir)) {
    if (roots.includes(dir)) {
      candidate = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
  }
  if (candidate === null) {
    throw new Error(`No registered project contains the issue file: ${issuePath}`);
  }
  return candidate;
}
