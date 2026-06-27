import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Badge, Card, Screen, Text } from '@/components/ui';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { Breadcrumb } from '@/features/markets/breadcrumb';
import { DrillList } from '@/features/markets/drill-list';
import { MoversPanel } from '@/features/markets/movers-panel';
import { analyseCountry, getCountry, getRegion, SECTORS, sectorsAsMovers } from '@/features/markets/taxonomy';

export default function CountryScreen() {
  const { countryId } = useLocalSearchParams<{ countryId: string }>();
  const router = useRouter();
  const country = getCountry(countryId);
  const region = country ? getRegion(country.regionId) : undefined;

  const goSector = (id: string) =>
    router.push({ pathname: '/sector/[sectorId]', params: { sectorId: id, countryId: country?.id ?? '' } });

  if (!country) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Unknown country</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: country.name }} />
      <Breadcrumb
        crumbs={[
          { label: 'Globe', href: '/' },
          ...(region ? [{ label: region.name, href: { pathname: '/region/[regionId]' as const, params: { regionId: region.id } } }] : []),
          { label: country.name },
        ]}
      />

      <Card className="mt-1 gap-2">
        <Text variant="title">
          {country.flag} {country.name}
        </Text>
        <Badge label={country.market === 'developed' ? 'Developed market' : 'Emerging market'} tone="info" />
      </Card>

      <View className="mt-4">
        <MoversPanel title="Sector performance" items={sectorsAsMovers()} onSelect={goSector} />
      </View>

      <View className="mt-4">
        <AnalyseButton title={`Analyse ${country.name} economy`} query={analyseCountry(country.name)} />
      </View>

      <Text variant="label" className="mt-5">
        Sectors
      </Text>
      <View className="mt-2">
        <DrillList
          items={SECTORS.map((s) => ({
            key: s.id,
            title: s.name,
            subtitle: `${s.subSectors.length} sub-sectors`,
            leading: s.emoji,
            changePct: s.changePct,
          }))}
          onSelect={goSector}
        />
      </View>
    </Screen>
  );
}
