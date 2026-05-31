import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { mockSpawnAgent, mockRunCommand } from './mocks.js';
import type { AgentResult, PipelineConfig } from '../types.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const { runClosePhase } = await import('../phases/close.js');

const tempCaseRoot = join(process.env.TMPDIR ?? '/tmp', `case-close-test-${Date.now()}`);

async function setupTempFiles() {
  await mkdir(join(tempCaseRoot, 'agents'), { recursive: true });
  await mkdir(join(tempCaseRoot, '.smith'), { recursive: true });
  await Bun.write(join(tempCaseRoot, 'agents/closer.md'), '# Closer');
}

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    mode: 'attended',
    taskJsonPath: join(tempCaseRoot, '.smith/tasks/active/cli-1.task.json'),
    taskMdPath: join(tempCaseRoot, '.smith/tasks/active/cli-1.md'),
    repoPath: tempCaseRoot,
    repoName: 'cli',
    packageRoot: tempCaseRoot,
    dataDir: tempCaseRoot,
    maxRetries: 1,
    dryRun: false,
    ...overrides,
  };
}

function makeMockStore() {
  return {
    read: mock(() =>
      Promise.resolve({
        id: 'cli-1',
        status: 'active',
        created: '2026-03-14T00:00:00Z',
        repo: 'cli',
        agents: {},
        tested: false,
        manualTested: false,
        prUrl: null,
        prNumber: null,
      }),
    ),
    readStatus: mock(() => Promise.resolve('active')),
    setStatus: mock(() => Promise.resolve(undefined)),
    setAgentPhase: mock(() => Promise.resolve(undefined)),
    setField: mock(() => Promise.resolve(undefined)),
  };
}

const completedResult: AgentResult = {
  status: 'completed',
  summary: 'Closed: issue flipped to done',
  artifacts: {
    commit: null,
    filesChanged: [],
    testsPassed: null,
    screenshotUrls: [],
    evidenceMarkers: [],
    prUrl: null,
    prNumber: null,
  },
  error: null,
};

describe('runClosePhase (commit-only close)', () => {
  beforeEach(async () => {
    mockSpawnAgent.mockReset();
    mockRunCommand.mockReset();
    mockRunCommand.mockResolvedValue({ stdout: '{}', stderr: '', exitCode: 0 });
    await setupTempFiles();
  });

  afterAll(async () => {
    await rm(tempCaseRoot, { recursive: true, force: true });
  });

  it('success advances to retrospective and records no PR', async () => {
    mockSpawnAgent.mockResolvedValue({ raw: '', result: completedResult, durationMs: 100 });

    const store = makeMockStore();
    const output = await runClosePhase(makeConfig(), store as any, new Map());

    expect(output.nextPhase).toBe('retrospective');
    expect(output.outcome).toEqual({ phase: 'close', outcome: 'success' });

    // Commit-only close never writes PR bookkeeping.
    const fields = store.setField.mock.calls.map((c) => c[0]);
    expect(fields).not.toContain('prUrl');
    expect(fields).not.toContain('prNumber');
  });

  it('a github-flavored failure is never classified as fail-github-unreachable', async () => {
    const failed: AgentResult = {
      ...completedResult,
      status: 'failed',
      summary: 'Failed',
      error: 'gh rate limit network github error',
    };
    mockSpawnAgent.mockResolvedValue({ raw: '', result: failed, durationMs: 100 });

    const store = makeMockStore();
    const output = await runClosePhase(makeConfig(), store as any, new Map());

    expect(output.nextPhase).toBe('abort');
    expect(output.outcome?.outcome).not.toBe('fail-github-unreachable');
  });
});
