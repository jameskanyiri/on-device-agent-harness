import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ConversationsProvider } from '@/lib/conversations';
import { SettingsProvider } from '@/lib/settings';
import { VoiceProvider } from '@/lib/voice';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SettingsProvider>
        <ConversationsProvider>
          <VoiceProvider>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                {/* Native iOS sheet that can be swiped down to dismiss. */}
                <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
                {/* A workspace file, shown by the model's open_file tool. */}
                <Stack.Screen name="file" options={{ presentation: 'modal', headerShown: true }} />
                {/* Runs jobs from the Mac dashboard (on-device/dashboard). */}
                <Stack.Screen name="bench" options={{ presentation: 'modal', headerShown: true }} />
              </Stack>
            </ThemeProvider>
          </VoiceProvider>
        </ConversationsProvider>
      </SettingsProvider>
    </GestureHandlerRootView>
  );
}
