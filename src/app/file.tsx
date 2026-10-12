import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';

import { Markdown } from '@/components/chat/markdown';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { readWorkspaceFile } from '@/harness/filesystem';
import { useTheme } from '@/hooks/use-theme';

/**
 * Shows a workspace file to the user: opened by the model's open_file tool, or
 * by tapping a file step under a reply. Markdown is rendered; anything else is
 * shown as monospaced text.
 */
export default function FileScreen() {
  const { path = '/' } = useLocalSearchParams<{ path: string }>();
  const theme = useTheme();
  const [file, setFile] = useState<{ content: string } | { error: string } | null>(null);

  useEffect(() => {
    let live = true;
    readWorkspaceFile(path).then(
      (content) => live && setFile({ content }),
      (e: unknown) => live && setFile({ error: e instanceof Error ? e.message : String(e) })
    );
    return () => {
      live = false;
    };
  }, [path]);

  const name = path.split('/').pop() || path;
  const content = file && 'content' in file ? file.content : null;
  const isMarkdown = /\.(md|markdown)$/i.test(path);

  const headerButton = (icon: 'xmark' | 'square.and.arrow.up', label: string, onPress: () => void) => (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      <SymbolView name={icon} size={18} tintColor={theme.text} weight="semibold" />
    </Pressable>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () => headerButton('xmark', 'Close file', () => router.back()),
          headerLeft: () =>
            content !== null
              ? headerButton('square.and.arrow.up', 'Share file', () =>
                  Share.share({ message: content, title: name }).catch(() => {})
                )
              : null,
        }}
      />
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary" selectable>
          {path}
        </ThemedText>
        {file === null ? null : 'error' in file ? (
          <ThemedText themeColor="textSecondary">{file.error.replace(/^Error: /, '')}</ThemedText>
        ) : !file.content.trim() ? (
          <ThemedText themeColor="textSecondary">This file is empty.</ThemedText>
        ) : isMarkdown ? (
          <Markdown text={file.content} streaming={false} />
        ) : (
          <View style={[styles.codeBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText selectable style={styles.code}>
              {file.content}
            </ThemedText>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
  },
  codeBox: {
    borderRadius: 12,
    padding: Spacing.three,
  },
  code: {
    fontFamily: Fonts?.mono,
    fontSize: 14,
    lineHeight: 20,
  },
});
