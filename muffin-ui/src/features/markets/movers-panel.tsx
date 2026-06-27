import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Badge, Card, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { changeTone, sortMovers, type MoverItem } from './taxonomy';

const toneColor = { bullish: palette.bullish, bearish: palette.bearish, neutral: palette.neutral };

function fmt(pct: number) {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function MoverRow({
  item,
  maxAbs,
  onPress,
}: {
  item: MoverItem;
  maxAbs: number;
  onPress?: () => void;
}) {
  const color = toneColor[changeTone(item.changePct)];
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(maxAbs ? Math.abs(item.changePct) / maxAbs : 0, { duration: 500 });
  }, [item.changePct, maxAbs, w]);
  const barStyle = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));

  return (
    <Pressable onPress={onPress} disabled={!onPress} className="gap-1 active:opacity-80">
      <View className="flex-row items-center justify-between">
        <Text variant="body" numberOfLines={1} className="flex-1">
          {item.sublabel ? `${item.sublabel} ` : ''}
          {item.label}
        </Text>
        <Text variant="body" style={{ color }} className="font-semibold">
          {fmt(item.changePct)}
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-crust dark:bg-[#2E2042]">
        <Animated.View style={[{ height: '100%', backgroundColor: color }, barStyle]} />
      </View>
    </Pressable>
  );
}

/** Best/worst movers with animated bars. Numbers are SAMPLE data. */
export function MoversPanel({
  title,
  items,
  count = 3,
  onSelect,
}: {
  title: string;
  items: MoverItem[];
  count?: number;
  onSelect?: (key: string) => void;
}) {
  const sorted = sortMovers(items);
  const best = sorted.slice(0, count);
  const worst = sorted.slice(-count).reverse().filter((w) => !best.includes(w));
  const maxAbs = Math.max(1, ...items.map((i) => Math.abs(i.changePct)));

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="heading">{title}</Text>
        <Badge label="sample" tone="info" />
      </View>

      <Text variant="label">Top performers</Text>
      <View className="gap-2">
        {best.map((m) => (
          <MoverRow key={m.key} item={m} maxAbs={maxAbs} onPress={onSelect && (() => onSelect(m.key))} />
        ))}
      </View>

      {worst.length > 0 ? (
        <>
          <Text variant="label">Laggards</Text>
          <View className="gap-2">
            {worst.map((m) => (
              <MoverRow key={m.key} item={m} maxAbs={maxAbs} onPress={onSelect && (() => onSelect(m.key))} />
            ))}
          </View>
        </>
      ) : null}
    </Card>
  );
}
