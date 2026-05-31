/**
 * PromotionStore — turns recurring tactical learnings into durable docs behind
 * a single human gate.
 *
 * The retrospective appends learnings to the {@link LearningsStore} directly
 * (no gate). Recurrence is tracked by an agent-assigned `slug` plus an advisory
 * `hits` counter persisted in a per-key ledger. Recurring learnings bump `hits`
 * instead of duplicating. At a threshold (default 3, per-repo override) exactly
 * one proposal is emitted under `proposals/<key>/<slug>.json`.
 *
 * `apply` inserts the drafted text into the project's `promoteTo` sink, commits
 * locally (no push), flips the proposal to `applied`, and marks the source
 * learnings `promoted` (kept on disk for provenance, not reloaded into
 * implementer context). `reject` records the key so the retrospective never
 * re-proposes it. When `promoteTo` is `null`, a recurring learning is flagged
 * `durable` and no proposal is generated and nothing is written into the repo.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { LearningsStore } from '../memory/learnings-store.js';

export const DEFAULT_PROMOTION_THRESHOLD = 3;

export interface PromotionStoreOptions {
  /** Directory that holds per-key proposal state (committed in the harness repo). */
  proposalsBase: string;
  /** Learnings store the retrospective appends into (gateless). */
  learnings: LearningsStore;
}

export interface RecordInput {
  /** Repo key (learnings/proposals namespace). */
  key: string;
  /** Agent-assigned recurrence slug. */
  slug: string;
  /** Drafted durable text for the eventual proposal / learning entry. */
  text: string;
  /** Optional domain area. */
  area?: string;
  /** Threshold override (default 3). */
  threshold?: number;
  /** Promotion sink path, or `null` for repos that take no durable docs. */
  promoteTo?: string | null;
}

export type ProposalStatus = 'pending' | 'applied' | 'rejected';

export interface Proposal {
  key: string;
  slug: string;
  text: string;
  area?: string;
  hits: number;
  status: ProposalStatus;
  /** Promotion sink the drafted text targets. */
  promoteTo: string;
  /** Source learning slugs that fed this proposal (marked promoted on apply). */
  sources: string[];
  createdAt: string;
  appliedAt?: string;
}

export interface ApplyOptions {
  /** Target repo working directory the sink lives in. */
  repoDir: string;
  /** Override the git commit (testing). Defaults to a local `git commit`, never a push. */
  commit?: (repoDir: string, sinkPath: string, message: string) => void;
}

export type RecordAction = 'recorded' | 'proposed' | 'durable' | 'suppressed';

export interface RecordResult {
  /** What happened: just counted, emitted a proposal, flagged durable, or suppressed. */
  action: RecordAction;
  /** Advisory recurrence count for this slug. */
  hits: number;
  /** The freshly emitted proposal, only present when `action === 'proposed'`. */
  proposal?: Proposal;
}

interface LedgerEntry {
  slug: string;
  hits: number;
  text: string;
  area?: string;
  /** Learning-entry slugs (assigned by the LearningsStore) this recurrence produced. */
  sources: string[];
  /** Set once a proposal has been emitted, so we never emit a second. */
  proposed?: boolean;
  /** Set on reject — the retrospective never re-proposes this key. */
  rejected?: boolean;
}

type Ledger = Record<string, LedgerEntry>;

const LEDGER_FILE = '.ledger.json';

export class PromotionStore {
  private readonly proposalsBase: string;
  private readonly learnings: LearningsStore;

  constructor(opts: PromotionStoreOptions) {
    this.proposalsBase = opts.proposalsBase;
    this.learnings = opts.learnings;
  }

  async record(input: RecordInput): Promise<RecordResult> {
    const sourceSlug = await this.learnings.append(input.key, input.text, input.area);

    const ledger = this.loadLedger(input.key);
    const existing = ledger[input.slug];
    const entry: LedgerEntry = existing ?? {
      slug: input.slug,
      hits: 0,
      text: input.text,
      area: input.area,
      sources: [],
    };
    if (!entry.sources) entry.sources = [];
    if (!entry.sources.includes(sourceSlug)) entry.sources.push(sourceSlug);
    entry.hits += 1;
    entry.text = input.text;
    if (input.area !== undefined) entry.area = input.area;
    ledger[input.slug] = entry;

    const threshold = input.threshold ?? DEFAULT_PROMOTION_THRESHOLD;
    let action: RecordAction = 'recorded';
    let proposal: Proposal | undefined;

    if (entry.rejected) {
      action = 'suppressed';
    } else if (entry.hits >= threshold && input.promoteTo === null) {
      // Repo takes no durable docs: flag durable, never propose, write nothing.
      action = 'durable';
    } else if (!entry.proposed && entry.hits >= threshold) {
      proposal = this.emitProposal(input, entry.hits, entry.sources);
      entry.proposed = true;
      action = 'proposed';
    }

    this.saveLedger(input.key, ledger);
    return proposal ? { action, hits: entry.hits, proposal } : { action, hits: entry.hits };
  }

