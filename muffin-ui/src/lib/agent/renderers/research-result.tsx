import { Linking, Pressable, View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';
import { JsonBlock } from './json-block';

type ResearchOutput = {
  answer_markdown?: string;
  key_findings?: string[];
  sources?: { n?: number; title?: string; url?: string }[];
  confidence?: number;
  suggested_followups?: string[];
};

/**
 * Tailored renderer for the research agent's ResearchOutput. Renders the answer
 * text (line breaks preserved), key findings, tappable sources and a confidence
 * badge. Full markdown styling (headings/bold) is a tracked follow-up.
 */
export function ResearchResult({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return <JsonBlock value={value} />;
  const out = value as ResearchOutput;

  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-2">
        <Badge label="research" tone="info" />
        {typeof out.confidence === 'number' ? (
          <Text variant="muted">confidence {Math.round(out.confidence * 100)}%</Text>
        ) : null}
      </View>

      {out.answer_markdown ? <Text variant="body">{out.answer_markdown}</Text> : null}

      {out.key_findings && out.key_findings.length > 0 ? (
        <View className="gap-1">
          <Text variant="label">Key findings</Text>
          {out.key_findings.map((f, i) => (
            <Text key={i} variant="body">
              • {f}
            </Text>
          ))}
        </View>
      ) : null}

      {out.sources && out.sources.length > 0 ? (
        <View className="gap-1">
          <Text variant="label">Sources</Text>
          {out.sources.map((s, i) => (
            <Pressable key={i} onPress={() => s.url && Linking.openURL(s.url)} className="active:opacity-70">
              <Text variant="muted" className="text-frosting-500">
                [{s.n ?? i + 1}] {s.title ?? s.url}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {out.suggested_followups && out.suggested_followups.length > 0 ? (
        <View className="gap-1">
          <Text variant="label">Follow-ups</Text>
          {out.suggested_followups.map((f, i) => (
            <Text key={i} variant="muted">
              • {f}
            </Text>
          ))}
        </View>
      ) : null}

      {!out.answer_markdown && !out.key_findings ? <JsonBlock value={value} /> : null}
    </Card>
  );
}
