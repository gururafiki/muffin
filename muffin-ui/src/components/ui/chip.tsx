import { Pressable } from 'react-native';

import { cn } from '@/lib/cn';
import { Text } from './text';

/** Small selectable pill — used for asset-type / filter selectors. */
export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'rounded-full border px-3 py-1.5 active:opacity-80',
        active
          ? 'border-frosting-500 bg-frosting-500'
          : 'border-frosting-200 bg-transparent dark:border-[#3A2B52]',
      )}>
      <Text
        className={cn(
          'text-sm font-semibold',
          active ? 'text-white' : 'text-frosting-600 dark:text-frosting-300',
        )}>
        {label}
      </Text>
    </Pressable>
  );
}
