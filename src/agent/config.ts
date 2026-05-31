import { clampThinkingLevel } from '@mariozechner/pi-ai';
import type { Api, Model } from '@mariozechner/pi-ai';
import { AGENT_EFFORTS } from '../types.js';
import type { AgentEffort, AgentModelConfig } from '../types.js';
import { resolveConfigPath } from '../paths.js';
import { createLogger } from '../util/logger.js';

const log = createLogger();

/** Per-agent reasoning-effort overrides. `null` means "use the default". */
type EffortConfig = Partial<Record<EffortAgent | 'default', AgentEffort | null>>;

interface CaseConfig {
  models?: {
    default?: AgentModelConfig;
    implementer?: AgentModelConfig | null;
    reviewer?: AgentModelConfig | null;
    verifier?: AgentModelConfig | null;
    closer?: AgentModelConfig | null;
    retrospective?: AgentModelConfig | null;
    orchestrator?: AgentModelConfig | null;
  };
  effort?: EffortConfig;
}

const DEFAULT_MODEL: AgentModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
};

/** Agents that have a baked-in effort default. */
type EffortAgent =
  | 'scout'
  | 'implementer'
  | 'verifier'
  | 'reviewer'
  | 'closer'
  | 'retrospective'
  | 'orchestrator'
  | 'interviewer';

export const VALID_EFFORTS: readonly AgentEffort[] = AGENT_EFFORTS;

/**
 * Baked-in reasoning effort per agent. The ladder reflects where extended
 * thinking actually earns its tokens, not a uniform setting:
 *
 * - `scout` (low): exploration is mostly tool-driven (grep/read); only light
 *   synthesis is needed to assemble findings.
 * - `implementer` (medium): the core problem-solving step — planning the change
 *   and working through test failures benefits from real reasoning.
 * - `verifier` (medium): must design a check that exercises the *changed* path
 *   rather than the happy path; shallow verification gives false confidence.
 * - `reviewer` (high): subtle principle/architecture violations are the cheapest
 *   bugs to catch here, and they reward the deepest reasoning.
 * - `closer` (off): mechanical — confirm evidence markers, open the PR.
 * - `retrospective` (low): summarising learnings is light synthesis.
 * - `orchestrator` (medium): interactive planning and spec-writing.
 * - `interviewer` (low): mostly structured Q&A and repo classification.
 *
 * Override any of these per-repo run via `effort` in config.json, the
 * `--effort` flag, or the `SMITH_EFFORT_OVERRIDE` env var. Set
 * `effort.default` to `"off"` to restore the pre-feature behaviour (no
 * extended thinking anywhere) in one line.
 */
const DEFAULT_EFFORT: Record<EffortAgent, AgentEffort> = {
  scout: 'low',
  implementer: 'medium',
  verifier: 'medium',
  reviewer: 'high',
  closer: 'off',
  retrospective: 'low',
  orchestrator: 'medium',
  interviewer: 'low',
};

/** Effort applied when an agent has no baked-in default and config sets none. */
const FALLBACK_EFFORT: AgentEffort = 'off';

function isValidEffort(value: unknown): value is AgentEffort {
  return typeof value === 'string' && (VALID_EFFORTS as readonly string[]).includes(value);
}

export async function loadConfig(): Promise<CaseConfig> {
  try {
    const raw = await Bun.file(resolveConfigPath()).text();
    return JSON.parse(raw) as CaseConfig;
  } catch {
    return {};
  }
}

export async function getModelForAgent(agentName: string): Promise<AgentModelConfig> {
  const config = await loadConfig();
  const models = config.models ?? {};

  // Role-specific config (null means "use default")
  const roleConfig = models[agentName as keyof typeof models];
  if (roleConfig && roleConfig !== null) return roleConfig as AgentModelConfig;

  // Fall back to default
  return (models.default as AgentModelConfig) ?? DEFAULT_MODEL;
}

/**
 * Resolve the reasoning effort for an agent. Resolution order:
 *
 *   1. role-specific config value (`effort.<agent>`)
 *   2. global config default (`effort.default`)
 *   3. baked-in per-agent default ({@link DEFAULT_EFFORT})
 *   4. {@link FALLBACK_EFFORT} ("off")
 *
 * A `null` config value means "skip me, use the next level down" — mirroring
 * the `models` semantics. Invalid strings are ignored with a warning so a typo
 * never crashes a run; resolution simply falls through to the next level.
 */
export async function getEffortForAgent(agentName: string): Promise<AgentEffort> {
  const config = await loadConfig();
  const effort = config.effort ?? {};

  const roleValue = effort[agentName as EffortAgent];
  if (roleValue != null) {
    if (isValidEffort(roleValue)) return roleValue;
    log.info('invalid effort value ignored', { agent: agentName, value: roleValue, valid: VALID_EFFORTS });
  }

  const defaultValue = effort.default;
  if (defaultValue != null) {
    if (isValidEffort(defaultValue)) return defaultValue;
    log.info('invalid effort default ignored', { value: defaultValue, valid: VALID_EFFORTS });
  }

  return DEFAULT_EFFORT[agentName as EffortAgent] ?? FALLBACK_EFFORT;
}

/** Read and validate the run-wide `SMITH_EFFORT_OVERRIDE` env var. */
function readEffortEnvOverride(): AgentEffort | undefined {
  const raw = process.env.SMITH_EFFORT_OVERRIDE;
  if (raw == null) return undefined;
  if (isValidEffort(raw)) return raw;
  log.info('invalid SMITH_EFFORT_OVERRIDE ignored', { value: raw, valid: VALID_EFFORTS });
  return undefined;
}

/**
 * Resolve the reasoning effort for an agent and clamp it to what the model
 * supports. This is the single owner of effort precedence, env validation, and
 * clamping — call it from every spawn/session site rather than re-deriving.
 *
 * Precedence (mirrors model selection):
 *
 *   explicit value > `SMITH_EFFORT_OVERRIDE` env > per-agent config/default
 *
 * The env override is validated like any config value — an invalid string is
 * ignored with a warning rather than cast blindly. The clamp degrades an
 * unsupported level gracefully (non-reasoning models collapse to `"off"`); when
 * the model can't be resolved the requested level is passed through unchanged.
 *
 * Returns `undefined` when the resolved level is `"off"`, so callers can omit
 * `thinkingLevel` entirely — pi's Agent treats absent as off, and the field
 * type excludes `"off"`.
 */
export async function resolveThinkingLevel(
  agentName: string,
  model: Model<Api> | undefined,
  explicit?: AgentEffort,
): Promise<Exclude<AgentEffort, 'off'> | undefined> {
  const requested: AgentEffort = explicit ?? readEffortEnvOverride() ?? (await getEffortForAgent(agentName));
  const clamped: AgentEffort = model ? clampThinkingLevel(model, requested) : requested;
  return clamped === 'off' ? undefined : clamped;
}
