import { View } from 'react-native';

import { Card, Chip, Screen, Text } from '@/components/ui';

const SECTORS = [
  'Technology',
  'Financials',
  'Health Care',
  'Energy',
  'Consumer',
  'Industrials',
  'Materials',
  'Utilities',
];

export default function MarketsScreen() {
  return (
    <Screen>
      <Text variant="title" className="pt-4">
        Markets
      </Text>
      <Text variant="muted">High-level sectors — drill down into sub-sectors. (M6)</Text>

      {/* Pie placeholder — interactive sector pie lands in M6. */}
      <Card tone="muted" className="mt-4 items-center justify-center py-12">
        <Text style={{ fontSize: 72 }}>🥧</Text>
        <Text variant="heading" className="mt-2">
          Sector breakdown
        </Text>
        <Text variant="muted" className="text-center">
          A tappable pie with drill-down is on the way.
        </Text>
      </Card>

      <View className="mt-4 flex-row flex-wrap gap-2">
        {SECTORS.map((s) => (
          <Chip key={s} label={s} />
        ))}
      </View>
    </Screen>
  );
}
