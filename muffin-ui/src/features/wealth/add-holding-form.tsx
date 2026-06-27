import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Card, Field, Text } from '@/components/ui';
import { ASSETS, assetTypeMeta } from '@/features/markets/taxonomy';
import { useWealth } from './store';

/** Add a holding to an account: pick an asset, enter units + price. */
export function AddHoldingForm({ accountId }: { accountId: string }) {
  const addHolding = useWealth((s) => s.addHolding);
  const [query, setQuery] = useState('');
  const [symbol, setSymbol] = useState('');
  const [units, setUnits] = useState('');
  const [price, setPrice] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q || symbol) return [];
    return ASSETS.filter(
      (a) => a.symbol.includes(q) || a.name.toUpperCase().includes(q),
    ).slice(0, 6);
  }, [query, symbol]);

  const canAdd = symbol && Number(units) > 0 && Number(price) > 0;

  const submit = () => {
    if (!canAdd) return;
    addHolding(accountId, { symbol, units: Number(units), price: Number(price) });
    setQuery('');
    setSymbol('');
    setUnits('');
    setPrice('');
  };

  return (
    <Card className="gap-3">
      <Text variant="heading">Add holding</Text>

      {symbol ? (
        <View className="flex-row items-center justify-between rounded-muffin bg-frosting-50 px-3 py-2 dark:bg-[#2E2042]">
          <Text variant="body">{symbol}</Text>
          <Pressable onPress={() => setSymbol('')}>
            <Text variant="muted" className="text-frosting-500">
              change
            </Text>
          </Pressable>
        </View>
      ) : (
        <Field
          label="Asset"
          placeholder="Search ticker or name (e.g. AAPL)"
          autoCapitalize="characters"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
      )}

      {matches.length > 0 ? (
        <View className="gap-1">
          {matches.map((a) => (
            <Pressable
              key={a.symbol}
              onPress={() => {
                setSymbol(a.symbol);
                setQuery('');
              }}
              className="flex-row items-center gap-2 rounded-muffin px-2 py-2 active:opacity-70">
              <Text>{assetTypeMeta(a.assetType)?.emoji}</Text>
              <Text variant="body" className="flex-1">
                {a.symbol} · {a.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="Units" placeholder="10" keyboardType="numeric" value={units} onChangeText={setUnits} />
        </View>
        <View className="flex-1">
          <Field label="Price" placeholder="100" keyboardType="numeric" value={price} onChangeText={setPrice} />
        </View>
      </View>

      <Button title="Add holding" disabled={!canAdd} onPress={submit} />
    </Card>
  );
}
