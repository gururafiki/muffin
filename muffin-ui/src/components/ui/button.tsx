import { ActivityIndicator, Pressable, type PressableProps, View } from 'react-native';

import { cn } from '@/lib/cn';
import { Text } from './text';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

type ButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  className?: string;
};

const base = 'flex-row items-center justify-center gap-2 rounded-bun active:opacity-80';

const variantBg: Record<Variant, string> = {
  primary: 'bg-frosting-500 dark:bg-frosting-500',
  secondary: 'bg-crust dark:bg-[#2E2042] border border-frosting-200 dark:border-[#3A2B52]',
  ghost: 'bg-transparent',
};

const variantText: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-frosting-700 dark:text-frosting-100',
  ghost: 'text-frosting-600 dark:text-frosting-300',
};

const sizePad: Record<Size, string> = {
  sm: 'px-3 py-2',
  md: 'px-5 py-3',
  lg: 'px-6 py-4',
};

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  leftIcon,
  className,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      className={cn(base, variantBg[variant], sizePad[size], isDisabled && 'opacity-50', className)}
      {...props}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : '#7C4DE0'} size="small" />
      ) : (
        <>
          {leftIcon ? <View>{leftIcon}</View> : null}
          <Text className={cn('text-base font-semibold', variantText[variant])}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}
