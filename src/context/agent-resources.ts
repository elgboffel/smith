import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** A single discoverable resource — a project rule or a skill manifest entry. */
export interface AgentResource {
  /** Display name (rule filename, or skill frontmatter `name`). */
  name: string;
  /** One-line summary (rule H1, or skill frontmatter `description`). */
  description: string;
  /** Absolute path the agent can pass to its Read tool. */
  path: string;
}

/**
 * Resources discovered for an agent run. Manifest-only (name + description +
 * path) — bodies are NOT read here. Agents pull the full file on demand via
 * their Read tool (progressive disclosure, keeps the prompt cheap).
 */
export interface AgentResources {
  /** `<repo>/.agents/rules/*.md` */
  projectRules: AgentResource[];
  /** `<repo>/.agents/skills/<slug>/SKILL.md` */
  projectSkills: AgentResource[];
  /** `~/.agents/skills/<slug>/SKILL.md` (NEVER `~/.claude/skills`). */
  globalSkills: AgentResource[];
}

const EMPTY: AgentResources = { projectRules: [], projectSkills: [], globalSkills: [] };

/** Max characters for a rendered description before truncation with an ellipsis. */
const MAX_DESCRIPTION_CHARS = 160;

export interface DiscoverOptions {
  /** Home directory override (tests). Defaults to `os.homedir()`. */
  home?: string;
  /**
   * Allowlist of global skill directory names to include. `undefined` =
   * include all (back-compat); `[]` = include none. Project skills/rules are
   * never filtered — they are repo-authored and assumed relevant.
   */
  globalSkillNames?: string[];
}

/**
 * Discover project rules + project/global skills for a run. Scoped to the
 * `.agents` folder in the target repo and `~/.agents/skills` globally.
 * Deliberately does NOT read `~/.claude/skills`.
 *
 * Global skills are filtered by `globalSkillNames` (the config allowlist) so the
 * injected manifest stays small. Every read is best-effort: missing directories
 * yield empty lists, never throw.
 */
export async function discoverAgentResources(repoPath: string, opts: DiscoverOptions = {}): Promise<AgentResources> {
  const home = opts.home ?? homedir();
  const allow = opts.globalSkillNames;
  const [projectRules, projectSkills, globalSkills] = await Promise.all([
    discoverRules(join(repoPath, '.agents', 'rules')),
    discoverSkills(join(repoPath, '.agents', 'skills')),
    discoverSkills(join(home, '.agents', 'skills'), allow),
  ]);
  return { projectRules, projectSkills, globalSkills };
}

/** Read `*.md` rule files, using the first H1 (or first non-empty line) as the description. */
async function discoverRules(dir: string): Promise<AgentResource[]> {
  const entries = await safeReaddir(dir);
  const rules: AgentResource[] = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const path = join(dir, name);
    const content = await safeReadFile(path);
    rules.push({ name, description: firstHeading(content), path });
  }
  return rules.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read `<slug>/SKILL.md` skill manifests, parsing `name` + `description` from
 * frontmatter. When `allow` is provided, only directories whose name is in the
 * list are read.
 */
async function discoverSkills(dir: string, allow?: string[]): Promise<AgentResource[]> {
  const allowSet = allow ? new Set(allow) : null;
  const entries = await safeReaddir(dir);
  const skills: AgentResource[] = [];
  for (const slug of entries) {
    if (allowSet && !allowSet.has(slug)) continue;
    const path = join(dir, slug, 'SKILL.md');
    if (!(await isFile(path))) continue;
    const fm = parseFrontmatter(await safeReadFile(path));
    skills.push({
      name: fm.name || slug,
      description: summarize(fm.description || ''),
      path,
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Render the resources as a Markdown section for injection into an agent
 * prompt. Returns '' when nothing was discovered so callers can skip cleanly.
 */
export function formatAgentResources(resources: AgentResources): string {
  const { projectRules, projectSkills, globalSkills } = resources;
  if (projectRules.length === 0 && projectSkills.length === 0 && globalSkills.length === 0) {
    return '';
  }

  const lines: string[] = [
    '## Project Rules & Skills',
    '',
    'This repo ships agent rules and reusable skills. They encode required workflows and conventions.',
    'Before acting, read the relevant file with your Read tool (paths below) — do not guess where a rule or skill applies.',
    '',
  ];

  if (projectRules.length > 0) {
    lines.push('### Project Rules — `.agents/rules/`', '');
    for (const r of projectRules) {
      lines.push(`- \`${r.path}\`${r.description ? ` — ${r.description}` : ''}`);
    }
    lines.push('');
  }

  if (projectSkills.length > 0) {
    lines.push('### Project Skills — `.agents/skills/`', '');
    for (const s of projectSkills) {
      lines.push(`- **${s.name}**${s.description ? ` — ${s.description}` : ''} → \`${s.path}\``);
    }
    lines.push('');
  }

  if (globalSkills.length > 0) {
    lines.push('### Global Skills — `~/.agents/skills/`', '');
    for (const s of globalSkills) {
      lines.push(`- **${s.name}**${s.description ? ` — ${s.description}` : ''} → \`${s.path}\``);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// --- helpers ---------------------------------------------------------------

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function safeReadFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return '';
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** First Markdown H1 text, falling back to the first non-empty line, stripped of leading `#`. */
function firstHeading(content: string): string {
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    return line.replace(/^#+\s*/, '').trim();
  }
  return '';
}

/**
 * Extract simple `key: value` pairs from a leading `--- ... ---` YAML frontmatter
 * block. Handles folded/literal scalars (`key: >` / `key: |`) by joining the
 * indented continuation lines. Good enough for SKILL.md name/description — not a
 * general YAML parser.
 */
function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = content.slice(3, end).split('\n');
  const out: Record<string, string> = {};

  for (let i = 0; i < block.length; i++) {
    const m = block[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();

    if (value === '>' || value === '|') {
      const continuation: string[] = [];
      let j = i + 1;
      while (j < block.length && (block[j].startsWith('  ') || block[j].trim() === '')) {
        continuation.push(block[j].trim());
        j++;
      }
      value = continuation.join(' ').trim();
      i = j - 1;
    }

    out[key] = value;
  }

  return out;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Reduce a (possibly multi-paragraph) skill description to a single short line:
 * collapse whitespace, take the first sentence, and hard-cap the length. Keeps
 * the injected manifest cheap while preserving enough to route on.
 */
function summarize(s: string): string {
  const flat = collapseWhitespace(s);
  if (!flat) return '';
  const firstSentence = flat.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? flat;
  const base = firstSentence.length >= 30 ? firstSentence : flat;
  if (base.length <= MAX_DESCRIPTION_CHARS) return base;
  return base.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd() + '…';
}

export const __testing = { EMPTY };
