import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Field, Screen, Text } from '@/components/ui';
import { useWealth } from '@/features/wealth/store';

export default function GoalScreen() {
  const { goalId } = useLocalSearchParams<{ goalId: string }>();
  const router = useRouter();
  const isNew = goalId === 'new';
  const existing = useWealth((s) => s.goals.find((g) => g.id === goalId));
  const { addGoal, updateGoal, removeGoal } = useWealth();

  const [name, setName] = useState(existing?.name ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? '🎯');
  const [target, setTarget] = useState(existing ? String(existing.targetAmount) : '');
  const [current, setCurrent] = useState(existing ? String(existing.currentAmount) : '0');
  const [date, setDate] = useState(existing?.targetDate ?? '');

  const canSave = name.trim() && Number(target) > 0;

  const save = () => {
    if (!canSave) return;
    const data = {
      name: name.trim(),
      emoji: emoji.trim() || '🎯',
      targetAmount: Number(target),
      currentAmount: Number(current) || 0,
      targetDate: date.trim() || undefined,
    };
    if (isNew) addGoal(data);
    else if (existing) updateGoal(existing.id, data);
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New goal' : 'Edit goal' }} />

      <View className="mt-2 gap-3">
        <View className="flex-row gap-3">
          <View className="w-20">
            <Field label="Emoji" value={emoji} onChangeText={setEmoji} />
          </View>
          <View className="flex-1">
            <Field label="Name" placeholder="House deposit" value={name} onChangeText={setName} />
          </View>
        </View>
        <Field label="Target amount" placeholder="60000" keyboardType="numeric" value={target} onChangeText={setTarget} />
        <Field label="Current amount" placeholder="0" keyboardType="numeric" value={current} onChangeText={setCurrent} />
        <Field
          label="Target date (YYYY-MM-DD)"
          placeholder="2030-01-01"
          autoCapitalize="none"
          value={date}
          onChangeText={setDate}
        />

        <Button title={isNew ? 'Create goal' : 'Save goal'} disabled={!canSave} onPress={save} />
        {!isNew && existing ? (
          <Button
            title="Delete goal"
            variant="secondary"
            onPress={() => {
              removeGoal(existing.id);
              router.back();
            }}
          />
        ) : null}
      </View>
    </Screen>
  );
}
