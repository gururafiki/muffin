import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Card, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { formatMoney, goalProgress, type Goal } from './portfolio';

function fmtDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

export function GoalCard({
  goal,
  currency,
  onPress,
}: {
  goal: Goal;
  currency: string;
  onPress?: () => void;
}) {
  const progress = goalProgress(goal);
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(progress, { duration: 700 });
  }, [progress, w]);
  const barStyle = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  const date = fmtDate(goal.targetDate);

  return (
    <Pressable onPress={onPress} disabled={!onPress} className="active:opacity-80">
      <Card className="gap-2">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Text style={{ fontSize: 22 }}>{goal.emoji}</Text>
            <Text variant="heading">{goal.name}</Text>
          </View>
          <Text variant="heading" style={{ color: palette.frosting[600] }}>
            {Math.round(progress * 100)}%
          </Text>
        </View>
        <View className="h-3 overflow-hidden rounded-full bg-crust dark:bg-[#2E2042]">
          <Animated.View style={[{ height: '100%', backgroundColor: palette.frosting[500] }, barStyle]} />
        </View>
        <View className="flex-row items-center justify-between">
          <Text variant="muted">
            {formatMoney(goal.currentAmount, currency)} of {formatMoney(goal.targetAmount, currency)}
          </Text>
          {date ? <Text variant="muted">by {date}</Text> : null}
        </View>
      </Card>
    </Pressable>
  );
}
