import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { formatMoney, netWorth, totalAssets, totalLiabilities, type Account } from './portfolio';

/** Headline net-worth card: assets − liabilities, with a sample day change. */
export function NetWorthCard({ accounts, currency }: { accounts: Account[]; currency: string }) {
  const nw = netWorth(accounts);
  const assets = totalAssets(accounts);
  const liabilities = totalLiabilities(accounts);
  const dayChange = nw * 0.006; // sample +0.6%

  return (
    <Card className="gap-2">
      <Text variant="label">Net worth</Text>
      <Text variant="display">{formatMoney(nw, currency)}</Text>
      <Text style={{ color: palette.bullish }} className="font-semibold">
        +{formatMoney(dayChange, currency)} today (sample)
      </Text>
      <View className="mt-1 flex-row gap-6">
        <View>
          <Text variant="muted">Assets</Text>
          <Text variant="heading" style={{ color: palette.bullish }}>
            {formatMoney(assets, currency)}
          </Text>
        </View>
        <View>
          <Text variant="muted">Liabilities</Text>
          <Text variant="heading" style={{ color: palette.bearish }}>
            {formatMoney(liabilities, currency)}
          </Text>
        </View>
      </View>
    </Card>
  );
}
