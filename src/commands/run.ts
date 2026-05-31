import { parseArgs } from 'node:util';
import { buildPipelineConfig } from '../config.js';
import { runPipeline } from '../pipeline.js';
import { runCliOrchestrator } from '../entry/cli-orchestrator.js';
import { startOrchestratorSession } from '../agent/orchestrator-session.js';
import { VALID_EFFORTS } from '../agent/config.js';
import { createLogger } from '../util/logger.js';
import { resolvePackageRoot } from '../paths.js';
import type { PipelineMode } from '../types.js';

const log = createLogger();

export const description = 'Run the agent pipeline (default)';

/**
 * Handler for `case run` (also the default when no verb is supplied).
 *
 * Mirrors the original inline dispatch in src/index.ts before Phase 2 — kept
 * intact for back-compat with existing `smith` invocations. Parses its own argv
 * slice via `parseArgs` so the router stays verb-agnostic.
 */
export async function handler(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printRunHelp();
    return 0;
  }

  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      task: { type: 'string', short: 't' },
      mode: { type: 'string', short: 'm' },
      agent: { type: 'boolean' },
      model: { type: 'string' },
      effort: { type: 'string' },
      'dry-run': { type: 'boolean' },
      fresh: { type: 'boolean' },
      tui: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: false,
  });

  // --model flag: override model for all agents in this run
  if (values.model) {
    process.env.SMITH_MODEL_OVERRIDE = values.model as string;
  }

  // --effort flag: override reasoning effort for all agents in this run
  if (values.effort) {
    const effort = values.effort as string;
    if (!(VALID_EFFORTS as readonly string[]).includes(effort)) {
      process.stderr.write(`Error: --effort must be one of ${VALID_EFFORTS.join(', ')}\n`);
      return 1;
    }
    process.env.SMITH_EFFORT_OVERRIDE = effort;
  }

  if (values.agent) {
    const argument = positionals[0];
    const caseRoot = resolvePackageRoot();

    try {
      await startOrchestratorSession({
        caseRoot,
        argument: argument || undefined,
        mode: 'attended',
      });
      return 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('orchestrator session crashed', { error: msg });
      process.stderr.write(`Fatal: ${msg}\n`);
      return 1;
    }
  }

  if (values.task) {
    // Explicit --task flag: existing pipeline-only flow
    return runTaskFlow(values);
  }

  // Positional argument routing: number, Linear ID, or freeform text
  const argument = positionals[0];

  const mode = values.mode as PipelineMode | undefined;
  if (mode && mode !== 'attended' && mode !== 'unattended') {
    process.stderr.write('Error: --mode must be "attended" or "unattended"\n');
    return 1;
  }

  const caseRoot = resolvePackageRoot();

  // Suppress structured JSON logs for interactive CLI use
  process.env.SMITH_QUIET = '1';

  try {
    await runCliOrchestrator({
      argument: argument || undefined,
      mode: mode ?? 'attended',
      dryRun: (values['dry-run'] as boolean) ?? false,
      fresh: (values.fresh as boolean) ?? false,
      caseRoot,
      renderer: values.tui ? 'tui' : undefined,
    });
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('cli orchestrator crashed', { error: msg });
    process.stderr.write(`Fatal: ${msg}\n`);
    return 1;
  }
}

function printRunHelp(): void {
  const text = `Usage: smith run [options] [issue]
       smith [issue]
       smith --agent [issue]

Run the agent pipeline for a GitHub or Linear issue.

Options:
  --task, -t <file>       Run an existing task JSON file directly
  --agent                 Start an interactive steering session
  --model <model>         Override model for all agents in this run
  --effort <level>        Override reasoning effort for all agents
                          (off|minimal|low|medium|high|xhigh)
  --mode, -m <mode>       "attended" (default) or "unattended"
  --dry-run               Validate without spawning agents
  --fresh                 Ignore existing task state and start clean
  --tui                   Launch full-screen TUI mode
  --help, -h              Show this help
`;
  process.stdout.write(text);
}

async function runTaskFlow(values: Record<string, unknown>): Promise<number> {
  const taskPath = values.task as string;
  if (!(await Bun.file(taskPath).exists())) {
    process.stderr.write(`Error: task file not found: ${taskPath}\n`);
    return 1;
  }

  const mode = values.mode as PipelineMode | undefined;
  if (mode && mode !== 'attended' && mode !== 'unattended') {
    process.stderr.write('Error: --mode must be "attended" or "unattended"\n');
    return 1;
  }

  try {
    const config = await buildPipelineConfig({
      taskJsonPath: taskPath,
      mode,
      dryRun: values['dry-run'] as boolean | undefined,
    });

    if (values.tui) {
      config.renderer = 'tui';
    }

    await runPipeline(config);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('pipeline crashed', { error: msg });
    process.stderr.write(`Fatal: ${msg}\n`);
    return 1;
  }
}
