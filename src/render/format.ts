/**
 * Pure formatting functions for the structured log renderer.
 * No state, no I/O — just (input → string) so they're trivial to unit test.
 * Phase 1: no ANSI color. Plain text only.
 */

import type { PhaseSummaryRow } from './types.js';

/** Fixed terminal width for phase header separator lines. */
const HEADER_WIDTH = 60;
/** Fixed terminal width target for right-aligned durations in single-line outputs. */
const LINE_WIDTH = 60;

/**
 * Format a duration as a compact human-readable string.
 *   <1000ms        → "<1s"
 *   <60_000ms      → "Ns"
 *   ≥60_000ms      → "Nm Ss"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

/**
 * Format the start-of-phase header.
 * Example: "▶ implement (implementer) ───────────────────────"
 */
export function formatPhaseHeader(phase: string, agent: string): string {
  const prefix = `▶ ${phase} (${agent}) `;
  const remaining = Math.max(3, HEADER_WIDTH - prefix.length);
  return prefix + '─'.repeat(remaining);
}

/**
 * Format the end-of-phase line. When `contextTokens` is provided (> 0) the
 * phase's peak context occupancy is shown alongside the duration so each
 * completed step reports the same context number as the final summary. When
 * `model`/`effort` are provided they're shown right after the status label.
 * Example: "✓ implement completed  (sonnet-4-5 high)   120.0k ctx   1m 42s"
 *          "✗ implement failed                                       1m 42s"
 */
export function formatPhaseEnd(
  phase: string,
  _agent: string,
  durationMs: number,
  status: 'completed' | 'failed',
  contextTokens?: number,
  model?: string,
  effort?: string,
): string {
  const icon = status === 'completed' ? '✓' : '✗';
  const label = status === 'completed' ? 'completed' : 'failed';
  const meta = formatModelEffort(model, effort);
  const left = `${icon} ${phase} ${label}${meta ? `  (${meta})` : ''}`;
  const dur = formatDuration(durationMs);
  const right = contextTokens ? `${formatTokenCount(contextTokens)} ctx   ${dur}` : dur;
  return padRight(left, right);
}

/**
 * Shorten a model ID for display by dropping a trailing release date
 * (`-YYYYMMDD` or `-YYYY-MM-DD`) and the leading `claude-` vendor prefix.
 * Example: "claude-sonnet-4-5-20250929" → "sonnet-4-5".
 */
export function formatModelLabel(model: string): string {
  return model.replace(/-\d{4}-?\d{2}-?\d{2}$/, '').replace(/^claude-/, '');
}

/** Join a shortened model label and effort into a compact "model effort" string. */
function formatModelEffort(model?: string, effort?: string): string {
  const parts: string[] = [];
  if (model) parts.push(formatModelLabel(model));
  if (effort) parts.push(effort);
  return parts.join(' ');
}

/**
 * Format an indented tool activity line.
 * Example (start):  "    ↳ Read src/auth/handler.ts"
 * Example (end):    "    ↳ Read src/auth/handler.ts               2s"
 */
export function formatToolLine(tool: string, args: string, durationMs?: number): string {
  const argsPart = args ? ` ${args}` : '';
  const left = `    ↳ ${tool}${argsPart}`;
  if (durationMs === undefined) return left;
  return padRight(left, formatDuration(durationMs));
}

/**
 * Format a setup-phase step line. Same shape as a tool line but without
 * trailing duration — setup steps complete fast enough that per-step timing
 * adds noise.
 * Example: "    ↳ Detect repo: authkit-nextjs"
 */
export function formatSetupStep(label: string, detail?: string): string {
  const suffix = detail ? `: ${detail}` : '';
  return `    ↳ ${label}${suffix}`;
}

/**
 * Format a token count compactly.
 *   <1000      → "N"
 *   <1_000_000 → "N.Nk"
 *   ≥1_000_000 → "N.NM"
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

/**
 * Format the final pipeline summary as a vertical breakdown: a header line with
 * total wall-clock time, then one indented row per phase showing that phase's
 * duration and peak context occupancy. Returns an array of lines.
 *
 * Each phase is a fresh agent, so the context column is a per-phase value —
 * never a running total.
 *
 * When any row carries a model/effort, two extra columns are inserted between
 * the phase name and the duration.
 *
 * Example:
 *   ✓ Pipeline complete [6/6]                       18m 6s
 *       scout       sonnet-4-5  high      3m 12s    47.0k ctx
 *       implement   sonnet-4-5  high     10m  4s   120.0k ctx
 *       verify      sonnet-4-5  medium    2m 30s    88.0k ctx
 *       ...
 */
