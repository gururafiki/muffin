import { Stack, useLocalSearchParams } from 'expo-router';

import { AgentRunner } from '@/components/agent-runner';
import { Card, Screen, Text } from '@/components/ui';
import { CouncilScreen } from '@/features/council/council-screen';
import { getAgent } from '@/lib/agent/registry';

const FIELD_KEYS = ['query', 'ticker', 'prompt', 'sector', 'market'];

export default function AgentRunnerRoute() {
  const params = useLocalSearchParams<Record<string, string>>();
  const assistantId = params.assistantId;
  const agent = getAgent(assistantId);

  // Seed the runner from any field-shaped params (e.g. an "Analyse" deep link).
  const initialValues: Record<string, string> = {};
  for (const k of FIELD_KEYS) if (params[k]) initialValues[k] = params[k];
  const autoStart = params.autostart === '1';

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
        <AgentRunner
          agent={agent}
          initialValues={Object.keys(initialValues).length ? initialValues : undefined}
          autoStart={autoStart}
        />
      )}
    </Screen>
  );
}
