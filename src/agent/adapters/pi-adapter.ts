import { Agent } from '@mariozechner/pi-agent-core';
import { streamSimple } from '@mariozechner/pi-ai';
import {
  AuthStorage,
  ModelRegistry,
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
} from '@mariozechner/pi-coding-agent';
import { loadSystemPrompt } from '../prompt-loader.js';
import { getModelForAgent, resolveThinkingLevel } from '../config.js';
import { isEmbeddedPackageRoot } from '../../paths.js';
import { parseAgentResult } from '../../util/parse-agent-result.js';
import { createLogger } from '../../util/logger.js';
import { sanitizeForTrace } from '../../tracing/sanitize.js';
import type { AgentEffort, AgentModelConfig, SpawnAgentOptions, SpawnAgentResult } from '../../types.js';
import type { CaseAgentRuntime, WorkspacePolicy } from '../runtime.js';

const log = createLogger();

export class PiRuntimeAdapter implements CaseAgentRuntime {
  private registry: ModelRegistry;
  private auth: AuthStorage;
  private activeAgent: Agent | null = null;

  constructor() {
    // Keep the AuthStorage instance so we can resolve the provider credential
    // (API key or refreshed OAuth access token) for the Agent's getApiKey hook.
    // Without this, streamSimple has no key and fails with
    // "No API key for provider: <provider>".
    this.auth = AuthStorage.create();
    this.registry = ModelRegistry.create(this.auth);
  }

