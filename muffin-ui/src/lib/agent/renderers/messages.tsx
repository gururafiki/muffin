import { View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';
import { JsonBlock } from './json-block';

type AnyMessage = {
  type?: string;
  role?: string;
  content?: unknown;
  name?: string;
  tool_calls?: { name?: string; args?: unknown }[];
};

function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
      .join('');
  }
  return '';
}

/** Render a single LangChain message (human / ai / tool). */
export function MessageBubble({ message }: { message: AnyMessage }) {
  const kind = (message.type ?? message.role ?? 'ai').toLowerCase();
  const body = textContent(message.content);
  const toolCalls = message.tool_calls ?? [];

  if (kind === 'tool') {
    return (
      <Card tone="muted" className="gap-1">
        <Badge label={`tool · ${message.name ?? 'result'}`} tone="info" />
        {body ? <Text variant="mono" className="text-xs">{body.slice(0, 1200)}</Text> : null}
      </Card>
    );
  }

  const isHuman = kind === 'human' || kind === 'user';
  return (
    <Card tone={isHuman ? 'outline' : 'raised'} className="gap-2">
      <Badge label={isHuman ? 'you' : (message.name ?? 'agent')} tone="info" />
      {body ? <Text variant="body">{body}</Text> : null}
      {toolCalls.length > 0 && (
        <View className="gap-1">
          {toolCalls.map((tc, i) => (
            <View key={i} className="rounded-muffin bg-frosting-50 p-2 dark:bg-[#2E2042]">
              <Text variant="label">calls {tc.name}</Text>
              <JsonBlock value={tc.args} />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/** Render an array of messages, if a state value is message-shaped. */
export function MessageList({ messages }: { messages: AnyMessage[] }) {
  return (
    <View className="gap-2">
      {messages.map((m, i) => (
        <MessageBubble key={i} message={m} />
      ))}
    </View>
  );
}

export function isMessageArray(value: unknown): value is AnyMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'object' && v !== null && ('type' in v || 'role' in v))
  );
}
