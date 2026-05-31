import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handler } from '../commands/record.js';
import { LearningsStore } from '../memory/learnings-store.js';
import { PromotionStore } from '../promotion/promotion-store.js';

describe('record command', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'record-cmd-'));
    process.env.SMITH_HARNESS_ROOT = root;
    mkdirSync(join(root, 'projects'), { recursive: true });
    writeFileSync(
      join(root, 'projects', 'cli.json'),
      JSON.stringify({ name: 'cli', path: '/tmp/cli', promoteTo: 'CONTEXT.md', promotionThreshold: 2 }),
    );
  });

  afterEach(() => {
    delete process.env.SMITH_HARNESS_ROOT;
    rmSync(root, { recursive: true, force: true });
  });

  function makeStore() {
    return new PromotionStore({
      proposalsBase: join(root, 'proposals'),
      learnings: new LearningsStore(join(root, 'learnings')),
    });
  }

  it('errors without required --repo/--slug/--text', async () => {
    expect(await handler(['--repo', 'cli', '--slug', 'x'])).toBe(1);
  });

  it('appends a learning with no gate', async () => {
    const code = await handler(['--repo', 'cli', '--slug', 'mw', '--text', 'middleware order matters']);
    expect(code).toBe(0);
    const read = await new LearningsStore(join(root, 'learnings')).read('cli');
    expect(read.entries.length).toBe(1);
  });

  it('emits a proposal once the per-repo threshold is reached', async () => {
    await handler(['--repo', 'cli', '--slug', 'mw', '--text', 'middleware order matters']);
    await handler(['--repo', 'cli', '--slug', 'mw', '--text', 'middleware order matters']);
    expect((await makeStore().list('cli')).length).toBe(1);
  });
});
