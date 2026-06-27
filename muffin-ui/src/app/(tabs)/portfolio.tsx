import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Button, Screen, Text } from '@/components/ui';
import { AccountCard } from '@/features/wealth/account-card';
import { AllocationBars } from '@/features/wealth/allocation-bars';
import { GoalCard } from '@/features/wealth/goal-card';
import { NetWorthCard } from '@/features/wealth/net-worth-card';
import { useWealth } from '@/features/wealth/store';

export default function PortfolioScreen() {
  const router = useRouter();
  const { accounts, goals, baseCurrency } = useWealth();

  return (
    <Screen>
      <Text variant="title" className="pt-4">
        Portfolio
      </Text>
      <Text variant="muted">Your wealth across every wrapper. Sample data.</Text>

      <View className="mt-4 gap-4">
        <NetWorthCard accounts={accounts} currency={baseCurrency} />
        <AllocationBars accounts={accounts} currency={baseCurrency} />

        <View className="gap-2">
          <Text variant="label">Accounts</Text>
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              currency={baseCurrency}
              onPress={() => router.push({ pathname: '/account/[accountId]', params: { accountId: a.id } })}
            />
          ))}
        </View>

        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="label">Goals</Text>
            <Button
              title="+ Add goal"
              variant="ghost"
              size="sm"
              onPress={() => router.push({ pathname: '/goal/[goalId]', params: { goalId: 'new' } })}
            />
          </View>
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              currency={baseCurrency}
              onPress={() => router.push({ pathname: '/goal/[goalId]', params: { goalId: g.id } })}
            />
          ))}
        </View>
      </View>
    </Screen>
  );
}
