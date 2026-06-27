import { Pressable, View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { accountTypeMeta, accountValue, formatMoney, type Account } from './portfolio';

export function AccountCard({
  account,
  currency,
  onPress,
}: {
  account: Account;
  currency: string;
  onPress?: () => void;
}) {
  const meta = accountTypeMeta(account.type);
  const value = accountValue(account);
  const negative = value < 0;

  return (
    <Pressable onPress={onPress} disabled={!onPress} className="active:opacity-80">
      <Card className="flex-row items-center gap-3">
        <Text style={{ fontSize: 28 }}>{meta.emoji}</Text>
        <View className="flex-1">
          <Text variant="heading">{account.name}</Text>
          <View className="mt-0.5 flex-row items-center gap-2">
            <Badge label={meta.name} tone="info" />
            {account.holdings.length ? (
              <Text variant="muted">{account.holdings.length} holdings</Text>
            ) : null}
          </View>
        </View>
        <Text
          variant="heading"
          style={{ color: negative ? palette.bearish : undefined }}>
          {formatMoney(value, currency)}
        </Text>
      </Card>
    </Pressable>
  );
}
