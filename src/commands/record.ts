/**
 * `smith record` — agent-facing entrypoint for the retrospective.
 *
 * Appends a tactical learning to the store (no human gate) and tracks
 * recurrence by an agent-assigned slug. When the per-repo threshold is reached
 * a single promotion proposal is emitted; a human later reviews it with
 * `smith promote`. Nothing reaches a target repo here.
 *
 *   smith record --repo cli --slug mw-order --text "middleware order matters" [--area middleware]
 *
 * Recurrence + promotion config (threshold, promoteTo sink) is read from the
 * repo's `projects/<repo>.json`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tryResolvePackageRoot } from '../paths.js';
import { LearningsStore } from '../memory/learnings-store.js';
import { PromotionStore, DEFAULT_PROMOTION_THRESHOLD } from '../promotion/promotion-store.js';
import type { ProjectEntry } from '../types.js';

export const description = 'Append a learning and track recurrence (retrospective entrypoint)';

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

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

export async function handler(argv: string[]): Promise<number> {
  const repo = flag(argv, '--repo');
  const slug = flag(argv, '--slug');
  const text = flag(argv, '--text');
  const area = flag(argv, '--area');

  if (!repo || !slug || !text) {
    process.stderr.write('ERROR: usage: smith record --repo <repo> --slug <slug> --text <text> [--area <area>]\n');
    return 1;
  }

  const harnessRoot = resolveHarnessRoot();
  const project = loadProject(harnessRoot, repo);
  if (!project) {
    process.stderr.write(`ERROR: no project config at projects/${repo}.json\n`);
    return 1;
  }

  const key = project.learningsKey ?? project.name;
  const store = new PromotionStore({
    proposalsBase: join(harnessRoot, 'proposals'),
    learnings: new LearningsStore(join(harnessRoot, 'learnings')),
  });

  const result = await store.record({
    key,
    slug,
    text,
    ...(area !== undefined ? { area } : {}),
    threshold: project.promotionThreshold ?? DEFAULT_PROMOTION_THRESHOLD,
    promoteTo: project.promoteTo ?? null,
  });

  switch (result.action) {
    case 'proposed':
      process.stdout.write(`recorded (hits: ${result.hits}) — proposal emitted for ${key}/${slug}\n`);
      break;
    case 'durable':
      process.stdout.write(`recorded (hits: ${result.hits}) — flagged durable (promoteTo: null), no proposal\n`);
      break;
    case 'suppressed':
      process.stdout.write(`recorded (hits: ${result.hits}) — previously rejected, suppressed\n`);
      break;
    default:
      process.stdout.write(`recorded (hits: ${result.hits})\n`);
  }
  return 0;
}
