import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, Field, Text } from '@/components/ui';
import type { AgentDef } from '@/lib/agent/registry';
import { StructuredOutput, TimelineItemCard } from '@/lib/agent/renderers';
import { useAgentRun } from '@/lib/agent/use-agent-run';
import type { RunState } from '@/lib/agent/types';

type RunnerRender = (run: RunState) => React.ReactNode;

/**
 * Generic agent run screen: collects the agent's declared inputs, kicks a run,
 * and renders the streamed timeline + final structured output. A custom screen
 * (e.g. council) can pass `renderResult` to lay the final state out its own way.
 */
export function AgentRunner({
  agent,
  renderResult,
}: {
  agent: AgentDef;
  renderResult?: RunnerRender;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const run = useAgentRun(agent);

  const canRun = useMemo(
    () => agent.inputs.every((f) => !f.required || (values[f.key]?.trim()?.length ?? 0) > 0),
    [agent.inputs, values],
  );

  const result = agent.resultKey ? run.values?.[agent.resultKey] : run.values;
  const streaming = run.status === 'streaming';

  return (
    <View className="gap-4">
      <Card className="gap-3">
        <View className="flex-row items-center gap-2">
          <Text style={{ fontSize: 28 }}>{agent.emoji}</Text>
          <View className="flex-1">
            <Text variant="heading">{agent.title}</Text>
            <Text variant="muted">{agent.tagline}</Text>
          </View>
        </View>

        {agent.inputs.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            placeholder={f.placeholder}
            autoCapitalize={f.autoCapitalize}
            autoCorrect={false}
            value={values[f.key] ?? ''}
            onChangeText={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
          />
        ))}

        <Button
          title={streaming ? 'Running…' : 'Run agent'}
          loading={streaming}
          disabled={!canRun}
          onPress={() => run.start(values)}
        />
        {streaming ? (
          <Button title="Cancel" variant="ghost" onPress={run.cancel} />
        ) : null}
      </Card>

      {run.status === 'error' ? (
        <Card tone="outline" className="gap-1">
          <Badge label="error" tone="bearish" />
          <Text variant="muted">{run.error}</Text>
        </Card>
      ) : null}

      {run.polled ? (
        <Card tone="muted">
          <Text variant="muted">
            Live streaming was unavailable on this platform — showing the final result.
          </Text>
        </Card>
      ) : null}

      {/* Headline result */}
      {result ? (
        renderResult ? (
          renderResult(run)
        ) : (
          <Card className="gap-2">
            <Badge label={run.status === 'done' ? 'result' : 'streaming result'} tone="info" />
            <StructuredOutput value={result} />
          </Card>
        )
      ) : null}

      {/* Streamed timeline */}
      {run.timeline.length > 0 ? (
        <View className="gap-2">
          <Text variant="label">Run timeline</Text>
          {run.timeline.map((item) => (
            <TimelineItemCard key={item.id} item={item} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
