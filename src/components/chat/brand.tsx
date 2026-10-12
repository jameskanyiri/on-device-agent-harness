import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';

export const APP_NAME = 'On-Device';

/** App name shown in the chat header and the sidebar. */
export function Wordmark() {
  return <ThemedText style={styles.wordmark}>{APP_NAME}</ThemedText>;
}

const styles = StyleSheet.create({
  wordmark: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: 600,
    letterSpacing: -0.5,
  },
});
