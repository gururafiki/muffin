import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Badge, Card, Screen, Text } from '@/components/ui';
import { AGENTS } from '@/lib/agent/registry';

export default function AgentsScreen() {
  const router = useRouter();

  return (
    <Screen>
      <Text variant="title" className="pt-4">
        Agents
      </Text>
      <Text variant="muted">One graph, one page. Pick an agent to run.</Text>

      <View className="mt-4 gap-3">
        {AGENTS.map((agent) => (
          <Pressable
            key={agent.id}
            onPress={() => router.push(`/agents/${agent.id}`)}
            className="active:opacity-80">
            <Card className="flex-row items-center gap-3">
              <Text style={{ fontSize: 34 }}>{agent.emoji}</Text>
              <View className="flex-1 gap-1">
                <View className="flex-row items-center gap-2">
                  <Text variant="heading">{agent.title}</Text>
                  {agent.custom ? <Badge label="custom UI" tone="info" /> : null}
                </View>
                <Text variant="muted">{agent.tagline}</Text>
              </View>
              <Text variant="title" className="text-frosting-300">
                ›
              </Text>
            </Card>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
