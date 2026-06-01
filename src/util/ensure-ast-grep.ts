/**
 * Ensure the `ast-grep` CLI is available on PATH.
 *
 * The implementer's pre-commit AST-lint gate (agents/implementer.md § 3c) shells
 * out to a bare `ast-grep` in the *target* repo. `@ast-grep/cli` is a smith
 * devDependency, so it lives at `smith/node_modules/.bin/ast-grep` — which is not
 * on PATH in the target repo's shell. When it is missing the gate degrades to a
 * silent no-op. `smith init` calls this to install it globally so the gate works.
 *
 * Install uses `bun add -g` because smith runs under bun and ships via `~/.bun/bin`
 * (already on PATH for anyone who can invoke `smith`). Keep the version spec in
 * sync with the `@ast-grep/cli` devDependency in package.json.
 */

import { runCommand } from './run-command.js';

/** Package spec installed when ast-grep is missing. Keep in sync with package.json. */
export const AST_GREP_PACKAGE_SPEC = '@ast-grep/cli@^0.42.3';

export type EnsureAstGrepStatus = 'present' | 'installed' | 'failed' | 'skipped';

export interface EnsureAstGrepResult {
  status: EnsureAstGrepStatus;
  message: string;
}

async function probeVersion(): Promise<string | null> {
  const probe = await runCommand('ast-grep', ['--version'], { timeout: 10_000 });
  return probe.exitCode === 0 ? probe.stdout.trim() || 'version unknown' : null;
}

/**
 * Resolve `ast-grep` on PATH, installing it globally via bun when absent.
 *
 * Fail-soft: any install failure returns `status: 'failed'` with a manual-install
 * hint rather than throwing — callers (init) must not abort on a missing optional
 * lint tool.
 */
export async function ensureAstGrep(opts: { autoInstall?: boolean } = {}): Promise<EnsureAstGrepResult> {
  const autoInstall = opts.autoInstall ?? true;

  const present = await probeVersion();
  if (present) {
    return { status: 'present', message: `ast-grep already present (${present})` };
  }

  if (!autoInstall) {
    return {
      status: 'skipped',
      message: `ast-grep not found on PATH — install with: bun add -g ${AST_GREP_PACKAGE_SPEC}`,
    };
  }

  const install = await runCommand('bun', ['add', '-g', AST_GREP_PACKAGE_SPEC], { timeout: 120_000 });
  if (install.exitCode === 0) {
    const installed = await probeVersion();
    if (installed) {
      return { status: 'installed', message: `Installed ast-grep (${installed})` };
    }
    return {
      status: 'failed',
      message: `Installed ${AST_GREP_PACKAGE_SPEC} but 'ast-grep' is still not on PATH — ensure ~/.bun/bin is in your PATH.`,
    };
  }

  const lastLine = install.stderr.trim().split(/\r?\n/).pop() || 'unknown error';
  return {
    status: 'failed',
    message: `Could not auto-install ast-grep (${lastLine}). Install manually: bun add -g ${AST_GREP_PACKAGE_SPEC}`,
  };
}
