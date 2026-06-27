import { View } from 'react-native';

import { AgentRunner } from '@/components/agent-runner';
import { Avatar, Badge, Card, Text, type Signal } from '@/components/ui';
import type { AgentDef } from '@/lib/agent/registry';
import { StructuredOutput } from '@/lib/agent/renderers';
import type { RunState } from '@/lib/agent/types';
import { COUNCIL_PERSONAS, prettyPersona } from './personas';

type PersonaSignal = { agent_id?: string; signal?: string; confidence?: number; reasoning?: string };

function toneFor(signal?: string): Signal {
  const v = (signal ?? '').toLowerCase();
  if (/buy|bull/.test(v)) return 'bullish';
  if (/sell|bear/.test(v)) return 'bearish';
  return 'neutral';
}

/**
 * Council custom screen (M1 stub for the M3 showcase). Shows the 13 investor
 * avatars and, as the run streams, surfaces each persona's verdict next to its
 * avatar, then the judge's synthesis. The full animated debate flow is M3.
 */
export function CouncilScreen({ agent }: { agent: AgentDef }) {
  return (
    <View className="gap-4">
      <Card tone="muted" className="gap-3">
        <Text variant="heading">The Council</Text>
        <Text variant="muted">
          Thirteen famous investors weigh in, then a judge synthesises a verdict.
        </Text>
        <View className="flex-row flex-wrap gap-3 pt-1">
          {COUNCIL_PERSONAS.map((p) => (
            <View key={p} className="w-16 items-center gap-1">
              <Avatar name={prettyPersona(p)} size={44} />
              <Text variant="muted" className="text-center text-[10px]">
                {prettyPersona(p)}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <AgentRunner agent={agent} renderResult={renderCouncil} />
    </View>
  );
}

function renderCouncil(run: RunState) {
  const signals = (run.values?.persona_signals as PersonaSignal[] | undefined) ?? [];
  const synthesis = run.values?.council_synthesis;

  return (
    <View className="gap-4">
      {signals.length > 0 ? (
        <View className="gap-2">
          <Text variant="label">Persona verdicts ({signals.length}/13)</Text>
          {signals.map((s, i) => (
            <Card key={i} className="flex-row gap-3">
              <Avatar name={prettyPersona(s.agent_id ?? 'analyst')} size={40} />
              <View className="flex-1 gap-1">
                <View className="flex-row items-center gap-2">
                  <Text variant="heading">{prettyPersona(s.agent_id ?? 'Analyst')}</Text>
                  {s.signal ? <Badge label={s.signal} tone={toneFor(s.signal)} /> : null}
                </View>
                {typeof s.confidence === 'number' ? (
                  <Text variant="muted">confidence {Math.round(s.confidence * 100)}%</Text>
                ) : null}
                {s.reasoning ? <Text variant="body">{s.reasoning}</Text> : null}
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {synthesis ? (
        <Card className="gap-2">
          <Badge label="judge synthesis" tone="info" />
          <StructuredOutput value={synthesis} />
        </Card>
      ) : null}
    </View>
  );
}
