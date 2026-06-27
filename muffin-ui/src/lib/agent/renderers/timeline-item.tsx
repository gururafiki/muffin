import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import type { TimelineItem } from '../types';
import { isMessageArray, MessageList } from './messages';
import { StructuredOutput } from './structured';

function humanizeNode(node: string): string {
  return node.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Render one streamed node update. Picks the best renderer for the partial
 * state: message-shaped values → bubbles; otherwise a labelled structured view.
 * This is the extension seam — register node-specific cards here later
 * (e.g. a chart card keyed on tool name, or a persona evidence card).
 */
export function TimelineItemCard({ item }: { item: TimelineItem }) {
  const entries = Object.entries(item.data).filter(([, v]) => v !== null && v !== undefined);

  return (
    <Card tone="raised" className="gap-2">
      <Text variant="heading">{humanizeNode(item.node)}</Text>
      {entries.length === 0 ? (
        <Text variant="muted">step completed</Text>
      ) : (
        <View className="gap-3">
          {entries.map(([key, value]) =>
            isMessageArray(value) ? (
              <MessageList key={key} messages={value} />
            ) : (
              <View key={key} className="gap-1">
                <Text variant="label">{key.replace(/_/g, ' ')}</Text>
                <StructuredOutput value={value} depth={1} />
              </View>
            ),
          )}
        </View>
      )}
    </Card>
  );
}
