import { View } from 'react-native';

import { cn } from '@/lib/cn';
import { Text } from './text';

export type Signal = 'bullish' | 'bearish' | 'neutral' | 'info';

const tones: Record<Signal, string> = {
  bullish: 'bg-bullish/15 border-bullish/30',
  bearish: 'bg-bearish/15 border-bearish/30',
  neutral: 'bg-neutral/15 border-neutral/40',
  info: 'bg-frosting-100 dark:bg-[#2E2042] border-frosting-200 dark:border-[#3A2B52]',
};

const textTones: Record<Signal, string> = {
  bullish: 'text-bullish',
  bearish: 'text-bearish',
  neutral: 'text-neutral',
  info: 'text-frosting-600 dark:text-frosting-300',
};

export function Badge({ label, tone = 'info' }: { label: string; tone?: Signal }) {
  return (
    <View className={cn('self-start rounded-full border px-2.5 py-1', tones[tone])}>
      <Text className={cn('text-xs font-bold uppercase tracking-wide', textTones[tone])}>
        {label}
      </Text>
    </View>
  );
}
