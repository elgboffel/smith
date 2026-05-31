import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handler } from '../commands/promote.js';
import { LearningsStore } from '../memory/learnings-store.js';
import { PromotionStore } from '../promotion/promotion-store.js';

describe('promote command', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'promote-cmd-'));
    process.env.SMITH_HARNESS_ROOT = root;
    mkdirSync(join(root, 'projects'), { recursive: true });
    writeFileSync(
      join(root, 'projects', 'cli.json'),
      JSON.stringify({ name: 'cli', path: '/tmp/cli', promoteTo: 'CONTEXT.md' }),
    );
  });

  afterEach(() => {
    delete process.env.SMITH_HARNESS_ROOT;
    rmSync(root, { recursive: true, force: true });
  });

  async function seedProposal() {
    const learnings = new LearningsStore(join(root, 'learnings'));
    const store = new PromotionStore({ proposalsBase: join(root, 'proposals'), learnings });
    for (let i = 0; i < 3; i++) {
      await store.record({ key: 'cli', slug: 'mw-order', text: 'middleware order matters', promoteTo: 'CONTEXT.md' });
    }
    return store;
  }

  it('errors when the repo argument is missing', async () => {
    expect(await handler([])).toBe(1);
  });

  it('lists pending proposals for a repo', async () => {
    await seedProposal();
    const code = await handler(['cli']);
    expect(code).toBe(0);
  });

  it('rejects a proposal by slug, suppressing re-proposal', async () => {
    await seedProposal();
    const code = await handler(['cli', '--reject', 'mw-order']);
    expect(code).toBe(0);

    const store = new PromotionStore({
      proposalsBase: join(root, 'proposals'),
      learnings: new LearningsStore(join(root, 'learnings')),
    });
    expect((await store.list('cli')).length).toBe(0);
  });
});
