import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningsStore } from '../../src/memory/learnings-store.js';
import { PromotionStore } from '../../src/promotion/promotion-store.js';
import type { RecordInput } from '../../src/promotion/promotion-store.js';

function tmpBase(): string {
  return mkdtempSync(join(tmpdir(), 'promotion-test-'));
}

describe('PromotionStore', () => {
  let root: string;
  let learnings: LearningsStore;
  let store: PromotionStore;

  beforeEach(() => {
    root = tmpBase();
    learnings = new LearningsStore(join(root, 'learnings'));
    store = new PromotionStore({ proposalsBase: join(root, 'proposals'), learnings });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('record (retrospective append, no gate)', () => {
    it('appends the learning to the store immediately, with no human gate', async () => {
      await store.record({
        key: 'cli',
        slug: 'mock-next-headers',
        text: 'mock next/headers as a module, not individual exports',
        promoteTo: 'CONTEXT.md',
      });

      const result = await learnings.read('cli');
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].text).toContain('mock next/headers');
    });
  });

  describe('recurrence', () => {
    it('bumps hits for a repeated slug instead of duplicating the learning', async () => {
      const first = await store.record({
        key: 'cli',
        slug: 'mw-order',
        text: 'middleware order matters',
        promoteTo: 'CONTEXT.md',
      });
      const second = await store.record({
        key: 'cli',
        slug: 'mw-order',
        text: 'middleware order matters',
        promoteTo: 'CONTEXT.md',
      });

      expect(first.hits).toBe(1);
      expect(second.hits).toBe(2);
    });
  });

  describe('threshold', () => {
    async function bump(times: number, over: Partial<RecordInput> = {}) {
      let last;
      for (let i = 0; i < times; i++) {
        last = await store.record({
          key: 'cli',
          slug: 'mw-order',
          text: 'middleware order matters',
          promoteTo: 'CONTEXT.md',
          ...over,
        });
      }
      return last!;
    }

    it('does not propose before the default threshold of 3', async () => {
      const r = await bump(2);
      expect(r.action).toBe('recorded');
      expect((await store.list('cli')).length).toBe(0);
    });

    it('emits exactly one proposal at the threshold and never duplicates', async () => {
      const third = await bump(3);
      expect(third.action).toBe('proposed');
      expect(third.proposal?.slug).toBe('mw-order');
      expect(third.proposal?.text).toContain('middleware order matters');

      const fourth = await store.record({
        key: 'cli',
        slug: 'mw-order',
        text: 'middleware order matters',
        promoteTo: 'CONTEXT.md',
      });
      expect(fourth.hits).toBe(4);
      expect(fourth.action).toBe('recorded');

      const pending = await store.list('cli');
      expect(pending.length).toBe(1);
    });

    it('honours a per-repo threshold override', async () => {
      const second = await bump(2, { threshold: 2 });
      expect(second.action).toBe('proposed');
      expect((await store.list('cli')).length).toBe(1);
    });
  });

  describe('promoteTo: null (durable, no repo writes)', () => {
    it('flags recurring learnings durable, emits no proposal', async () => {
      let last;
      for (let i = 0; i < 3; i++) {
        last = await store.record({ key: 'skills', slug: 'pnpm-quirk', text: 'pnpm hoisting quirk', promoteTo: null });
      }
      expect(last!.action).toBe('durable');
      expect(last!.proposal).toBeUndefined();
      expect((await store.list('skills')).length).toBe(0);
    });
  });

  describe('reject', () => {
    it('suppresses re-proposal by key and removes it from the pending list', async () => {
      for (let i = 0; i < 3; i++) {
        await store.record({ key: 'cli', slug: 'mw-order', text: 'middleware order matters', promoteTo: 'CONTEXT.md' });
      }
      expect((await store.list('cli')).length).toBe(1);

      await store.reject('cli', 'mw-order');
      expect((await store.list('cli')).length).toBe(0);

      const again = await store.record({
        key: 'cli',
        slug: 'mw-order',
        text: 'middleware order matters',
        promoteTo: 'CONTEXT.md',
      });
      expect(again.action).toBe('suppressed');
      expect((await store.list('cli')).length).toBe(0);
    });
  });

  describe('apply (real temp git repo)', () => {
    function initRepo(): string {
      const repo = mkdtempSync(join(tmpdir(), 'promotion-repo-'));
      const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
      git('init', '-q');
      git('config', 'user.email', 'a@b.c');
      git('config', 'user.name', 'Test');
      writeFileSync(join(repo, 'CONTEXT.md'), '# Context\n');
      git('add', '-A');
      git('commit', '-qm', 'init');
      return repo;
    }

    it('writes to promoteTo, commits locally (no push), flips statuses, keeps promoted learnings on disk', async () => {
      const repo = initRepo();
      let sourceSlug = '';
      for (let i = 0; i < 3; i++) {
        await store.record({
          key: 'cli',
          slug: 'mw-order',
          text: 'middleware order matters in cli',
          promoteTo: 'CONTEXT.md',
        });
      }
      sourceSlug = (await learnings.read('cli')).entries[0].slug;

      const applied = await store.apply('cli', 'mw-order', { repoDir: repo });
      expect(applied.status).toBe('applied');
      expect(applied.sources).toContain(sourceSlug);

      // Drafted text landed in the sink
      const sink = readFileSync(join(repo, 'CONTEXT.md'), 'utf-8');
      expect(sink).toContain('middleware order matters');

      // Exactly one new commit on the current branch, clean tree
      const log = execFileSync('git', ['log', '--oneline'], { cwd: repo }).toString().trim().split('\n');
      expect(log.length).toBe(2);
      const stat = execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString().trim();
      expect(stat).toBe('');

      // No remote configured — nothing was pushed
      const remotes = execFileSync('git', ['remote'], { cwd: repo }).toString().trim();
      expect(remotes).toBe('');

      // Proposal flipped to applied, no longer pending
      expect((await store.list('cli')).length).toBe(0);

      // Source learning marked promoted: hidden from read, still on disk
      const read = await learnings.read('cli');
      expect(read.entries.find((e) => e.slug === sourceSlug)).toBeUndefined();
      const onDisk = readFileSync(join(root, 'learnings', 'cli', '_general.md'), 'utf-8');
      expect(onDisk).toContain('middleware order matters');

      rmSync(repo, { recursive: true, force: true });
    });
  });
});
