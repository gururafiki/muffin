export type RunStatus = 'idle' | 'streaming' | 'done' | 'error';

/** One streamed step: a node finished and emitted a partial state update. */
export interface TimelineItem {
  id: string;
  /** Graph node name (e.g. "classifier", "warren_buffett"). */
  node: string;
  /** The partial state this node emitted. */
  data: Record<string, unknown>;
  ts: number;
}

export interface RunState {
  status: RunStatus;
  threadId: string | null;
  timeline: TimelineItem[];
  /** Latest full state snapshot (stream_mode "values"). */
  values: Record<string, unknown> | null;
  error: string | null;
  /** True when the live stream failed and we fell back to polling. */
  polled: boolean;
}
