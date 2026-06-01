import { describe, it, expect } from 'bun:test';
import { runBatch } from '../entry/batch-runner.js';
import type { WorkItem } from '../entry/batch-planner.js';
import type { PipelineOutcome } from '../types.js';
import type { Notifier } from '../notify.js';

/** A no-op notifier that records the messages sent to it. */
function recordingNotifier(): { notifier: Notifier; messages: string[] } {
  const messages: string[] = [];
  const notifier = {
    send: (message: string) => {
      messages.push(message);
    },
    phaseStart: () => {},
    phaseEnd: () => {},
    askUser: async () => '',
    toolStart: () => {},
    toolEnd: () => {},
    stepIndicator: () => {},
    pipelineComplete: () => {},
    startHeartbeat: () => {},
    stopHeartbeat: () => {},
  } as Notifier;
  return { notifier, messages };
}

function create(issuePath: string): WorkItem {
  return { kind: 'create', issuePath };
}

function resume(issuePath: string): WorkItem {
  // The TaskMatch shape is irrelevant to runBatch — it only drives the runner.
  return { kind: 'resume', issuePath, match: {} as never };
}

describe('runBatch', () => {
  it('halts at the first failed item and does not process later items', async () => {
    const items = [create('01.md'), create('02.md'), create('03.md')];
    const seen: string[] = [];
    const runItem = async (item: WorkItem): Promise<PipelineOutcome> => {
      seen.push(item.issuePath);
      return item.issuePath === '02.md' ? 'failed' : 'completed';
    };
    const { notifier } = recordingNotifier();

    const result = await runBatch(items, runItem, notifier);

    expect(seen).toEqual(['01.md', '02.md']);
    expect(result.halted).toBe(true);
    expect(result.haltedAt).toBe('02.md');
  });

  it('processes every item and reports complete when each succeeds', async () => {
    const items = [resume('01.md'), create('02.md'), create('03.md')];
    const seen: string[] = [];
    const runItem = async (item: WorkItem): Promise<PipelineOutcome> => {
      seen.push(item.issuePath);
      return 'completed';
    };
    const { notifier, messages } = recordingNotifier();

    const result = await runBatch(items, runItem, notifier);

    expect(seen).toEqual(['01.md', '02.md', '03.md']);
    expect(result.halted).toBe(false);
    expect(result.processed).toBe(3);
    expect(messages.some((m) => m.includes('3 issue(s) processed'))).toBe(true);
  });

  it('treats a thrown error (agent crash) as a halt and stops the batch', async () => {
    const items = [create('01.md'), create('02.md'), create('03.md')];
    const seen: string[] = [];
    const runItem = async (item: WorkItem): Promise<PipelineOutcome> => {
      seen.push(item.issuePath);
      if (item.issuePath === '02.md') throw new Error('agent crashed');
      return 'completed';
    };
    const { notifier, messages } = recordingNotifier();

    const result = await runBatch(items, runItem, notifier);

    expect(seen).toEqual(['01.md', '02.md']);
    expect(result.halted).toBe(true);
    expect(result.haltedAt).toBe('02.md');
    expect(messages.some((m) => m.includes('agent crashed'))).toBe(true);
  });
});
