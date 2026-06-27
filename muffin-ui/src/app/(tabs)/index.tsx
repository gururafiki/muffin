import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Button, Card, MuffinLogo, Screen, Text } from '@/components/ui';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <Screen>
      <View className="items-center gap-3 pt-6">
        <MuffinLogo size={96} />
        <Text variant="display" className="text-center">
          Muffin
        </Text>
        <Text variant="muted" className="text-center">
          Democratise wealth building. Bring your own keys, share the research.
        </Text>
      </View>

      {/* Globe placeholder — interactive world map lands in M5. */}
      <Card tone="muted" className="mt-6 items-center justify-center py-12">
        <Text style={{ fontSize: 72 }}>🌍</Text>
        <Text variant="heading" className="mt-2">
          Explore the world
        </Text>
        <Text variant="muted" className="text-center">
          Tap regions → countries → sectors → stocks. Coming soon.
        </Text>
      </Card>

      <Card className="mt-4 gap-2">
        <Text variant="label">Your keys stay private</Text>
        <Text variant="body">
          Add your LLM and OpenBB keys in Settings. They are sent with each run and never stored on
          our servers — while the data and research you generate is reused for everyone.
        </Text>
        <Button title="Open Settings" variant="secondary" onPress={() => router.push('/settings')} />
      </Card>

      <Button
        title="Run an agent 🧁"
        className="mt-4"
        onPress={() => router.push('/agents')}
      />
    </Screen>
  );
}
