import { View } from 'react-native';

import { cn } from '@/lib/cn';
import { Text } from './text';

/** Circular initials avatar — used for investor personas in the council UI. */
export function Avatar({
  name,
  size = 48,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(/[\s_-]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className={cn(
        'items-center justify-center border-2 border-frosting-200 bg-frosting-100 dark:border-[#3A2B52] dark:bg-[#2E2042]',
        className,
      )}>
      <Text className="font-display font-bold text-frosting-600 dark:text-frosting-200">
        {initials}
      </Text>
    </View>
  );
}
