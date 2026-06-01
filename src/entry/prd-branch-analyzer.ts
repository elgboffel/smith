import { Agent } from '@mariozechner/pi-agent-core';
import { streamSimple } from '@mariozechner/pi-ai';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { getModelForAgent } from '../agent/config.js';
import { createLogger } from '../util/logger.js';
import { slugify } from '../util/slugify.js';
import { deriveBranchPrefix } from './branch-namer.js';
import type { DerivedBranch } from './branch-namer.js';

const log = createLogger();

const SYSTEM_PROMPT = [
  'You name git branches from a PRD. Read the PRD and reply with ONE line of JSON only:',
  '{"name":"<kebab-case-slug>","prefix":"feat|fix|chore"}.',
  'The slug is 2-5 words capturing the work. Pick "feat" for new capabilities,',
  '"fix" for bug fixes, "chore" for docs/maintenance. No prose, no code fence.',
].join(' ');

/**
 * Real PRD-analysis seam: read the PRD at `prdPath` and ask an agent to
 * synthesize `{ name, prefix }`. Isolated here so {@link BranchNamer} can inject
 * a mock in tests. On any failure it degrades to a deterministic derivation
 * from the PRD's first heading so branch naming never blocks a batch.
 */
export async function analyzePrdForBranch(prdPath: string): Promise<DerivedBranch> {
  const content = await Bun.file(prdPath).text();
  try {
    return await runAgent(content);
  } catch (err) {
    log.error('PRD branch analysis failed; falling back to heading', {
      prdPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return fromHeading(content);
  }
}

async function runAgent(prdContent: string): Promise<DerivedBranch> {
  const auth = AuthStorage.create();
  const registry = ModelRegistry.create(auth);
  const modelConfig = await getModelForAgent('branch-namer');
  const model = registry.find(modelConfig.provider, modelConfig.model);
  if (!model) {
    throw new Error(`Model not found: ${modelConfig.provider}/${modelConfig.model}`);
  }

  const agent = new Agent({
    initialState: { systemPrompt: SYSTEM_PROMPT, model, tools: [] },
    streamFn: streamSimple,
    getApiKey: (provider: string) => auth.getApiKey(provider),
  });

  let response = '';
  agent.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      response += event.assistantMessageEvent.delta;
    }
  });

  await agent.prompt(`PRD:\n\n${prdContent}`);
  return parseBranch(response);
}

/** Parse the agent's JSON reply into a validated {@link DerivedBranch}. */
function parseBranch(response: string): DerivedBranch {
  const match = response.match(/\{[^}]*\}/);
  if (!match) throw new Error(`No JSON object in response: ${response.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as { name?: unknown; prefix?: unknown };
  const slug = typeof parsed.name === 'string' ? slugify(parsed.name) : '';
  if (slug.length === 0) throw new Error(`Missing branch name in response: ${match[0]}`);
  const prefix =
    parsed.prefix === 'feat' || parsed.prefix === 'fix' || parsed.prefix === 'chore' ? parsed.prefix : 'fix';
  return { prefix, name: `${prefix}/${slug}` };
}

/** Deterministic fallback: derive from the PRD's first `# ` heading. */
function fromHeading(content: string): DerivedBranch {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'prd';
  const cleaned = heading.replace(/^PRD:\s*/i, '');
  const prefix = deriveBranchPrefix(cleaned.split(/[^a-zA-Z0-9]+/).filter(Boolean));
  return { prefix, name: `${prefix}/${slugify(cleaned)}` };
}
