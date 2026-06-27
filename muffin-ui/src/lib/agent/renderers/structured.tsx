import { View } from 'react-native';

import { Badge, Text, type Signal } from '@/components/ui';
import { isMessageArray, MessageList } from './messages';
import { JsonBlock } from './json-block';

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function signalTone(value: string): Signal | null {
  const v = value.toLowerCase();
  if (/(strong[_ ]?)?buy|bull|positive|outperform/.test(v)) return 'bullish';
  if (/(strong[_ ]?)?sell|bear|negative|underperform/.test(v)) return 'bearish';
  if (/hold|neutral|mixed/.test(v)) return 'neutral';
  return null;
}

/** Render an arbitrary structured-output dict as labelled rows. */
export function StructuredOutput({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return null;

  if (isMessageArray(value)) return <MessageList messages={value} />;

  if (typeof value === 'string') {
    const tone = depth > 0 ? null : signalTone(value);
    return tone ? <Badge label={value} tone={tone} /> : <Text variant="body">{value}</Text>;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <Text variant="body">{String(value)}</Text>;
  }

  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string' || typeof v === 'number')) {
      return (
        <View className="gap-1">
          {value.map((v, i) => (
            <Text key={i} variant="body">
              • {String(v)}
            </Text>
          ))}
        </View>
      );
    }
    if (depth > 1) return <JsonBlock value={value} />;
    return (
      <View className="gap-2">
        {value.map((v, i) => (
          <View key={i} className="border-l-2 border-frosting-200 pl-2 dark:border-[#3A2B52]">
            <StructuredOutput value={v} depth={depth + 1} />
          </View>
        ))}
      </View>
    );
  }

  if (typeof value === 'object') {
    if (depth > 2) return <JsonBlock value={value} />;
    return (
      <View className="gap-2">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <View key={k} className="gap-1">
            <Text variant="label">{humanize(k)}</Text>
            <StructuredOutput value={v} depth={depth + 1} />
          </View>
        ))}
      </View>
    );
  }

  return <JsonBlock value={value} />;
}
