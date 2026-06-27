import { Link, type Href } from 'expo-router';
import { Fragment } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui';

export interface Crumb {
  label: string;
  href?: Href;
}

/** Globe › Region › Country … trail. The last crumb is the current page. */
export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <View className="flex-row flex-wrap items-center gap-1 pb-1">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <Fragment key={i}>
            {c.href && !last ? (
              <Link href={c.href}>
                <Text variant="muted" className="text-frosting-500">
                  {c.label}
                </Text>
              </Link>
            ) : (
              <Text variant="muted" className={last ? 'text-frosting-700 dark:text-frosting-200' : ''}>
                {c.label}
              </Text>
            )}
            {!last ? <Text variant="muted" className="text-frosting-300">›</Text> : null}
          </Fragment>
        );
      })}
    </View>
  );
}
