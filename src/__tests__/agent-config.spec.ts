import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Agent config tests use SMITH_DATA_DIR so they never touch real user config.
 */

const { loadConfig, getModelForAgent, getEffortForAgent, resolveThinkingLevel } = await import(
  '../agent/config.js'
);

let tempDir: string;
let originalSmithDataDir: string | undefined;
let originalXdgConfigHome: string | undefined;

async function writeConfig(config: unknown): Promise<void> {
  await Bun.write(join(tempDir, 'config.json'), JSON.stringify(config));
}

describe('agent config', () => {
  beforeEach(async () => {
    originalSmithDataDir = process.env.SMITH_DATA_DIR;
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    tempDir = await mkdtemp(join(tmpdir(), 'case-agent-config-'));
    await mkdir(tempDir, { recursive: true });
    process.env.SMITH_DATA_DIR = tempDir;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.SMITH_MODEL_OVERRIDE;
  });

  afterEach(async () => {
    if (originalSmithDataDir === undefined) delete process.env.SMITH_DATA_DIR;
    else process.env.SMITH_DATA_DIR = originalSmithDataDir;

    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;

    delete process.env.SMITH_MODEL_OVERRIDE;
    delete process.env.SMITH_EFFORT_OVERRIDE;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty config when file is missing', async () => {
    const config = await loadConfig();
    expect(config).toEqual({});
  });

  it('returns parsed config from file', async () => {
    await writeConfig({
      models: {
        default: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        reviewer: { provider: 'google', model: 'gemini-2.5-pro' },
      },
    });

    const config = await loadConfig();
    expect(config.models?.default?.provider).toBe('anthropic');
    expect(config.models?.reviewer).toEqual({ provider: 'google', model: 'gemini-2.5-pro' });
  });

  it('returns empty config for invalid JSON', async () => {
    await Bun.write(join(tempDir, 'config.json'), 'not json {{{');
    const config = await loadConfig();
    expect(config).toEqual({});
  });

  it('returns hardcoded default when no config file exists', async () => {
    const result = await getModelForAgent('implementer');
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('uses role-specific config when available', async () => {
    await writeConfig({
      models: {
        default: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        reviewer: { provider: 'google', model: 'gemini-2.5-pro' },
      },
    });

    const result = await getModelForAgent('reviewer');
    expect(result).toEqual({ provider: 'google', model: 'gemini-2.5-pro' });
  });

  it('falls back to default when role is null', async () => {
    await writeConfig({
      models: {
        default: { provider: 'anthropic', model: 'claude-opus-4-5' },
        verifier: null,
      },
    });

    const result = await getModelForAgent('verifier');
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-opus-4-5' });
  });

  it('falls back to default when role is not in config', async () => {
    await writeConfig({
      models: {
        default: { provider: 'openai', model: 'gpt-4o' },
      },
    });

    const result = await getModelForAgent('closer');
    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('falls back to hardcoded default when default is not in config', async () => {
    await writeConfig({
      models: {
        reviewer: { provider: 'google', model: 'gemini-2.5-pro' },
      },
    });

    const result = await getModelForAgent('implementer');
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('handles orchestrator role', async () => {
    await writeConfig({
      models: {
        orchestrator: { provider: 'anthropic', model: 'claude-opus-4-5' },
      },
    });

    const result = await getModelForAgent('orchestrator');
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-opus-4-5' });
  });
});

describe('agent effort config', () => {
  beforeEach(async () => {
    originalSmithDataDir = process.env.SMITH_DATA_DIR;
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    tempDir = await mkdtemp(join(tmpdir(), 'case-agent-effort-'));
    await mkdir(tempDir, { recursive: true });
    process.env.SMITH_DATA_DIR = tempDir;
    delete process.env.XDG_CONFIG_HOME;
    // Invalid-value cases log via the structured logger; keep test output clean.
    process.env.SMITH_QUIET = '1';
  });

  afterEach(async () => {
    if (originalSmithDataDir === undefined) delete process.env.SMITH_DATA_DIR;
    else process.env.SMITH_DATA_DIR = originalSmithDataDir;

    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;

    delete process.env.SMITH_QUIET;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns baked-in per-agent defaults when no config exists', async () => {
    expect(await getEffortForAgent('scout')).toBe('low');
    expect(await getEffortForAgent('implementer')).toBe('medium');
    expect(await getEffortForAgent('verifier')).toBe('medium');
    expect(await getEffortForAgent('reviewer')).toBe('high');
    expect(await getEffortForAgent('closer')).toBe('off');
    expect(await getEffortForAgent('retrospective')).toBe('low');
    expect(await getEffortForAgent('orchestrator')).toBe('medium');
    expect(await getEffortForAgent('interviewer')).toBe('low');
  });

  it('falls back to "off" for an unknown agent with no config', async () => {
    expect(await getEffortForAgent('mystery')).toBe('off');
  });

  it('uses a role-specific effort when set', async () => {
    await writeConfig({ effort: { reviewer: 'xhigh' } });
    expect(await getEffortForAgent('reviewer')).toBe('xhigh');
  });

  it('uses effort.default for agents without a role-specific value', async () => {
    await writeConfig({ effort: { default: 'minimal' } });
    // default wins over the baked-in per-agent default
    expect(await getEffortForAgent('reviewer')).toBe('minimal');
    expect(await getEffortForAgent('scout')).toBe('minimal');
  });

  it('role-specific value wins over effort.default', async () => {
    await writeConfig({ effort: { default: 'off', implementer: 'high' } });
    expect(await getEffortForAgent('implementer')).toBe('high');
    expect(await getEffortForAgent('verifier')).toBe('off');
  });

  it('treats null role as "use default" and falls through', async () => {
    await writeConfig({ effort: { default: 'medium', reviewer: null } });
    expect(await getEffortForAgent('reviewer')).toBe('medium');
  });

  it('null role with no default falls through to baked-in default', async () => {
    await writeConfig({ effort: { reviewer: null } });
    expect(await getEffortForAgent('reviewer')).toBe('high');
  });

  it('setting effort.default to "off" disables thinking everywhere', async () => {
    await writeConfig({ effort: { default: 'off' } });
    expect(await getEffortForAgent('reviewer')).toBe('off');
    expect(await getEffortForAgent('implementer')).toBe('off');
  });

  it('ignores an invalid role value and falls through to default', async () => {
    await writeConfig({ effort: { default: 'low', reviewer: 'turbo' } });
    expect(await getEffortForAgent('reviewer')).toBe('low');
  });

  it('ignores an invalid default and falls through to baked-in default', async () => {
    await writeConfig({ effort: { default: 'turbo' } });
    expect(await getEffortForAgent('reviewer')).toBe('high');
  });
});

describe('resolveThinkingLevel', () => {
  // Passing model=undefined skips clamping, isolating precedence + env handling.
  beforeEach(async () => {
    originalSmithDataDir = process.env.SMITH_DATA_DIR;
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    tempDir = await mkdtemp(join(tmpdir(), 'case-resolve-effort-'));
    await mkdir(tempDir, { recursive: true });
    process.env.SMITH_DATA_DIR = tempDir;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.SMITH_EFFORT_OVERRIDE;
    process.env.SMITH_QUIET = '1';
  });

  afterEach(async () => {
    if (originalSmithDataDir === undefined) delete process.env.SMITH_DATA_DIR;
    else process.env.SMITH_DATA_DIR = originalSmithDataDir;

    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;

    delete process.env.SMITH_EFFORT_OVERRIDE;
    delete process.env.SMITH_QUIET;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns undefined when the resolved level is "off"', async () => {
    expect(await resolveThinkingLevel('closer', undefined)).toBeUndefined();
  });

  it('returns the baked-in per-agent default when nothing overrides it', async () => {
    expect(await resolveThinkingLevel('reviewer', undefined)).toBe('high');
  });

  it('explicit value wins over env override and config', async () => {
    process.env.SMITH_EFFORT_OVERRIDE = 'low';
    await writeConfig({ effort: { reviewer: 'medium' } });
    expect(await resolveThinkingLevel('reviewer', undefined, 'xhigh')).toBe('xhigh');
  });

  it('env override wins over config when no explicit value is given', async () => {
    process.env.SMITH_EFFORT_OVERRIDE = 'minimal';
    await writeConfig({ effort: { reviewer: 'high' } });
    expect(await resolveThinkingLevel('reviewer', undefined)).toBe('minimal');
  });

  it('ignores an invalid env override and falls through to config/default', async () => {
    process.env.SMITH_EFFORT_OVERRIDE = 'turbo';
    expect(await resolveThinkingLevel('reviewer', undefined)).toBe('high');
  });
});
