import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chip, Field, Screen, Text } from '@/components/ui';
import { DEFAULT_SETTINGS, useSettings, type LlmProvider } from '@/lib/settings/store';

const PROVIDERS: LlmProvider[] = ['openrouter', 'openai', 'anthropic'];

export default function SettingsScreen() {
  const settings = useSettings();
  const [saved, setSaved] = useState(false);

  const update = (patch: Parameters<typeof settings.setMany>[0]) => {
    settings.setMany(patch);
    setSaved(true);
  };

  return (
    <Screen>
      <Text variant="title" className="pt-4">
        Settings
      </Text>
      <Text variant="muted">Bring your own keys. Stored on this device only.</Text>

      <Card className="mt-4 gap-3">
        <Text variant="heading">Connection</Text>
        <Field
          label="API URL"
          autoCapitalize="none"
          value={settings.apiUrl}
          onChangeText={(v) => update({ apiUrl: v })}
          hint="LangGraph server. Web uses the same-origin /api proxy by default."
        />
        <Field
          label="Auth token (optional)"
          autoCapitalize="none"
          secureTextEntry
          value={settings.authToken}
          onChangeText={(v) => update({ authToken: v })}
          hint="Bearer / Cloudflare Access service token."
        />
        <Field
          label="User ID (optional)"
          autoCapitalize="none"
          value={settings.userId}
          onChangeText={(v) => update({ userId: v })}
          hint="Used for per-user memory isolation."
        />
      </Card>

      <Card className="mt-4 gap-3">
        <Text variant="heading">LLM provider</Text>
        <View className="flex-row flex-wrap gap-2">
          {PROVIDERS.map((p) => (
            <Chip
              key={p}
              label={p}
              active={settings.llmProvider === p}
              onPress={() => update({ llmProvider: p })}
            />
          ))}
        </View>
        <Field
          label="Model (optional)"
          autoCapitalize="none"
          placeholder="openai/gpt-oss-120b"
          value={settings.model}
          onChangeText={(v) => update({ model: v })}
        />
      </Card>

      <Card className="mt-4 gap-3">
        <Text variant="heading">API keys</Text>
        <Field
          label="OpenRouter key"
          autoCapitalize="none"
          secureTextEntry
          value={settings.openrouterApiKey}
          onChangeText={(v) => update({ openrouterApiKey: v })}
        />
        <Field
          label="OpenAI key"
          autoCapitalize="none"
          secureTextEntry
          value={settings.openaiApiKey}
          onChangeText={(v) => update({ openaiApiKey: v })}
        />
        <Field
          label="Anthropic key"
          autoCapitalize="none"
          secureTextEntry
          value={settings.anthropicApiKey}
          onChangeText={(v) => update({ anthropicApiKey: v })}
        />
        <Field
          label="OpenBB token"
          autoCapitalize="none"
          secureTextEntry
          value={settings.openbbApiKey}
          onChangeText={(v) => update({ openbbApiKey: v })}
        />
      </Card>

      <View className="mt-4 flex-row items-center gap-3">
        <Button
          title="Reset to defaults"
          variant="secondary"
          onPress={() => {
            settings.reset();
            settings.setMany(DEFAULT_SETTINGS);
            setSaved(false);
          }}
        />
        {saved ? <Text variant="muted">Saved ✓</Text> : null}
      </View>
    </Screen>
  );
}
