import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Card, MuffinLogo, Screen, Text } from '@/components/ui';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { DrillList } from '@/features/markets/drill-list';
import { WorldMap } from '@/features/markets/world-map';
import { analyseGlobalMacro, REGIONS } from '@/features/markets/taxonomy';

export default function HomeScreen() {
  const router = useRouter();
  const goRegion = (id: string) =>
    router.push({ pathname: '/region/[regionId]', params: { regionId: id } });

  return (
    <Screen>
      <View className="items-center gap-2 pt-4">
        <MuffinLogo size={72} />
        <Text variant="display" className="text-center">
          Muffin
        </Text>
        <Text variant="muted" className="text-center">
          Democratise wealth building. Explore the world, then dig in.
        </Text>
      </View>

      <View className="mt-4">
        <WorldMap onSelectRegion={goRegion} />
      </View>

      <View className="mt-4 gap-2">
        <AnalyseButton title="Analyse global macro 🌍" query={analyseGlobalMacro()} />
      </View>

      <Card tone="muted" className="mt-4 gap-1">
        <Text variant="label">Regions</Text>
        <Text variant="muted">Tap a region on the map, or pick one below.</Text>
      </Card>

      <View className="mt-3">
        <DrillList
          items={REGIONS.map((r) => ({
            key: r.id,
            title: r.name,
            subtitle: r.blurb,
            leading: r.emoji,
            changePct: r.changePct,
          }))}
          onSelect={goRegion}
        />
      </View>
    </Screen>
  );
}
