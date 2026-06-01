import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTask } from '../entry/task-factory.js';
import type { TaskCreateRequest } from '../types.js';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('createTask', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tempDir = join(process.env.TMPDIR ?? '/tmp', `case-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates task.json and task.md files', async () => {
    const request: TaskCreateRequest = {
      repo: 'cli',
      title: 'Fix broken test',
      description: 'The login test is failing intermittently.',
      trigger: { type: 'manual', description: 'Created manually' },
      evidenceExpectations: 'Full test suite passes. The flaky login test passes 10 consecutive runs.',
    };

    const result = await createTask(tempDir, request, { repoPath: tempDir });

    expect(result.taskId).toContain('cli-');
    expect(result.taskJsonPath).toContain('.task.json');
    expect(result.taskMdPath).toContain('.md');
    expect(result.taskJsonPath).toContain(join('.smith', 'tasks', 'active'));

    const taskJson = JSON.parse(await Bun.file(result.taskJsonPath).text());
    expect(taskJson.id).toBe(result.taskId);
    expect(taskJson.repo).toBe('cli');
    expect(taskJson.status).toBe('active');
    expect(taskJson.tested).toBe(false);

    const taskMd = await Bun.file(result.taskMdPath).text();
    expect(taskMd).toContain('Fix broken test');
    expect(taskMd).toContain('The login test');
    expect(taskMd).toContain('Repo:** cli');
    expect(taskMd).toContain('## Evidence Expectations');
    expect(taskMd).toContain('flaky login test passes 10 consecutive runs');
    expect((await Bun.file(join(tempDir, '.smith', 'active')).text()).trim()).toBe(result.taskId);
  });

  it('includes issue and trigger info', async () => {
    const request: TaskCreateRequest = {
      repo: 'authkit-session',
      title: 'Fix CI failure: lint',
      description: 'Lint workflow failed.',
      issueType: 'github',
      issue: 'https://github.com/workos/authkit-ssr/issues/42',
      mode: 'unattended',
      trigger: { type: 'webhook', event: 'workflow_run', deliveryId: 'abc-123' },
      evidenceExpectations: 'Lint passes cleanly. No regressions in existing tests.',
    };

    const result = await createTask(tempDir, request, { repoPath: tempDir });
    const taskJson = JSON.parse(await Bun.file(result.taskJsonPath).text());

    expect(taskJson.issueType).toBe('github');
    expect(taskJson.issue).toBe('https://github.com/workos/authkit-ssr/issues/42');
    expect(taskJson.mode).toBe('unattended');

    const taskMd = await Bun.file(result.taskMdPath).text();
    expect(taskMd).toContain('webhook');
  });

  it('writes issuePath from the local-md issueContext sourcePath', async () => {
    const request: TaskCreateRequest = {
      repo: 'cli',
      title: 'Remove highlight',
      description: 'body',
      issueType: 'local-md',
      issue: 'remove-highlight',
      mode: 'attended',
      trigger: { type: 'cli', user: 'local' },
      evidenceExpectations: '',
    };
    const sourcePath = '/abs/path/.scratch/issues/01-remove-highlight.md';
    const result = await createTask(tempDir, request, {
      repoPath: tempDir,
      issueContext: {
        title: 'Remove highlight',
        body: 'body',
        labels: [],
        issueType: 'local-md',
        issueNumber: 'remove-highlight',
        sourcePath,
      },
    });
    const taskJson = JSON.parse(await Bun.file(result.taskJsonPath).text());
    expect(taskJson.issuePath).toBe(sourcePath);
  });

  it('claims the source issue file — flips it to claimed and writes the Task back-link', async () => {
    const sourcePath = join(tempDir, '01-claim-me.md');
    await writeFile(sourcePath, '# Claim me\n\nStatus: ready\n\nBody.\n');

    const request: TaskCreateRequest = {
      repo: 'cli',
      title: 'Claim me',
      description: 'body',
      issueType: 'local-md',
      issue: 'claim-me',
      mode: 'attended',
      trigger: { type: 'cli', user: 'local' },
      evidenceExpectations: '',
    };
    const result = await createTask(tempDir, request, {
      repoPath: tempDir,
      issueContext: {
        title: 'Claim me',
        body: 'body',
        labels: [],
        issueType: 'local-md',
        issueNumber: 'claim-me',
        sourcePath,
      },
    });

    const issue = await readFile(sourcePath, 'utf-8');
    expect(issue).toContain('Status: claimed');
    expect(issue).toContain(`Task: ${result.taskId}`);
  });

  it('leaves issuePath null when no issueContext sourcePath is present', async () => {
    const request: TaskCreateRequest = {
      repo: 'cli',
      title: 'Freeform task',
      description: 'body',
      issueType: 'freeform',
      issue: 'freeform-task',
      mode: 'attended',
      trigger: { type: 'cli', user: 'local' },
      evidenceExpectations: '',
    };
    const result = await createTask(tempDir, request, { repoPath: tempDir });
    const taskJson = JSON.parse(await Bun.file(result.taskJsonPath).text());
    expect(taskJson.issuePath).toBeNull();
  });

  it('includes check fields when provided', async () => {
    const request: TaskCreateRequest = {
      repo: 'cli',
      title: 'Fix test',
      description: 'Test is broken.',
      trigger: { type: 'manual', description: 'test' },
      checkCommand: 'vitest run --reporter=json',
      checkBaseline: 10,
      checkTarget: 12,
      evidenceExpectations: 'Test count increases from 10 to 12.',
    };

    const result = await createTask(tempDir, request, { repoPath: tempDir });
    const taskJson = JSON.parse(await Bun.file(result.taskJsonPath).text());

    expect(taskJson.checkCommand).toBe('vitest run --reporter=json');
    expect(taskJson.checkBaseline).toBe(10);
    expect(taskJson.checkTarget).toBe(12);
  });
});
