import { useCallback, useMemo, useRef, useState } from 'react';

import { makeClient } from '@/lib/agent/client';
import { buildConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';
import type { RunStatus } from '@/lib/agent/types';
import { COUNCIL_PERSONAS, normalizeSlug } from './personas';

export type PersonaStage =
  | 'pending'
  | 'thinking'
  | 'collecting'
  | 'scoring'
  | 'deciding'
  | 'done';

export interface PersonaSignal {
  agent_id?: string;
  signal?: string;
  confidence?: number;
  reasoning?: string;
  evidence?: Record<string, unknown>;
}

interface CouncilRunState {
  status: RunStatus;
  threadId: string | null;
  stages: Record<string, PersonaStage>;
  signals: Record<string, PersonaSignal>;
  synthesis: Record<string, unknown> | null;
  error: string | null;
  polled: boolean;
}

const SUBNODE_STAGE: Record<string, PersonaStage> = {
  collect_data: 'collecting',
  compute_evidence: 'scoring',
  render_verdict: 'deciding',
};

const idleStages = (): Record<string, PersonaStage> =>
  Object.fromEntries(COUNCIL_PERSONAS.map((p) => [p.slug, 'pending' as PersonaStage]));

const INITIAL: CouncilRunState = {
  status: 'idle',
  threadId: null,
  stages: idleStages(),
  signals: {},
  synthesis: null,
  error: null,
  polled: false,
};

/**
 * Council-specific run hook. Streams the council graph with `streamSubgraphs`
 * so each persona's live stage (collecting → scoring → deciding) surfaces, then
 * marks personas done as their `persona_signals` land and captures the judge's
 * `council_synthesis`. Falls back to a blocking run if streaming is unavailable.
 */
export function useCouncilRun() {
  const [state, setState] = useState<CouncilRunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const ingestValues = (
    prev: CouncilRunState,
    values: Record<string, unknown>,
  ): CouncilRunState => {
    const list = (values.persona_signals as PersonaSignal[] | undefined) ?? [];
    const signals = { ...prev.signals };
    const stages = { ...prev.stages };
    for (const sig of list) {
      const slug = normalizeSlug(sig.agent_id);
      if (!slug) continue;
      signals[slug] = sig;
      stages[slug] = 'done';
    }
    const synthesis = (values.council_synthesis as Record<string, unknown>) ?? prev.synthesis;
    return { ...prev, signals, stages, synthesis };
  };

  const start = useCallback(
    async (values: Record<string, string>) => {
      cancel();
      const controller = new AbortController();
      abortRef.current = controller;

      const settings = getSettings();
      const client = makeClient(settings);
      const input: Record<string, unknown> = {
        ticker: values.ticker?.toUpperCase(),
        ...(values.query ? { query: values.query } : {}),
      };
      const config = { configurable: buildConfigurable(settings) };

      // All personas start in parallel → show them all thinking immediately.
      setState({
        ...INITIAL,
        status: 'streaming',
        stages: Object.fromEntries(COUNCIL_PERSONAS.map((p) => [p.slug, 'thinking'])),
      });

      let threadId: string | null = null;
      let receivedAny = false;

      try {
        const thread = await client.threads.create();
        threadId = thread.thread_id;
        setState((s) => ({ ...s, threadId }));

        const stream = client.runs.stream(threadId, 'council', {
          input,
          config,
          streamMode: ['updates', 'values'],
          streamSubgraphs: true,
          signal: controller.signal,
        });

        for await (const part of stream) {
          receivedAny = true;
          const [base, namespace] = String(part.event).split('|');

          if (base === 'values' && !namespace) {
            setState((s) => ingestValues(s, part.data as Record<string, unknown>));
          } else if (base === 'updates' && namespace) {
            // Subgraph step → refine this persona's stage.
            const slug = normalizeSlug(namespace.split(':')[0]);
            const subNode = Object.keys((part.data as Record<string, unknown>) ?? {})[0];
            const stage = SUBNODE_STAGE[subNode];
            if (slug && stage) {
              setState((s) =>
                s.stages[slug] === 'done'
                  ? s
                  : { ...s, stages: { ...s.stages, [slug]: stage } },
              );
            }
          } else if (base === 'error') {
            throw new Error(JSON.stringify(part.data));
          }
        }

        setState((s) => ({ ...s, status: 'done' }));
      } catch (err) {
        if (controller.signal.aborted) {
          setState((s) => ({ ...s, status: 'idle' }));
          return;
        }
        if (!receivedAny && threadId) {
          try {
            const finalValues = (await client.runs.wait(threadId, 'council', {
              input,
              config,
            })) as Record<string, unknown>;
            setState((s) => ({
              ...ingestValues({ ...s, polled: true }, finalValues),
              status: 'done',
            }));
            return;
          } catch (waitErr) {
            setState((s) => ({ ...s, status: 'error', error: msg(waitErr) }));
            return;
          }
        }
        setState((s) => ({ ...s, status: 'error', error: msg(err) }));
      }
    },
    [cancel],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  const tally = useMemo(() => voteTally(state.signals), [state.signals]);
  const doneCount = useMemo(
    () => Object.values(state.stages).filter((s) => s === 'done').length,
    [state.stages],
  );
  const judging = state.status === 'streaming' && doneCount === COUNCIL_PERSONAS.length && !state.synthesis;

  return { ...state, start, cancel, reset, tally, doneCount, judging };
}

export type VoteTally = { bullish: number; bearish: number; neutral: number };

export function signalTone(signal?: string): keyof VoteTally {
  const v = (signal ?? '').toLowerCase();
  if (/buy|bull|outperform|positive/.test(v)) return 'bullish';
  if (/sell|bear|underperform|negative/.test(v)) return 'bearish';
  return 'neutral';
}

function voteTally(signals: Record<string, PersonaSignal>): VoteTally {
  const t: VoteTally = { bullish: 0, bearish: 0, neutral: 0 };
  for (const s of Object.values(signals)) t[signalTone(s.signal)] += 1;
  return t;
}

function msg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Unknown error';
}
