import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningsStore } from '../../src/memory/learnings-store.js';

function tmpBase(): string {
  return mkdtempSync(join(tmpdir(), 'learnings-test-'));
}

describe('LearningsStore', () => {
  let basePath: string;
  let store: LearningsStore;

  beforeEach(() => {
    basePath = tmpBase();
    store = new LearningsStore(basePath);
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  describe('read', () => {
    it('always includes _general.md in the read set', async () => {
      const keyDir = join(basePath, 'cli');
      mkdirSync(keyDir, { recursive: true });
      writeFileSync(join(keyDir, '_general.md'), '- **2026-05-31** — always loaded\n');

      const result = await store.read('cli');
      expect(result.sources).toContain('_general.md');
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].text).toContain('always loaded');
    });

    it('loads domain files only for touched areas', async () => {
      const keyDir = join(basePath, 'cli');
      mkdirSync(keyDir, { recursive: true });
      writeFileSync(join(keyDir, '_general.md'), '- **2026-05-31** — general entry\n');
      writeFileSync(join(keyDir, 'middleware.md'), '- **2026-05-31** — middleware entry\n');
      writeFileSync(join(keyDir, 'auth.md'), '- **2026-05-31** — auth entry\n');

      const result = await store.read('cli', ['middleware']);
      expect(result.sources).toContain('_general.md');
      expect(result.sources).toContain('middleware.md');
      expect(result.sources).not.toContain('auth.md');
      expect(result.entries.length).toBe(2);
    });

    it('returns empty result for non-existent key', async () => {
      const result = await store.read('nonexistent');
      expect(result.sources).toEqual([]);
      expect(result.entries).toEqual([]);
    });
  });

  describe('append', () => {
    it('defaults to _general.md and creates file if needed', async () => {
      await store.append('cli', 'mock next/headers as module not individual exports');

      const result = await store.read('cli');
      expect(result.sources).toContain('_general.md');
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].text).toContain('mock next/headers');
      expect(result.entries[0].source).toBe('_general.md');
    });

    it('writes to explicit area file when area is specified', async () => {
      await store.append('cli', 'middleware needs special handling', 'middleware');

      const result = await store.read('cli', ['middleware']);
      expect(result.sources).toContain('middleware.md');
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].source).toBe('middleware.md');
      expect(result.entries[0].text).toContain('middleware needs special handling');
    });

    it('promotes entries to domain file when area accumulates 3+ entries in _general', async () => {
      // Append 3 entries mentioning 'middleware' area to _general
      await store.append('cli', 'middleware: first learning');
      await store.append('cli', 'middleware: second learning');
      await store.append('cli', 'middleware: third learning');

      // After threshold, entries should appear in middleware.md
      const result = await store.read('cli', ['middleware']);
      expect(result.sources).toContain('middleware.md');
      const mwEntries = result.entries.filter((e) => e.source === 'middleware.md');
      expect(mwEntries.length).toBe(3);

      // _general should no longer have those entries
      const generalEntries = result.entries.filter((e) => e.source === '_general.md' && e.text.includes('middleware:'));
      expect(generalEntries.length).toBe(0);
    });
  });

  describe('markPromoted', () => {
    it('excludes entry from read results while keeping it on disk', async () => {
      const keyDir = join(basePath, 'cli');
      mkdirSync(keyDir, { recursive: true });
      writeFileSync(
        join(keyDir, '_general.md'),
        '- **2026-05-31** \u2014 first entry\n- **2026-05-31** \u2014 second entry\n',
      );

      // Read to get the slug of first entry
      const before = await store.read('cli');
      expect(before.entries.length).toBe(2);
      const slug = before.entries[0].slug;

      await store.markPromoted('cli', slug);

      const after = await store.read('cli');
      expect(after.entries.length).toBe(1);
      expect(after.entries[0].text).toContain('second entry');

      // File on disk still has both lines
      const raw = readFileSync(join(keyDir, '_general.md'), 'utf-8');
      expect(raw).toContain('first entry');
      expect(raw).toContain('second entry');
    });

    it('is idempotent — marking already-promoted entry is a no-op', async () => {
      const keyDir = join(basePath, 'cli');
      mkdirSync(keyDir, { recursive: true });
      writeFileSync(join(keyDir, '_general.md'), '- **2026-05-31** \u2014 only entry\n');

      const before = await store.read('cli');
      const slug = before.entries[0].slug;

      await store.markPromoted('cli', slug);
      await store.markPromoted('cli', slug); // second call

      const after = await store.read('cli');
      expect(after.entries.length).toBe(0);

      // .promoted file doesn't explode
      const promotedRaw = readFileSync(join(keyDir, '.promoted'), 'utf-8');
      expect(promotedRaw.split('\n').filter(Boolean).length).toBe(2); // dupes allowed, still works
    });
  });
});
