import type { Notifier } from '../notify.js';
import { defaultAskUser } from '../notify.js';
import type { PipelineMode } from '../types.js';
import { bold, cyan, dim, green, red, yellow } from './color.js';
import {
  formatDuration,
  formatHeartbeatWhimsy,
  formatPhaseEnd,
  formatPhaseHeader,
  formatPipelineComplete,
  formatTokenCount,
  formatToolLine,
} from './format.js';
import type { PhaseSummaryRow } from './types.js';

export interface StructuredLogRendererOptions {
  /** Output sink. Default: writes to process.stdout. */
  write?: (text: string) => void;
  mode: PipelineMode;
  /** Heartbeat tick interval in ms. Default: 10_000. */
  heartbeatIntervalMs?: number;
  /** Override for the wall clock (testing). Default: Date.now. */
  now?: () => number;
  /** Override for the interval scheduler (testing). */
  setInterval?: (cb: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

/** Duration thresholds for color escalation (ms). */
const DURATION_YELLOW_MS = 30_000;
const DURATION_RED_MS = 120_000;

/**
 * Return a duration string colored by its magnitude.
 *   < 30s  → default
 *   < 2min → yellow
 *   ≥ 2min → red
 */
function colorDuration(durationMs: number): string {
  const text = formatDuration(durationMs);
  if (durationMs >= DURATION_RED_MS) return red(text);
  if (durationMs >= DURATION_YELLOW_MS) return yellow(text);
  return text;
}

/**
 * Recolor a formatted phase-end line: green/red icon, threshold-colored context
 * tokens (matching the summary + pi's footer thresholds) and threshold-colored
 * duration. Body padding stays default.
 */
function colorPhaseEndLine(
  phase: string,
  agent: string,
  durationMs: number,
  status: 'completed' | 'failed',
  contextTokens?: number,
): string {
  const raw = formatPhaseEnd(phase, agent, durationMs, status, contextTokens);
  const icon = status === 'completed' ? green(raw[0]!) : red(raw[0]!);
  let body = raw.slice(1);

  // Recolor the duration tail (rightmost occurrence — the trailing column).
  const durText = formatDuration(durationMs);
  const durIdx = body.lastIndexOf(durText);
  if (durIdx >= 0) {
    body = body.slice(0, durIdx) + colorDuration(durationMs) + body.slice(durIdx + durText.length);
  }

  // Recolor the "N.Nk ctx" tail by absolute token count.
  if (contextTokens) {
    const ctxText = `${formatTokenCount(contextTokens)} ctx`;
    const ctxIdx = body.indexOf(ctxText);
    if (ctxIdx >= 0) {
      const ctxColor = contextTokens >= 500_000 ? red : contextTokens >= 120_000 ? yellow : dim;
      body = body.slice(0, ctxIdx) + ctxColor(ctxText) + body.slice(ctxIdx + ctxText.length);
    }
  }

  return `${icon}${body}`;
}

/**
 * Build a colored step-indicator line: green ✓ completed, cyan ○ active,
 * dim · pending (with pending phase names dimmed too).
 */
function colorStepIndicator(completed: string[], active: string, pending: string[]): string {
  const total = completed.length + (active ? 1 : 0) + pending.length;
  const position = completed.length + (active ? 1 : 0);
  const parts: string[] = [];
  for (const phase of completed) parts.push(`${green('✓')} ${phase}`);
  if (active) parts.push(`${cyan('○')} ${active}`);
  for (const phase of pending) parts.push(`${dim('·')} ${dim(phase)}`);
  return `[${position}/${total}] ${parts.join(' → ')}`;
}

/**
 * Color the vertical pipeline summary: bold green header, dim per-phase rows
 * with the context column threshold-colored by absolute token count (matching
 * pi's footer thresholds: ≥500k red, ≥120k yellow).
 */
function colorPipelineComplete(rows: PhaseSummaryRow[], totalDurationMs: number): string[] {
  const lines = formatPipelineComplete(rows, totalDurationMs);
  const [header, ...phaseLines] = lines;
  const coloredHeader = `${green('✓')}${bold(header.slice(1))}`;
  const coloredPhaseLines = phaseLines.map((line, i) => {
    const tokens = rows[i]?.contextTokens ?? 0;
    const ctxColor = tokens >= 500_000 ? red : tokens >= 120_000 ? yellow : dim;
    // Recolor only the "N.Nk ctx" tail; keep the name/duration dim.
    const ctxMatch = line.match(/\S+ ctx$/);
    if (!ctxMatch) return dim(line);
    const head = line.slice(0, line.length - ctxMatch[0].length);
    return `${dim(head)}${ctxColor(ctxMatch[0])}`;
  });
  return [coloredHeader, ...coloredPhaseLines];
}

/**
 * Color a phase header line: bold prefix, dim trailing separator.
 */
function colorPhaseHeader(phase: string, agent: string): string {
  const raw = formatPhaseHeader(phase, agent);
  const sepMatch = raw.match(/─+$/);
  if (!sepMatch) return bold(raw);
  const sepStart = raw.length - sepMatch[0].length;
  return `${bold(raw.slice(0, sepStart))}${dim(raw.slice(sepStart))}`;
}

/**
 * Color a tool activity line: whole line dim, duration threshold-colored.
 */
function colorToolLine(tool: string, args: string, durationMs?: number): string {
  if (durationMs === undefined) return dim(formatToolLine(tool, args));
  const raw = formatToolLine(tool, args, durationMs);
  const durText = formatDuration(durationMs);
  const leftRaw = raw.endsWith(durText) ? raw.slice(0, raw.length - durText.length) : raw;
  return `${dim(leftRaw)}${colorDuration(durationMs)}`;
}

/**
 * StructuredLogRenderer — implements the full Notifier interface using plain text
 * decorated with ANSI color (TTY-detected; suppressed under NO_COLOR; forced
 * under FORCE_COLOR). Renders phase boundaries, tool activity, step indicators,
 * and a whimsical thinking heartbeat.
 *
 * The heartbeat is a wall-clock setInterval that prints rotating "thinking"
 * lines while the agent is silent. Each tool/phase event resets the elapsed
 * counter and the tick counter, so heartbeats fire only during true silence
 * and the whimsy message starts fresh each time.
 */
export function createStructuredLogRenderer(options: StructuredLogRendererOptions): Notifier {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const mode = options.mode;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
  const now = options.now ?? (() => Date.now());
  const setIntervalFn = options.setInterval ?? ((cb, ms) => setInterval(cb, ms));
  const clearIntervalFn =
    options.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));

