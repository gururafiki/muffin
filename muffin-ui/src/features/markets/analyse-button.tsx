import { useRouter } from 'expo-router';

import { Button } from '@/components/ui';

/**
 * Launches the real `research` agent with a templated, auto-started query.
 * Used at every drill-down level for the "Analyse" action.
 */
export function AnalyseButton({
  title,
  query,
  variant = 'primary',
}: {
  title: string;
  query: string;
  variant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  return (
    <Button
      title={title}
      variant={variant}
      onPress={() =>
        router.push({ pathname: '/agents/[assistantId]', params: { assistantId: 'research', query, autostart: '1' } })
      }
    />
  );
}
