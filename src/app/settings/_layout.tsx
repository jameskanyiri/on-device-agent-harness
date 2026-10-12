import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export default function SettingsLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.groupedBackground },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.groupedBackground },
      }}>
      <Stack.Screen
        name="index"
        options={{
          title: 'Settings',
          // A bar button: iOS 26+ renders it on Liquid Glass automatically.
          headerRight: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close settings">
              <SymbolView name="xmark" size={18} tintColor={theme.text} weight="semibold" />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen name="personalization" options={{ title: 'Personalization' }} />
      <Stack.Screen name="storage" options={{ title: 'Storage' }} />
      <Stack.Screen name="data-controls" options={{ title: 'Data controls' }} />
      <Stack.Screen name="about" options={{ title: 'About' }} />
    </Stack>
  );
}
