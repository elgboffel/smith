import { slugify } from '../util/slugify.js';

/** A branch name and the conventional-commit prefix it was derived with. */
export interface DerivedBranch {
  readonly name: string;
  readonly prefix: string;
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
  /** Derive a branch `{ name, prefix }` from a folder name. */
  fromFolderName(folderName: string): DerivedBranch {
    const prefix = deriveBranchPrefix(folderName.split(/[^a-zA-Z0-9]+/).filter(Boolean));
    return { prefix, name: `${prefix}/${slugify(folderName)}` };
  }
}
