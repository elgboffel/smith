/**
 * Event describing a single tool invocation lifecycle event.
 * Emitted by agent adapters (e.g. pi-adapter) and consumed by the renderer.
 */
export interface ToolActivityEvent {
  type: 'start' | 'end';
  tool: string;
  args?: string;
  durationMs?: number;
  isError?: boolean;
}

/**
 * One row in the final pipeline summary: a completed phase with its wall-clock
 * duration and peak context occupancy. Rendered as a vertical breakdown when
 * the pipeline finishes.
 */
export interface PhaseSummaryRow {
  phase: string;
  durationMs: number;
  contextTokens: number;
  /** Model ID this phase's agent ran on, when known. */
  model?: string;
  /** Reasoning effort this phase's agent ran with, when known. */
  effort?: string;
}
