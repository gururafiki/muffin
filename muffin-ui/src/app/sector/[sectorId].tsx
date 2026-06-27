import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Card, Chip, Screen, Text } from '@/components/ui';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { Breadcrumb, type Crumb } from '@/features/markets/breadcrumb';
import { DrillList } from '@/features/markets/drill-list';
import { MoversPanel } from '@/features/markets/movers-panel';
import { analyseSector, getCountry, getRegion, getSector, stocksAsMovers, stocksInSector } from '@/features/markets/taxonomy';

export default function SectorScreen() {
  const params = useLocalSearchParams<{ sectorId: string; countryId?: string }>();
  const router = useRouter();
  const sector = getSector(params.sectorId);
  const country = params.countryId ? getCountry(params.countryId) : undefined;
  const region = country ? getRegion(country.regionId) : undefined;

  const goStock = (ticker: string) =>
    router.push({
      pathname: '/stock/[ticker]',
      params: {
        ticker,
        sector: sector?.id ?? '',
        market: country?.market ?? '',
        country: country?.name ?? '',
      },
    });

  if (!sector) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Unknown sector</Text>
        </Card>
      </Screen>
    );
  }

  const crumbs: Crumb[] = [{ label: 'Globe', href: '/' }];
  if (region) crumbs.push({ label: region.name, href: { pathname: '/region/[regionId]', params: { regionId: region.id } } });
  if (country) crumbs.push({ label: country.name, href: { pathname: '/country/[countryId]', params: { countryId: country.id } } });
  crumbs.push({ label: sector.name });

  const stocks = stocksInSector(sector.id);
  const contextName = country ? `${sector.name} · ${country.name}` : sector.name;

  return (
    <Screen>
      <Stack.Screen options={{ title: sector.name }} />
      <Breadcrumb crumbs={crumbs} />

      <Card className="mt-1 gap-2">
        <Text variant="title">
          {sector.emoji} {sector.name}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {sector.subSectors.map((s) => (
            <Chip key={s} label={s.replace(/-/g, ' ')} />
          ))}
        </View>
      </Card>

      <View className="mt-4">
        <MoversPanel title="Stock performance" items={stocksAsMovers(sector.id)} onSelect={goStock} count={4} />
      </View>

      <View className="mt-4">
        <AnalyseButton title="Analyse sector performance" query={analyseSector(sector.name, country?.name)} />
      </View>

      <Text variant="label" className="mt-5">
        Stocks
      </Text>
      <View className="mt-2">
        <DrillList
          items={stocks.map((s) => ({
            key: s.ticker,
            title: `${s.ticker} · ${s.name}`,
            subtitle: s.country,
            changePct: s.changePct,
          }))}
          onSelect={goStock}
        />
      </View>

      {stocks.length === 0 ? <Text variant="muted" className="mt-2">No representative stocks yet for {contextName}.</Text> : null}
    </Screen>
  );
}
