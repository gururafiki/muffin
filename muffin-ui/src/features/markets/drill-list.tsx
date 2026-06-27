import { Pressable, View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { changeTone } from './taxonomy';

export interface DrillItem {
  key: string;
  title: string;
  subtitle?: string;
  leading?: string; // emoji / flag
  changePct?: number;
  tag?: string;
}

const toneColor = { bullish: palette.bullish, bearish: palette.bearish, neutral: palette.neutral };

/** Tappable rows to the next drill-down level. */
export function DrillList({
  items,
  onSelect,
}: {
  items: DrillItem[];
  onSelect: (key: string) => void;
}) {
  return (
    <View className="gap-2">
      {items.map((it) => (
        <Pressable key={it.key} onPress={() => onSelect(it.key)} className="active:opacity-80">
          <Card className="flex-row items-center gap-3">
            {it.leading ? <Text style={{ fontSize: 26 }}>{it.leading}</Text> : null}
            <View className="flex-1">
              <Text variant="heading">{it.title}</Text>
              {it.subtitle ? <Text variant="muted">{it.subtitle}</Text> : null}
            </View>
            {typeof it.changePct === 'number' ? (
              <Text
                style={{ color: toneColor[changeTone(it.changePct)] }}
                className="font-semibold">
                {it.changePct >= 0 ? '+' : ''}
                {it.changePct.toFixed(1)}%
              </Text>
            ) : it.tag ? (
              <Text variant="muted">{it.tag}</Text>
            ) : null}
            <Text variant="title" className="text-frosting-300">
              ›
            </Text>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}