  async spawn(options: SpawnAgentOptions): Promise<SpawnAgentResult> {
    const timeout = options.timeout ?? 600_000;
    const start = Date.now();

    // Agent prompt templates are package assets: disk override in dev, embedded in binaries.
    const systemPrompt = await loadSystemPrompt(options.packageRoot, options.agentName);

    // Expose the on-disk harness root to the agent's shell tools (e.g. the
    // implementer's pre-commit AST-lint loop reads `$SMITH_ROOT/ast-rules`).
    // Skipped for embedded binaries, where rules ship as bundled assets and no
    // on-disk path exists — the prompt guards for the directory's absence.
    if (options.packageRoot && !isEmbeddedPackageRoot(options.packageRoot)) {
      process.env.SMITH_ROOT = options.packageRoot;
    }
    const tools = this.createPiTools(options.agentName, options.cwd);

    const modelOverride = process.env.SMITH_MODEL_OVERRIDE;
    let modelConfig: AgentModelConfig;
    if (options.model) {
      modelConfig = { provider: options.provider ?? 'anthropic', model: options.model };
    } else if (modelOverride) {
      modelConfig = { provider: options.provider ?? 'anthropic', model: modelOverride };
    } else {
      modelConfig = await getModelForAgent(options.agentName);
    }

    const model = this.registry.find(modelConfig.provider, modelConfig.model);
    if (!model) {
      throw new Error(
        `Model not found: ${modelConfig.provider}/${modelConfig.model}. Check ~/.config/smith/config.json`,
      );
    }

    // Resolve reasoning effort (explicit > env override > per-agent config),
    // clamped to what the model supports. `undefined` means "off".
    const thinkingLevel = await resolveThinkingLevel(options.agentName, model, options.effort);

    log.info('spawning agent', {
      agent: options.agentName,
      cwd: options.cwd,
      provider: modelConfig.provider,
      model: modelConfig.model,
      effort: thinkingLevel ?? 'off',
      timeout,
    });

    // pi's Agent defaults thinkingLevel to "off"; only set it when reasoning is
    // requested so the type (which excludes "off") stays honest.
    const initialState: {
      systemPrompt: string;
      model: typeof model;
      tools: typeof tools;
      thinkingLevel?: Exclude<AgentEffort, 'off'>;
    } = { systemPrompt, model, tools };
    if (thinkingLevel) {
      initialState.thinkingLevel = thinkingLevel;
    }

    const agent = new Agent({
      initialState,
      streamFn: streamSimple,
      getApiKey: (provider: string) => this.auth.getApiKey(provider),
    });
    this.activeAgent = agent;

    let responseText = '';
    // pi's Agent does not throw on a model/stream failure: it records the error
    // on the failed assistant message and resolves `prompt()` normally. Capture
    // that message here so a real API error (bad model, auth, rate limit) is
    // surfaced instead of the misleading "AGENT_RESULT start delimiter not found".
    let agentError: string | null = null;
    // Context size (input + output + cache) for the most recent turn. Context
    // grows turn over turn within a single agent run, so the final turn's usage
    // is this agent's context occupancy — the same number pi's footer shows via
    // calculateContextTokens(lastAssistantUsage). NOT a running sum: each phase
    // is a fresh agent with its own window, so accumulating across turns (or
    // phases) would be meaningless.
    let contextTokens = 0;
    const toolTimers = new Map<string, number>();

    agent.subscribe((event: any) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        responseText += event.assistantMessageEvent.delta;
      }
      // Each turn's assistant message reports the context size at that turn.
      // Track the running max (== final turn for a monotonically growing
      // context) and surface it so the pipeline can report the peak occupancy.
      if (event.type === 'turn_end') {
        const u = event.message?.usage;
        const turnContext = u ? (u.totalTokens || u.input + u.output + u.cacheRead + u.cacheWrite) : 0;
        if (turnContext > contextTokens) {
          contextTokens = turnContext;
          if (options.onUsage) {
            try {
              options.onUsage(turnContext, options.phase);
            } catch (e) {
              log.error('onUsage callback threw', { error: e instanceof Error ? e.message : String(e) });
            }
          }
        }
      }
      if (event.type === 'turn_end' && event.message?.errorMessage) {
        agentError = event.message.errorMessage;
      }
      if (event.type === 'agent_end' && Array.isArray(event.messages)) {
        const failed = event.messages.find((m: any) => m?.errorMessage);
        if (failed) agentError = failed.errorMessage;
      }
      if (event.type === 'tool_execution_start') {
        if (options.onHeartbeat) options.onHeartbeat(Date.now() - start);
        toolTimers.set(event.toolCallId, Date.now());
        const sanitizedArgs = sanitizeForTrace(event.args);
        // Renderer hook — wrap in try/catch so rendering bugs never kill the agent.
        if (options.onToolActivity) {
          try {
            options.onToolActivity({
              type: 'start',
              tool: event.toolName,
              args: typeof sanitizedArgs === 'string' ? sanitizedArgs : JSON.stringify(sanitizedArgs),
            });
          } catch (e) {
            log.error('onToolActivity start callback threw', {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        if (options.phase) {
          const toolEvent = {
            event: 'tool_start' as const,
            phase: options.phase,
            agent: options.agentName,
            toolCallId: event.toolCallId,
            tool: event.toolName,
            args: sanitizedArgs,
          };
          if (options.eventAppender) {
            void options.eventAppender.append(toolEvent);
          } else if (options.traceWriter) {
            options.traceWriter.write({ ts: new Date().toISOString(), ...toolEvent });
          }
        }
      }
      if (event.type === 'tool_execution_end') {
        const toolStart = toolTimers.get(event.toolCallId);
        toolTimers.delete(event.toolCallId);
        const durationMs = toolStart ? Date.now() - toolStart : 0;
        if (options.onToolActivity) {
          try {
            options.onToolActivity({
              type: 'end',
              tool: event.toolName,
              durationMs,
              isError: event.isError,
            });
          } catch (e) {
            log.error('onToolActivity end callback threw', {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        if (options.phase) {
          const toolEvent = {
            event: 'tool_end' as const,
            phase: options.phase,
            agent: options.agentName,
            toolCallId: event.toolCallId,
            tool: event.toolName,
            durationMs,
            isError: event.isError,
            result: sanitizeForTrace(event.result),
          };
          if (options.eventAppender) {
            void options.eventAppender.append(toolEvent);
          } else if (options.traceWriter) {
            options.traceWriter.write({ ts: new Date().toISOString(), ...toolEvent });
          }
        }
      }
    });

    const timer = setTimeout(() => agent.abort(), timeout);

    try {
      await agent.prompt(options.prompt);
      clearTimeout(timer);
      this.activeAgent = null;
      const durationMs = Date.now() - start;

      // The agent reported a model/stream failure without throwing. Surface the
      // real error rather than letting parseAgentResult emit a delimiter error.
      if (agentError && !responseText.includes('AGENT_RESULT')) {
        log.error('agent run failed', { agent: options.agentName, durationMs, error: agentError });
        return {
          raw: responseText,
          result: {
            status: 'failed',
            summary: '',
            artifacts: {
              commit: null,
              filesChanged: [],
              testsPassed: null,
              screenshotUrls: [],
              evidenceMarkers: [],
              prUrl: null,
              prNumber: null,
            },
            error: agentError,
            model: modelConfig.model,
            effort: thinkingLevel ?? 'off',
          },
          durationMs,
          tokens: contextTokens,
        };
      }

      const result = parseAgentResult(responseText);
      // Tag the result with the model + effort this agent actually ran on so the
      // renderers can surface them per-step and in the final summary.
      result.model = modelConfig.model;
      result.effort = thinkingLevel ?? 'off';
      log.info('agent completed', {
        agent: options.agentName,
        durationMs,
        status: result.status,
        contextTokens,
        model: modelConfig.model,
        effort: thinkingLevel ?? 'off',
      });

      return { raw: responseText, result, durationMs, tokens: contextTokens };
    } catch (err) {
      clearTimeout(timer);
      this.activeAgent = null;
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);

      log.error('agent spawn failed', { agent: options.agentName, durationMs, error: errorMsg });

      return {
        raw: '',
        result: {
          status: 'failed',
          summary: '',
          artifacts: {
            commit: null,
            filesChanged: [],
            testsPassed: null,
            screenshotUrls: [],
            evidenceMarkers: [],
            prUrl: null,
            prNumber: null,
          },
          error: `Agent spawn error: ${errorMsg}`,
          model: modelConfig.model,
          effort: thinkingLevel ?? 'off',
        },
        durationMs,
        tokens: contextTokens,
      };
    }
  }

  createTools(agentName: string, cwd: string, _policy?: WorkspacePolicy): unknown[] {
    return this.createPiTools(agentName, cwd);
  }

  private createPiTools(agentName: string, cwd: string) {
    switch (agentName) {
      case 'implementer':
      case 'retrospective':
        return [createReadTool(cwd), createWriteTool(cwd), createEditTool(cwd), createBashTool(cwd)];
      case 'scout':
        // Read-only exploration: Read + Bash only. Glob/Grep are exposed via
        // the Bash tool in the pi-coding-agent suite (the agent runs `rg`,
        // `find`, etc.). Crucially: no Write, no Edit — the scout must not
        // mutate the working tree.
        return [createReadTool(cwd), createBashTool(cwd)];
      case 'interviewer':
        // Same read-only constraint as scout: Read + Bash. The interviewer
        // explores the target repo before `smith onboard --interview` persists
        // results; it must never mutate the working tree. Human Q&A flows
        // through the conversation channel, not a tool.
        return [createReadTool(cwd), createBashTool(cwd)];
      case 'verifier':
      case 'reviewer':
      case 'closer':
      default:
        return [createReadTool(cwd), createBashTool(cwd)];
    }
  }

  abort(): void {
    if (this.activeAgent) {
      this.activeAgent.abort();
      this.activeAgent = null;
    }
  }
}
