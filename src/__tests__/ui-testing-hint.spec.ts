import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatUiTestingHint } from '../context/ui-testing-hint.js';
import type { ProjectEntry } from '../types.js';

function makeProject(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return {
    name: 'demo',
    evidenceStrategy: 'ui-screenshot',
    path: '/repo',
    remote: 'git@example.com:demo.git',
    language: 'ts',
    packageManager: 'pnpm',
    commands: { 'build-dev': 'pnpm build-dev', start: 'pnpm start' },
    uiTestingSkill: 'test-ui',
    ...overrides,
  };
}

describe('formatUiTestingHint', () => {
  let repoPath: string;

  beforeAll(() => {
    repoPath = mkdtempSync(join(tmpdir(), 'smith-hint-'));
    const skillDir = join(repoPath, '.agents', 'skills', 'test-ui');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: test-ui\n---\n');
  });

  afterAll(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it('emits the resolved SKILL.md path when the repo-local skill exists', () => {
    const hint = formatUiTestingHint(makeProject(), repoPath);
    expect(hint).toContain('### UI Testing');
    expect(hint).toContain(join(repoPath, '.agents', 'skills', 'test-ui', 'SKILL.md'));
    expect(hint).toContain('Do not hand-roll Playwright.');
  });

  it('falls back to the bare skill name when no SKILL.md resolves', () => {
    const hint = formatUiTestingHint(makeProject({ uiTestingSkill: 'nonexistent-skill' }), repoPath);
    expect(hint).toContain('`nonexistent-skill`');
    expect(hint).not.toContain('SKILL.md');
  });

  it('returns null for non-ui-screenshot repos', () => {
    expect(formatUiTestingHint(makeProject({ evidenceStrategy: 'test-output' }), repoPath)).toBeNull();
  });
});
