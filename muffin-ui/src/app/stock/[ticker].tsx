import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Card, Screen, Text } from '@/components/ui';
import { AGENTS } from '@/lib/agent/registry';

/**
 * Stock detail stub. The full page (price, fundamentals, asset metadata) is M6;
 * for now it links the ticker into the relevant agents.
 */
export default function StockScreen() {
  const { ticker } = useLocalSearchParams<{ ticker: string }>();
  const router = useRouter();
  const symbol = (ticker ?? '').toUpperCase();
  const stockAgents = AGENTS.filter((a) => a.inputs.some((f) => f.key === 'ticker'));

  return (
    <Screen>
      <Stack.Screen options={{ title: symbol }} />
      <Text variant="display" className="pt-4">
        {symbol}
      </Text>
      <Text variant="muted">Run an analysis agent for this stock.</Text>

      <View className="mt-4 gap-3">
        {stockAgents.map((agent) => (
          <Pressable
            key={agent.id}
            onPress={() => router.push(`/agents/${agent.id}`)}
            className="active:opacity-80">
            <Card className="flex-row items-center gap-3">
              <Text style={{ fontSize: 30 }}>{agent.emoji}</Text>
              <View className="flex-1">
                <Text variant="heading">{agent.title}</Text>
                <Text variant="muted">{agent.tagline}</Text>
              </View>
            </Card>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
