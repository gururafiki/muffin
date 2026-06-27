import { Text as RNText, type TextProps } from 'react-native';

import { cn } from '@/lib/cn';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'muted' | 'label' | 'mono';

const variants: Record<Variant, string> = {
  display: 'font-display text-4xl font-extrabold text-frosting-700 dark:text-frosting-200',
  title: 'font-display text-2xl font-bold text-frosting-700 dark:text-frosting-100',
  heading: 'font-display text-lg font-semibold text-black dark:text-frosting-50',
  body: 'text-base text-black dark:text-frosting-50',
  muted: 'text-sm text-[#6B5E7E] dark:text-[#B9A9D1]',
  label: 'text-xs font-semibold uppercase tracking-wide text-frosting-500 dark:text-frosting-300',
  mono: 'font-mono text-sm text-black dark:text-frosting-50',
};

export type AppTextProps = TextProps & {
  variant?: Variant;
  className?: string;
};

export function Text({ variant = 'body', className, ...props }: AppTextProps) {
  return <RNText className={cn(variants[variant], className)} {...props} />;
}
