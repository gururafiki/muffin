import '@/global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@/lib/query';
import { palette } from '@/theme/colors';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShown: false,
              headerTintColor: dark ? palette.frosting[100] : palette.frosting[700],
              headerStyle: { backgroundColor: dark ? '#241834' : palette.white },
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: dark ? '#1A1126' : palette.dough },
            }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="agents/[assistantId]"
              options={{ headerShown: true, title: 'Agent' }}
            />
            <Stack.Screen name="region/[regionId]" options={{ headerShown: true, title: 'Region' }} />
            <Stack.Screen name="country/[countryId]" options={{ headerShown: true, title: 'Country' }} />
            <Stack.Screen name="sector/[sectorId]" options={{ headerShown: true, title: 'Sector' }} />
            <Stack.Screen name="stock/[ticker]" options={{ headerShown: true, title: 'Stock' }} />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
