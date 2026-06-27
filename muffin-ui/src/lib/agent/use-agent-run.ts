import { useCallback, useRef, useState } from 'react';

import { buildConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';
import { makeClient } from './client';
import type { AgentDef } from './registry';
import type { RunState, TimelineItem } from './types';

const INITIAL: RunState = {
  status: 'idle',
  threadId: null,
  timeline: [],
  values: null,
  error: null,
  polled: false,
};

let seq = 0;

/**
 * Drive a single agent run. Streams node-by-node updates (`stream_mode`
 * "updates") plus final state ("values"). If the live stream fails before any
 * event arrives — e.g. a platform without streaming-fetch — it transparently
 * falls back to a blocking `runs.wait` and surfaces the final state.
 */
export function useAgentRun(agent: AgentDef) {
  const [state, setState] = useState<RunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const start = useCallback(
    async (values: Record<string, string>) => {
      cancel();
      const controller = new AbortController();
      abortRef.current = controller;

      const settings = getSettings();
      const client = makeClient(settings);
      const input = agent.buildInput(values);
      const config = { configurable: buildConfigurable(settings) };

      setState({ ...INITIAL, status: 'streaming' });

      let threadId: string | null = null;
      let receivedAny = false;

      try {
        const thread = await client.threads.create();
        threadId = thread.thread_id;
        setState((s) => ({ ...s, threadId }));

        const stream = client.runs.stream(threadId, agent.id, {
          input,
          config,
          streamMode: ['updates', 'values'],
          signal: controller.signal,
        });

        for await (const part of stream) {
          receivedAny = true;
          if (part.event === 'updates' && part.data) {
            const items: TimelineItem[] = Object.entries(
              part.data as Record<string, unknown>,
            ).map(([node, data]) => ({
              id: `${Date.now()}-${seq++}`,
              node,
              data: (data ?? {}) as Record<string, unknown>,
              ts: Date.now(),
            }));
            setState((s) => ({ ...s, timeline: [...s.timeline, ...items] }));
          } else if (part.event === 'values') {
            setState((s) => ({ ...s, values: part.data as Record<string, unknown> }));
          } else if (part.event === 'error') {
            throw new Error(JSON.stringify(part.data));
          }
        }

        setState((s) => ({ ...s, status: 'done' }));
      } catch (err) {
        if (controller.signal.aborted) {
          setState((s) => ({ ...s, status: 'idle' }));
          return;
        }
        // Streaming never produced an event → fall back to a blocking run.
        if (!receivedAny && threadId) {
          try {
            const finalValues = await client.runs.wait(threadId, agent.id, { input, config });
            setState((s) => ({
              ...s,
              status: 'done',
              polled: true,
              values: finalValues as Record<string, unknown>,
            }));
            return;
          } catch (waitErr) {
            setState((s) => ({ ...s, status: 'error', error: errorMessage(waitErr) }));
            return;
          }
        }
        setState((s) => ({ ...s, status: 'error', error: errorMessage(err) }));
      }
    },
    [agent, cancel],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, start, cancel, reset };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Unknown error';
}
