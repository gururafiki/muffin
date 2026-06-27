import { useColorScheme, TextInput, type TextInputProps, View } from 'react-native';

import { cn } from '@/lib/cn';
import { Text } from './text';

type FieldProps = TextInputProps & {
  label?: string;
  hint?: string;
  className?: string;
};

/** Labelled text input styled for the bakery theme. */
export function Field({ label, hint, className, ...props }: FieldProps) {
  const dark = useColorScheme() === 'dark';
  return (
    <View className="gap-1">
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        placeholderTextColor={dark ? '#6E5E86' : '#B6A8CC'}
        className={cn(
          'rounded-muffin border border-frosting-200 bg-white px-3 py-3 text-base text-black',
          'dark:border-[#3A2B52] dark:bg-[#241834] dark:text-frosting-50',
          className,
        )}
        {...props}
      />
      {hint ? <Text variant="muted">{hint}</Text> : null}
    </View>
  );
}