export function formatPipelineComplete(rows: PhaseSummaryRow[], totalDurationMs: number): string[] {
  const total = rows.length;
  const header = padRight(`✓ Pipeline complete [${total}/${total}]`, formatDuration(totalDurationMs));
  if (total === 0) return [header];

  const nameW = Math.max(...rows.map((r) => r.phase.length));
  const durW = Math.max(...rows.map((r) => formatDuration(r.durationMs).length));
  const tokW = Math.max(...rows.map((r) => formatTokenCount(r.contextTokens).length));

  const hasModel = rows.some((r) => r.model);
  const hasEffort = rows.some((r) => r.effort);
  const modelW = hasModel ? Math.max(...rows.map((r) => (r.model ? formatModelLabel(r.model).length : 0))) : 0;
  const effortW = hasEffort ? Math.max(...rows.map((r) => (r.effort ? r.effort.length : 0))) : 0;

  const lines = [header];
  for (const r of rows) {
    const name = r.phase.padEnd(nameW);
    const dur = formatDuration(r.durationMs).padStart(durW);
    const tok = formatTokenCount(r.contextTokens).padStart(tokW);
    const model = hasModel ? `   ${(r.model ? formatModelLabel(r.model) : '').padEnd(modelW)}` : '';
    const effort = hasEffort ? `   ${(r.effort ?? '').padEnd(effortW)}` : '';
    lines.push(`    ${name}${model}${effort}   ${dur}   ${tok} ctx`);
  }
  return lines;
}

/**
 * Format the step-indicator line summarizing pipeline position.
 * Example: "[2/5] ✓ implement → ○ verify → · review → · close → · retro"
 *   ✓ = completed   ○ = active   · = pending
 */
export function formatStepIndicator(completed: string[], active: string, pending: string[]): string {
  const total = completed.length + (active ? 1 : 0) + pending.length;
  const position = completed.length + (active ? 1 : 0);
  const parts: string[] = [];
  for (const phase of completed) parts.push(`✓ ${phase}`);
  if (active) parts.push(`○ ${active}`);
  for (const phase of pending) parts.push(`· ${phase}`);
  return `[${position}/${total}] ${parts.join(' → ')}`;
}

/**
 * Format a single thinking-heartbeat line.
 * Example: "    ··· thinking (34s)"
 */
export function formatHeartbeat(elapsedMs: number): string {
  return `    ··· thinking (${formatDuration(elapsedMs)})`;
}

/**
 * Rotating pool of whimsical thinking messages. Cycled by `tickCount`
 * (deterministic, not random) so users see variety without repetition.
 */
const THINKING_MESSAGES = [
  'thinking...',
  'pondering...',
  'mulling it over...',
  'reading the tea leaves...',
  'consulting the oracle...',
  'staring into the void...',
  'connecting the dots...',
  'chewing on it...',
  'letting it marinate...',
  'downloading more RAM...',
  'asking the rubber duck...',
  'untangling spaghetti...',
  'counting semicolons...',
  'debugging the universe...',
  'reticulating splines...',
] as const;

/**
 * Format a whimsical heartbeat line. The message rotates by `tickCount`
 * modulo the pool size, so tick 0 → "thinking...", tick 14 → "reticulating
 * splines...", tick 15 wraps back to "thinking...".
 */
export function formatHeartbeatWhimsy(elapsedMs: number, tickCount: number): string {
  const idx = ((tickCount % THINKING_MESSAGES.length) + THINKING_MESSAGES.length) % THINKING_MESSAGES.length;
  const msg = THINKING_MESSAGES[idx];
  return `    ··· ${msg} (${formatDuration(elapsedMs)})`;
}

/**
 * Pad a left string with spaces so the right string sits at column LINE_WIDTH.
 * If the combination doesn't fit, falls back to a single space separator.
 */
function padRight(left: string, right: string): string {
  const gap = LINE_WIDTH - left.length - right.length;
  if (gap < 1) return `${left} ${right}`;
  return `${left}${' '.repeat(gap)}${right}`;
}
