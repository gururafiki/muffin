import { Tabs } from 'expo-router';
import { useColorScheme, type ColorValue } from 'react-native';

import { Text } from '@/components/ui';
import { palette } from '@/theme/colors';

function TabIcon({ emoji, color }: { emoji: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 22 }}>{emoji}</Text>;
}

export default function TabsLayout() {
  const dark = useColorScheme() === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dark ? palette.frosting[300] : palette.frosting[600],
        tabBarInactiveTintColor: dark ? '#6E5E86' : '#B6A8CC',
        tabBarStyle: {
          backgroundColor: dark ? '#241834' : palette.white,
          borderTopColor: dark ? '#3A2B52' : palette.frosting[100],
        },
        tabBarLabelStyle: { fontWeight: '600', fontSize: 11 },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Globe', tabBarIcon: ({ color }) => <TabIcon emoji="🌍" color={color} /> }}
      />
      <Tabs.Screen
        name="markets"
        options={{ title: 'Markets', tabBarIcon: ({ color }) => <TabIcon emoji="🥧" color={color} /> }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{ title: 'Portfolio', tabBarIcon: ({ color }) => <TabIcon emoji="💰" color={color} /> }}
      />
      <Tabs.Screen
        name="agents"
        options={{ title: 'Agents', tabBarIcon: ({ color }) => <TabIcon emoji="🧁" color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color }) => <TabIcon emoji="⚙️" color={color} /> }}
      />
    </Tabs>
  );
}
