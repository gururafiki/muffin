import { View, type ViewProps } from 'react-native';

import { cn } from '@/lib/cn';

type CardProps = ViewProps & {
  /** "raised" adds a soft frosting shadow; "outline" is a flat bordered card. */
  tone?: 'raised' | 'outline' | 'muted';
};

const tones = {
  raised:
    'bg-white dark:bg-[#241834] border border-frosting-100 dark:border-[#3A2B52] shadow-sm shadow-frosting-200/50',
  outline: 'bg-transparent border border-frosting-200 dark:border-[#3A2B52]',
  muted: 'bg-crust dark:bg-[#2E2042] border border-transparent',
} as const;

export function Card({ tone = 'raised', className, ...props }: CardProps) {
  return <View className={cn('rounded-muffin p-4', tones[tone], className)} {...props} />;
}
