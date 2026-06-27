import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import type { PersonaMeta } from './personas';
import { signalTone, type PersonaSignal, type PersonaStage } from './use-council-run';

const STAGE_LABEL: Record<PersonaStage, string> = {
  pending: 'Waiting',
  thinking: 'Warming up…',
  collecting: 'Collecting data…',
  scoring: 'Scoring evidence…',
  deciding: 'Forming verdict…',
  done: '',
};

const toneColor: Record<'bullish' | 'bearish' | 'neutral', string> = {
  bullish: palette.bullish,
  bearish: palette.bearish,
  neutral: palette.neutral,
};

const isActive = (s: PersonaStage) => s !== 'pending' && s !== 'done';

export function PersonaAvatar({
  meta,
  stage,
  signal,
  onPress,
  selected,
}: {
  meta: PersonaMeta;
  stage: PersonaStage;
  signal?: PersonaSignal;
  onPress?: () => void;
  selected?: boolean;
}) {
  const pulse = useSharedValue(0);
  const pop = useSharedValue(1);
  const accent = signal ? toneColor[signalTone(signal.signal)] : palette.frosting[400];

  useEffect(() => {
    if (isActive(stage)) {
      pulse.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.ease) }), -1, false);
    } else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [stage, pulse]);

  useEffect(() => {
    if (stage === 'done') pop.value = withSequence(withTiming(1.18, { duration: 160 }), withSpring(1));
  }, [stage, pop]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.45 }],
    opacity: 0.55 * (1 - pulse.value),
  }));
  const circleStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const dim = stage === 'pending';

  return (
    <Pressable onPress={onPress} className="w-[88px] items-center gap-1" disabled={!onPress}>
      <View className="h-16 w-16 items-center justify-center">
        {/* radar pulse */}
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', height: 56, width: 56, borderRadius: 28, borderWidth: 2, borderColor: accent },
            ringStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              height: 52,
              width: 52,
              borderRadius: 26,
              borderWidth: 2,
              borderColor: stage === 'done' ? accent : palette.frosting[200],
              backgroundColor: selected ? palette.frosting[100] : palette.white,
              opacity: dim ? 0.45 : 1,
              alignItems: 'center',
              justifyContent: 'center',
            },
            circleStyle,
          ]}>
          <Text style={{ fontSize: 24 }}>{meta.emoji}</Text>
        </Animated.View>
      </View>

      <Text variant="muted" numberOfLines={1} className="text-center text-[10px]">
        {meta.name}
      </Text>

      {stage === 'done' && signal?.signal ? (
        <View style={{ backgroundColor: accent }} className="rounded-full px-2 py-0.5">
          <Text className="text-[9px] font-bold uppercase text-white" numberOfLines={1}>
            {signal.signal}
          </Text>
        </View>
      ) : (
        <Text variant="muted" numberOfLines={1} className="text-center text-[9px] text-frosting-400">
          {STAGE_LABEL[stage]}
        </Text>
      )}
    </Pressable>
  );
}
