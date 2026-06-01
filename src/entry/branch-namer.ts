import { basename, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { slugify } from '../util/slugify.js';
import { createLogger } from '../util/logger.js';
import { analyzePrdForBranch } from './prd-branch-analyzer.js';

const log = createLogger();

/** A branch name and the conventional-commit prefix it was derived with. */
export interface DerivedBranch {
  readonly name: string;
  readonly prefix: string;
}

/**
 * The PRD-analysis seam: synthesize a branch from the PRD at `prdPath`. The
 * default reads the file and runs an agent; tests inject a mock so the fallback
 * is exercised without a real agent or filesystem.
 */
export type PrdBranchAnalyzer = (prdPath: string) => Promise<DerivedBranch>;

/**
 * Folder names too generic to make a meaningful branch — they describe a
 * container, not the work. A generic name triggers the PRD-analysis fallback.
 */
const GENERIC_FOLDER_NAMES: ReadonlySet<string> = new Set([
  'issues',
  'issue',
  'scratch',
  'tmp',
  'temp',
  'tasks',
  'task',
  'work',
  'prd',
  'prds',
]);

/** Resolution input for {@link BranchNamer.resolve}. */
export interface ResolveBranchInput {
  /** Absolute path of the folder being dispatched. */
  readonly folderPath: string;
  /** Explicit PRD path; when omitted, the namer locates one near the folder. */
  readonly prdPath?: string;
}

/**
 * A folder name is meaningful when it isn't a generic container word — i.e. it
 * names the work, not just where issues happen to live.
 */
export function isMeaningfulFolderName(folderName: string): boolean {
  const slug = slugify(folderName);
  if (slug.length === 0) return false;
  const words = slug.split('-').filter(Boolean);
  if (words.length === 1 && GENERIC_FOLDER_NAMES.has(words[0]!)) return false;
  return true;
}

/**
 * Derive a conventional-commit branch prefix from a set of tokens (labels or
 * folder-name words). Default `fix`; `feat` for feature/enhancement signals;
 * `chore` for maintenance/docs signals.
 */
export function deriveBranchPrefix(tokens: readonly string[]): string {
  const lowered = tokens.map((token) => token.toLowerCase());
  if (lowered.some((token) => token.includes('feature') || token.includes('enhancement'))) return 'feat';
  if (lowered.some((token) => token.includes('chore') || token.includes('maintenance') || token.includes('docs'))) {
    return 'chore';
  }
  return 'fix';
}

/**
 * BranchNamer — derives the single branch a folder-dispatch batch runs on.
 *
 * The folder-name path slugifies the directory name and picks a prefix from its
 * words. The PRD-analysis fallback (for non-meaningful names) is a separate
 * slice; here a generic name simply yields a basic `fix/<slug>` branch.
 */
export class BranchNamer {
  private readonly analyzePrd: PrdBranchAnalyzer;

  constructor(analyzePrd: PrdBranchAnalyzer = analyzePrdForBranch) {
    this.analyzePrd = analyzePrd;
  }

  /** Derive a branch `{ name, prefix }` from a folder name. */
  fromFolderName(folderName: string): DerivedBranch {
    const prefix = deriveBranchPrefix(folderName.split(/[^a-zA-Z0-9]+/).filter(Boolean));
    return { prefix, name: `${prefix}/${slugify(folderName)}` };
  }

  /**
   * Resolve the single branch for a folder-dispatch batch. A meaningful folder
   * name wins (no agent call). Otherwise the namer locates the PRD in/near the
   * folder and synthesizes a name from it via the agent seam, falling back to
   * the folder-name path when no PRD is found.
   */
  async resolve(input: ResolveBranchInput): Promise<DerivedBranch> {
    const folderName = basename(input.folderPath);
    if (isMeaningfulFolderName(folderName)) {
      return this.fromFolderName(folderName);
    }

    const prdPath = input.prdPath ?? (await locatePrd(input.folderPath));
    if (prdPath !== undefined) {
      log.info('synthesizing branch from PRD', { folderPath: input.folderPath, prdPath });
      return this.analyzePrd(prdPath);
    }

    log.info('no PRD found; deriving branch from generic folder name', { folderPath: input.folderPath });
    return this.fromFolderName(folderName);
  }
}

/**
 * Locate a PRD in or near `folderPath`: a `prd*.md` file in the folder itself,
 * then walking up to a `.scratch/prd/<slug>/prd.md` co-location. Returns the
 * absolute path, or `undefined` when none is found.
 */
async function locatePrd(folderPath: string): Promise<string | undefined> {
  for (let dir = folderPath; ; ) {
    const match = await findPrdFile(dir);
    if (match !== undefined) return match;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Return the first `prd*.md` file directly inside `dir`, if any. */
async function findPrdFile(dir: string): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return undefined;
  }
  const match = entries.filter((name) => /^prd.*\.md$/i.test(name)).sort()[0];
  return match !== undefined ? join(dir, match) : undefined;
}