  let heartbeatTimer: unknown = null;
  let lastActivityAt = 0;
  let tickCount = 0;

  function writeLine(line: string) {
    write(`${line}\n`);
  }

  return {
    send(message) {
      writeLine(message);
    },

    phaseStart(phase, agent) {
      lastActivityAt = now();
      tickCount = 0;
      writeLine(colorPhaseHeader(phase, agent));
    },

    phaseEnd(phase, agent, durationMs, status, contextTokens) {
      writeLine(colorPhaseEndLine(phase, agent, durationMs, status, contextTokens));
    },

    toolStart(tool, args) {
      lastActivityAt = now();
      tickCount = 0;
      writeLine(colorToolLine(tool, args));
    },

    toolEnd(tool, durationMs, isError) {
      lastActivityAt = now();
      tickCount = 0;
      const suffix = isError ? red(' (error)') : '';
      writeLine(`${colorToolLine(tool, '', durationMs)}${suffix}`);
    },

    stepIndicator(completed, active, pending) {
      writeLine(colorStepIndicator(completed, active, pending));
    },

    pipelineComplete(rows, totalDurationMs) {
      for (const line of colorPipelineComplete(rows, totalDurationMs)) writeLine(line);
    },

    startHeartbeat() {
      // Idempotent: clear any prior timer first.
      if (heartbeatTimer !== null) {
        clearIntervalFn(heartbeatTimer);
        heartbeatTimer = null;
      }
      lastActivityAt = now();
      tickCount = 0;
      heartbeatTimer = setIntervalFn(() => {
        const elapsed = now() - lastActivityAt;
        writeLine(dim(formatHeartbeatWhimsy(elapsed, tickCount)));
        tickCount++;
      }, heartbeatIntervalMs);
    },

    stopHeartbeat() {
      if (heartbeatTimer !== null) {
        clearIntervalFn(heartbeatTimer);
        heartbeatTimer = null;
      }
    },

    async askUser(userPrompt, choices) {
      return defaultAskUser(mode, userPrompt, choices);
    },
  };
}
