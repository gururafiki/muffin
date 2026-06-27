import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Badge, Button, Card, Chip, Screen, Text } from '@/components/ui';
import { DrillList } from '@/features/markets/drill-list';
import { SectorPie } from '@/features/markets/sector-pie';
import {
  ASSET_TYPES,
  assetsByType,
  assetTypeMeta,
  getSector,
  SECTOR_WEIGHTS,
  type AssetType,
} from '@/features/markets/taxonomy';

export default function MarketsScreen() {
  const router = useRouter();
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [assetFilter, setAssetFilter] = useState<AssetType | 'all'>('all');

  const sector = selectedSector ? getSector(selectedSector) : undefined;
  const goSector = (id: string) =>
    router.push({ pathname: '/sector/[sectorId]', params: { sectorId: id } });

  const assets = assetsByType(assetFilter);

  return (
    <Screen>
      <Text variant="title" className="pt-4">
        Markets
      </Text>
      <Text variant="muted">Sector weights and your multi-asset universe.</Text>

      <Card className="mt-4 gap-3">
        <View className="flex-row items-center justify-between">
          <Text variant="heading">Sector breakdown</Text>
          <Badge label="sample" tone="info" />
        </View>
        <SectorPie selectedId={selectedSector} onSelect={setSelectedSector} />

        {sector ? (
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <Text variant="heading">
                {sector.emoji} {sector.name}
              </Text>
              <Text variant="muted">{SECTOR_WEIGHTS[sector.id]}% weight</Text>
            </View>
            <Text variant="label">Sub-sectors</Text>
            <View className="flex-row flex-wrap gap-2">
              {sector.subSectors.map((s) => (
                <Chip key={s} label={s.replace(/-/g, ' ')} onPress={() => goSector(sector.id)} />
              ))}
            </View>
            <Button title={`Open ${sector.name}`} variant="secondary" onPress={() => goSector(sector.id)} />
          </View>
        ) : (
          <Text variant="muted" className="text-center">
            Tap a slice to drill into a sector.
          </Text>
        )}
      </Card>

      <Text variant="label" className="mt-5">
        Asset universe
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2">
        <View className="flex-row gap-2 pr-4">
          <Chip label="All" active={assetFilter === 'all'} onPress={() => setAssetFilter('all')} />
          {ASSET_TYPES.map((t) => (
            <Chip
              key={t.id}
              label={`${t.emoji} ${t.name}`}
              active={assetFilter === t.id}
              onPress={() => setAssetFilter(t.id)}
            />
          ))}
        </View>
      </ScrollView>

      <View className="mt-3">
        <DrillList
          items={assets.map((a) => ({
            key: a.symbol,
            title: `${a.symbol} · ${a.name}`,
            subtitle: [a.sectorId ? getSector(a.sectorId)?.name : assetTypeMeta(a.assetType)?.name, a.country, a.style]
              .filter(Boolean)
              .join(' · '),
            leading: assetTypeMeta(a.assetType)?.emoji,
            changePct: a.changePct,
          }))}
          onSelect={(symbol) => {
            const a = assets.find((x) => x.symbol === symbol);
            router.push({
              pathname: '/stock/[ticker]',
              params: {
                ticker: symbol,
                sector: a?.sectorId ?? '',
                market: a?.market ?? '',
                country: a?.country ?? '',
                assetType: a?.assetType ?? '',
              },
            });
          }}
        />
      </View>
    </Screen>
  );
}