  /**
   * Apply a pending proposal: append the drafted text into the `promoteTo`
   * sink, commit locally (never push), flip the proposal to `applied`, and mark
   * the source learnings `promoted` (kept on disk, dropped from the read set).
   */
  async apply(key: string, slug: string, opts: ApplyOptions): Promise<Proposal> {
    const path = join(this.keyDir(key), `${slug}.json`);
    if (!existsSync(path)) throw new Error(`no proposal for ${key}/${slug}`);
    const proposal = JSON.parse(readFileSync(path, 'utf-8')) as Proposal;
    if (proposal.status !== 'pending') {
      throw new Error(`proposal ${key}/${slug} is ${proposal.status}, not pending`);
    }
    if (!proposal.promoteTo) {
      throw new Error(`proposal ${key}/${slug} has no promoteTo sink`);
    }

    const sinkPath = join(opts.repoDir, proposal.promoteTo);
    appendFileSync(sinkPath, `\n- ${proposal.text}\n`);

    const message = `docs: promote ${slug}`;
    const commit = opts.commit ?? defaultCommit;
    commit(opts.repoDir, proposal.promoteTo, message);

    for (const source of proposal.sources) {
      await this.learnings.markPromoted(key, source);
    }

    return this.setProposalStatus(key, slug, 'applied', { appliedAt: new Date().toISOString() });
  }

  /** Reject a proposal: drop it from the pending set and never re-propose its key. */
  async reject(key: string, slug: string): Promise<void> {
    const ledger = this.loadLedger(key);
    const entry = ledger[slug];
    if (entry) {
      entry.rejected = true;
      this.saveLedger(key, ledger);
    }
    this.setProposalStatus(key, slug, 'rejected');
  }

  private setProposalStatus(key: string, slug: string, status: ProposalStatus, patch?: Partial<Proposal>): Proposal {
    const path = join(this.keyDir(key), `${slug}.json`);
    if (!existsSync(path)) throw new Error(`no proposal for ${key}/${slug}`);
    const proposal = JSON.parse(readFileSync(path, 'utf-8')) as Proposal;
    proposal.status = status;
    Object.assign(proposal, patch);
    writeFileSync(path, JSON.stringify(proposal, null, 2) + '\n');
    return proposal;
  }

  /** List pending proposals for a key. */
  async list(key: string): Promise<Proposal[]> {
    const dir = this.keyDir(key);
    if (!existsSync(dir)) return [];
    const { readdirSync } = await import('node:fs');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json') && f !== LEDGER_FILE)
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Proposal)
      .filter((p) => p.status === 'pending');
  }

  private emitProposal(input: RecordInput, hits: number, sources: string[]): Proposal {
    const proposal: Proposal = {
      key: input.key,
      slug: input.slug,
      text: input.text,
      ...(input.area !== undefined ? { area: input.area } : {}),
      hits,
      status: 'pending',
      promoteTo: input.promoteTo ?? '',
      sources: [...sources],
      createdAt: new Date().toISOString(),
    };
    const dir = this.keyDir(input.key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${input.slug}.json`), JSON.stringify(proposal, null, 2) + '\n');
    return proposal;
  }

  private keyDir(key: string): string {
    return join(this.proposalsBase, key);
  }

  private loadLedger(key: string): Ledger {
    const path = join(this.keyDir(key), LEDGER_FILE);
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf-8')) as Ledger;
  }

  private saveLedger(key: string, ledger: Ledger): void {
    const dir = this.keyDir(key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LEDGER_FILE), JSON.stringify(ledger, null, 2) + '\n');
  }
}

/** Local commit of the sink change — staged narrowly, never pushed. */
function defaultCommit(repoDir: string, sinkRelPath: string, message: string): void {
  execFileSync('git', ['add', '--', sinkRelPath], { cwd: repoDir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: repoDir });
}
