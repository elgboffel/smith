import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverAgentResources, formatAgentResources } from '../context/agent-resources.js';

let tempDir: string;
let repoDir: string;
let homeDir: string;

beforeEach(async () => {
  tempDir = join(process.env.TMPDIR ?? '/tmp', `case-agent-resources-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  repoDir = join(tempDir, 'repo');
  homeDir = join(tempDir, 'home');
  await mkdir(repoDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeRule(name: string, body: string): Promise<void> {
  const dir = join(repoDir, '.agents', 'rules');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), body);
}

async function writeSkill(base: string, slug: string, body: string): Promise<void> {
  const dir = join(base, '.agents', 'skills', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), body);
}

describe('discoverAgentResources', () => {
  it('returns empty lists when the .agents folder is absent', async () => {
    const res = await discoverAgentResources(repoDir, { home: homeDir });
    expect(res).toEqual({ projectRules: [], projectSkills: [], globalSkills: [] });
  });

  it('discovers project rules with the first heading as description, sorted by name', async () => {
    await writeRule('frontend-validation.md', '# Frontend Validation Rules\n\nbody');
    await writeRule('code-quality-checks.md', '# Code Quality Checks\n\nbody');

    const res = await discoverAgentResources(repoDir, { home: homeDir });

    expect(res.projectRules.map((r) => r.name)).toEqual(['code-quality-checks.md', 'frontend-validation.md']);
    expect(res.projectRules[1].description).toBe('Frontend Validation Rules');
    expect(res.projectRules[1].path).toBe(join(repoDir, '.agents', 'rules', 'frontend-validation.md'));
  });

  it('ignores non-markdown files in the rules folder', async () => {
    await writeRule('real.md', '# Real');
    await writeRule('notes.txt', 'ignore me');

    const res = await discoverAgentResources(repoDir, { home: homeDir });

    expect(res.projectRules.map((r) => r.name)).toEqual(['real.md']);
  });

  it('parses skill frontmatter (single-line and folded descriptions)', async () => {
    await writeSkill(repoDir, 'playwright', '---\nname: playwright\ndescription: Playwright E2E testing and flake validation.\n---\n\nbody');
    await writeSkill(repoDir, 'mui-styling', '---\nname: mui-styling\ndescription: >\n  Styling conventions for MUI components.\n  Use sx props consistently.\n---\n\nbody');

    const res = await discoverAgentResources(repoDir, { home: homeDir });

    const playwright = res.projectSkills.find((s) => s.name === 'playwright');
    const mui = res.projectSkills.find((s) => s.name === 'mui-styling');
    expect(playwright?.description).toBe('Playwright E2E testing and flake validation.');
    // Folded multi-sentence description is reduced to its first sentence.
    expect(mui?.description).toBe('Styling conventions for MUI components.');
  });

  it('truncates an over-long single-sentence description with an ellipsis', async () => {
    const long = 'x'.repeat(300);
    await writeSkill(repoDir, 'verbose', `---\nname: verbose\ndescription: ${long}\n---\n`);

    const res = await discoverAgentResources(repoDir, { home: homeDir });

    expect(res.projectSkills[0].description.length).toBeLessThanOrEqual(160);
    expect(res.projectSkills[0].description.endsWith('\u2026')).toBe(true);
  });

  it('falls back to the directory slug when frontmatter has no name', async () => {
    await writeSkill(repoDir, 'no-name-skill', 'no frontmatter here');

    const res = await discoverAgentResources(repoDir, { home: homeDir });

    expect(res.projectSkills[0].name).toBe('no-name-skill');
    expect(res.projectSkills[0].description).toBe('');
  });

  it('discovers global skills from ~/.agents/skills', async () => {
    await writeSkill(homeDir, 'test-ui', '---\nname: test-ui\ndescription: Browser verification helper.\n---\n');

    const res = await discoverAgentResources(repoDir, { home: homeDir });

    expect(res.globalSkills.map((s) => s.name)).toEqual(['test-ui']);
    expect(res.globalSkills[0].path).toBe(join(homeDir, '.agents', 'skills', 'test-ui', 'SKILL.md'));
  });

  it('filters global skills by the allowlist (directory name)', async () => {
    await writeSkill(homeDir, 'tdd', '---\nname: tdd\ndescription: Red-green-refactor.\n---\n');
    await writeSkill(homeDir, 'commit', '---\nname: commit\ndescription: Conventional commits.\n---\n');
    await writeSkill(homeDir, 'writing-beats', '---\nname: writing-beats\ndescription: Article beats.\n---\n');

    const res = await discoverAgentResources(repoDir, { home: homeDir, globalSkillNames: ['tdd', 'commit'] });

    expect(res.globalSkills.map((s) => s.name)).toEqual(['commit', 'tdd']);
  });

  it('includes no global skills when the allowlist is empty', async () => {
    await writeSkill(homeDir, 'tdd', '---\nname: tdd\ndescription: Red-green-refactor.\n---\n');

    const res = await discoverAgentResources(repoDir, { home: homeDir, globalSkillNames: [] });

    expect(res.globalSkills).toEqual([]);
  });
});

describe('formatAgentResources', () => {
  it('returns an empty string when nothing was discovered', () => {
    expect(formatAgentResources({ projectRules: [], projectSkills: [], globalSkills: [] })).toBe('');
  });

  it('renders rules and skills with paths the Read tool can use', () => {
    const out = formatAgentResources({
      projectRules: [{ name: 'frontend-validation.md', description: 'Frontend Validation Rules', path: '/repo/.agents/rules/frontend-validation.md' }],
      projectSkills: [{ name: 'playwright', description: 'E2E testing', path: '/repo/.agents/skills/playwright/SKILL.md' }],
      globalSkills: [{ name: 'test-ui', description: 'Browser helper', path: '/home/.agents/skills/test-ui/SKILL.md' }],
    });

    expect(out).toContain('## Project Rules & Skills');
    expect(out).toContain('### Project Rules — `.agents/rules/`');
    expect(out).toContain('/repo/.agents/rules/frontend-validation.md');
    expect(out).toContain('Frontend Validation Rules');
    expect(out).toContain('### Project Skills — `.agents/skills/`');
    expect(out).toContain('**playwright**');
    expect(out).toContain('### Global Skills — `~/.agents/skills/`');
    expect(out).toContain('/home/.agents/skills/test-ui/SKILL.md');
  });

  it('omits a section when its list is empty', () => {
    const out = formatAgentResources({
      projectRules: [{ name: 'r.md', description: 'R', path: '/r.md' }],
      projectSkills: [],
      globalSkills: [],
    });

    expect(out).toContain('### Project Rules');
    expect(out).not.toContain('### Project Skills');
    expect(out).not.toContain('### Global Skills');
  });
});
