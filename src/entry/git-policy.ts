import type { DispatchMode } from './dispatch-resolver.js';

/**
 * Which git mutations the pipeline may perform, gated on dispatch mode.
 *
 * Direct dispatch is fully local: no branch, no commit, no `.gitignore` edit —
 * the human owns git. Legacy modes keep the managed behaviour.
 */
export interface GitPolicy {
  readonly createsBranch: boolean;
  readonly ensuresIgnored: boolean;
  readonly commits: boolean;
}

const DIRECT_POLICY: GitPolicy = { createsBranch: false, ensuresIgnored: false, commits: false };
const MANAGED_POLICY: GitPolicy = { createsBranch: true, ensuresIgnored: true, commits: true };

/** Resolve the git policy for a dispatch mode. */
export function gitPolicyForMode(mode: DispatchMode): GitPolicy {
  return mode === 'direct' ? DIRECT_POLICY : MANAGED_POLICY;
}
