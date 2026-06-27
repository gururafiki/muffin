import { ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { cn } from '@/lib/cn';

type ScreenProps = ViewProps & {
  scroll?: boolean;
  edges?: Edge[];
  contentClassName?: string;
};

/**
 * Page wrapper: applies the bakery background, safe-area insets and an optional
 * scroll container with a centered max-width column for wide (web) layouts.
 */
export function Screen({
  scroll = true,
  edges = ['top'],
  className,
  contentClassName,
  children,
  ...props
}: ScreenProps) {
  const inner = (
    <View
      className={cn('mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-2', contentClassName)}
      {...props}>
      {children}
    </View>
  );

  return (
    <SafeAreaView edges={edges} className={cn('flex-1 bg-dough dark:bg-[#1A1126]', className)}>
      {scroll ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}
