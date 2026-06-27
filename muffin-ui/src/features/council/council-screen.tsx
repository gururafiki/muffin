import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Avatar, Badge, Button, Card, Field, Text } from '@/components/ui';
import type { AgentDef } from '@/lib/agent/registry';
import { CouncilArena } from './council-arena';
import { JudgePanel } from './judge-panel';
import { getPersonaMeta } from './personas';
import { signalTone, useCouncilRun } from './use-council-run';
import { VoteBar } from './vote-bar';

export function CouncilScreen(_props: { agent: AgentDef }) {
  const [ticker, setTicker] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const run = useCouncilRun();

  const streaming = run.status === 'streaming';
  const totalVotes = run.tally.bullish + run.tally.bearish + run.tally.neutral;
  const selSignal = selected ? run.signals[selected] : undefined;
  const selMeta = selected ? getPersonaMeta(selected) : undefined;

  return (
    <View className="gap-4">
      <Card className="gap-3">
        <View className="flex-row items-center gap-2">
          <Text style={{ fontSize: 28 }}>🧑‍⚖️</Text>
          <View className="flex-1">
            <Text variant="heading">Investor Council</Text>
            <Text variant="muted">13 legends debate, a judge decides.</Text>
          </View>
        </View>
        <Field
          label="Ticker"
          placeholder="AAPL"
          autoCapitalize="characters"
          autoCorrect={false}
          value={ticker}
          onChangeText={setTicker}
        />
        <Field
          label="Focus (optional)"
          placeholder="Is the moat durable?"
          value={query}
          onChangeText={setQuery}
        />
        <Button
          title={streaming ? 'In session…' : 'Convene the council'}
          loading={streaming}
          disabled={!ticker.trim()}
          onPress={() => {
            setSelected(null);
            run.start({ ticker, query });
          }}
        />
        {streaming ? <Button title="Cancel" variant="ghost" onPress={run.cancel} /> : null}
      </Card>

      {run.status === 'error' ? (
        <Card tone="outline" className="gap-1">
          <Badge label="error" tone="bearish" />
          <Text variant="muted">{run.error}</Text>
        </Card>
      ) : null}

      {run.polled ? (
        <Card tone="muted">
          <Text variant="muted">Live streaming was unavailable — showing the final result.</Text>
        </Card>
      ) : null}

      {streaming || totalVotes > 0 ? (
        <Card className="gap-2">
          <VoteBar tally={run.tally} />
        </Card>
      ) : null}

      {streaming || totalVotes > 0 ? (
        <CouncilArena
          stages={run.stages}
          signals={run.signals}
          selected={selected}
          onSelect={(slug) => setSelected((cur) => (cur === slug ? null : slug))}
          active={streaming}
        />
      ) : null}

      {selMeta ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <Pressable onPress={() => setSelected(null)}>
            <Card className="gap-2">
              <View className="flex-row items-center gap-3">
                <Avatar name={selMeta.name} size={44} />
                <View className="flex-1">
                  <Text variant="heading">{selMeta.name}</Text>
                  <Text variant="muted">{selMeta.style}</Text>
                </View>
                {selSignal?.signal ? <Badge label={selSignal.signal} tone={signalTone(selSignal.signal)} /> : null}
              </View>
              {typeof selSignal?.confidence === 'number' ? (
                <Text variant="muted">confidence {Math.round(selSignal.confidence * 100)}%</Text>
              ) : null}
              {selSignal?.reasoning ? (
                <Text variant="body">{selSignal.reasoning}</Text>
              ) : (
                <Text variant="muted">{selMeta.name} is still deliberating…</Text>
              )}
            </Card>
          </Pressable>
        </Animated.View>
      ) : null}

      {run.judging || run.synthesis ? (
        <Animated.View entering={FadeInDown.duration(300)}>
          <JudgePanel synthesis={run.synthesis} judging={run.judging} />
        </Animated.View>
      ) : null}
    </View>
  );
}
