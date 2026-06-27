import { Stack, useLocalSearchParams } from 'expo-router';

import { AgentRunner } from '@/components/agent-runner';
import { Card, Screen, Text } from '@/components/ui';
import { CouncilScreen } from '@/features/council/council-screen';
import { getAgent } from '@/lib/agent/registry';

export default function AgentRunnerRoute() {
  const { assistantId } = useLocalSearchParams<{ assistantId: string }>();
  const agent = getAgent(assistantId);

  if (!agent) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Unknown agent</Text>
          <Text variant="muted">No agent registered for “{assistantId}”.</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: agent.title }} />
      {agent.custom === 'council' ? (
        <CouncilScreen agent={agent} />
      ) : (
        <AgentRunner agent={agent} />
      )}
    </Screen>
  );
}
