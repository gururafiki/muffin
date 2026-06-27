import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';

import { Badge, Card, Text, type Signal } from '@/components/ui';
import { StructuredOutput } from '@/lib/agent/renderers';
import { signalTone } from './use-council-run';

const KNOWN = new Set([
  'consensus_rating',
  'weighted_confidence',
  'vote_breakdown',
  'bull_case_synthesis',
  'bear_case_synthesis',
  'dissent_summary',
  'key_uncertainties',
  'reasoning',
]);

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function Section({ label, body }: { label: string; body?: string }) {
  if (!body) return null;
  return (
    <View className="gap-1">
      <Text variant="label">{label}</Text>
      <Text variant="body">{body}</Text>
    </View>
  );
}

/** The judge: deliberating shimmer, then the council's synthesised verdict. */
export function JudgePanel({
  synthesis,
  judging,
}: {
  synthesis: Record<string, unknown> | null;
  judging: boolean;
}) {
  const shimmer = useSharedValue(0);
  useEffect(() => {
    if (judging) shimmer.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    else shimmer.value = 0;
  }, [judging, shimmer]);
  const shimmerStyle = useAnimatedStyle(() => ({ opacity: 0.5 + shimmer.value * 0.5 }));

  if (judging) {
    return (
      <Card tone="muted" className="items-center gap-2 py-6">
        <Animated.Text style={[{ fontSize: 40 }, shimmerStyle]}>🧑‍⚖️</Animated.Text>
        <Text variant="heading">The judge is deliberating…</Text>
        <Text variant="muted">Weighing 13 verdicts into a consensus.</Text>
      </Card>
    );
  }

  if (!synthesis) return null;

  const rating = str(synthesis.consensus_rating);
  const confidence = synthesis.weighted_confidence;
  const tone: Signal = rating ? (signalTone(rating) as Signal) : 'info';
  const extras = Object.fromEntries(
    Object.entries(synthesis).filter(([k, v]) => !KNOWN.has(k) && v != null),
  );

  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-2">
        <Text style={{ fontSize: 26 }}>🧑‍⚖️</Text>
        <Text variant="heading">Council Verdict</Text>
      </View>

      <View className="flex-row items-center gap-3">
        {rating ? <Badge label={rating} tone={tone} /> : null}
        {typeof confidence === 'number' ? (
          <Text variant="muted">confidence {Math.round(confidence * 100)}%</Text>
        ) : null}
      </View>

      <Section label="Bull case" body={str(synthesis.bull_case_synthesis)} />
      <Section label="Bear case" body={str(synthesis.bear_case_synthesis)} />
      <Section label="Dissent" body={str(synthesis.dissent_summary)} />
      <Section label="Reasoning" body={str(synthesis.reasoning)} />

      {synthesis.key_uncertainties ? (
        <View className="gap-1">
          <Text variant="label">Key uncertainties</Text>
          <StructuredOutput value={synthesis.key_uncertainties} depth={1} />
        </View>
      ) : null}

      {synthesis.vote_breakdown ? (
        <View className="gap-1">
          <Text variant="label">Vote breakdown</Text>
          <StructuredOutput value={synthesis.vote_breakdown} depth={1} />
        </View>
      ) : null}

      {Object.keys(extras).length > 0 ? <StructuredOutput value={extras} /> : null}
    </Card>
  );
}
