/**
 * `smith promote <repo>` — review and apply/reject/skip promotion proposals.
 *
 * Lists the pending proposals a repo's recurring learnings have produced, then
 * applies, rejects, or skips them in a batch:
 *
 *   smith promote cli                       # list pending proposals
 *   smith promote cli --apply <slug>        # write to promoteTo + commit locally
 *   smith promote cli --reject <slug>       # suppress this key forever
 *   smith promote cli --skip <slug>         # leave pending (no-op; default)
 *
 * `--apply`/`--reject`/`--skip` are repeatable. This is the single human gate:
 * nothing reaches a target repo unreviewed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tryResolvePackageRoot } from '../paths.js';
import { LearningsStore } from '../memory/learnings-store.js';
import { PromotionStore } from '../promotion/promotion-store.js';
import type { ProjectEntry } from '../types.js';

export const description = 'Review and apply/reject promotion proposals for a repo';

function resolveHarnessRoot(): string {
  return process.env.SMITH_HARNESS_ROOT
    ? resolve(process.env.SMITH_HARNESS_ROOT)
    : (tryResolvePackageRoot() ?? process.cwd());
}

function loadProject(harnessRoot: string, repo: string): ProjectEntry | null {
  const path = join(harnessRoot, 'projects', `${repo}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as ProjectEntry;
}

interface ParsedArgs {
  repo: string;
  apply: string[];
  reject: string[];
  skip: string[];
}

function parseArgs(argv: string[]): ParsedArgs | null {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const repo = positional[0];
  if (!repo) return null;

  const apply: string[] = [];
  const reject: string[] = [];
  const skip: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') apply.push(argv[++i]!);
    else if (argv[i] === '--reject') reject.push(argv[++i]!);
    else if (argv[i] === '--skip') skip.push(argv[++i]!);
  }
  return { repo, apply, reject, skip };
}

export async function handler(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed) {
    process.stderr.write('ERROR: usage: smith promote <repo> [--apply <slug>] [--reject <slug>] [--skip <slug>]\n');
    return 1;
  }

  const harnessRoot = resolveHarnessRoot();
  const project = loadProject(harnessRoot, parsed.repo);
  if (!project) {
    process.stderr.write(`ERROR: no project config at projects/${parsed.repo}.json\n`);
    return 1;
  }

  const key = project.learningsKey ?? project.name;
  const store = new PromotionStore({
    proposalsBase: join(harnessRoot, 'proposals'),
    learnings: new LearningsStore(join(harnessRoot, 'learnings')),
  });

  // Mutations first: reject then apply.
  for (const slug of parsed.reject) {
    await store.reject(key, slug);
    process.stdout.write(`rejected ${key}/${slug}\n`);
  }
  for (const slug of parsed.apply) {
    if (!project.path) {
      process.stderr.write(`ERROR: project ${key} has no path; cannot apply\n`);
      return 1;
    }
    const applied = await store.apply(key, slug, { repoDir: resolve(project.path) });
    process.stdout.write(`applied ${key}/${slug} → ${applied.promoteTo}\n`);
  }
  for (const slug of parsed.skip) {
    process.stdout.write(`skipped ${key}/${slug} (left pending)\n`);
  }

  // List remaining pending proposals.
  const pending = await store.list(key);
  if (pending.length === 0) {
    process.stdout.write(`No pending proposals for ${key}.\n`);
    return 0;
  }
  process.stdout.write(`Pending proposals for ${key}:\n`);
  for (const p of pending) {
    const sink = project.promoteTo === undefined ? '(unset)' : (project.promoteTo ?? 'null (durable)');
    process.stdout.write(`  ${p.slug}  (hits: ${p.hits}, → ${sink})\n    ${p.text}\n`);
  }
  return 0;
}
