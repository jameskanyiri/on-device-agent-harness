import { useMemo } from 'react';
import { Linking, useColorScheme } from 'react-native';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';
import remend from 'remend';

import { Colors } from '@/constants/theme';
import { tapLight } from '@/lib/haptics';

type Palette = (typeof Colors)['light' | 'dark'];

const BODY = { fontSize: 17, lineHeight: 25 } as const;

function markdownStyleFor(c: Palette, dark: boolean): MarkdownStyle {
  const codeBackground = dark ? '#1A1B1E' : '#F5F5F7';
  return {
    paragraph: { ...BODY, color: c.text, marginBottom: 12 },
    h1: {
      fontSize: 26,
      lineHeight: 32,
      fontWeight: '700',
      color: c.text,
      marginTop: 8,
      marginBottom: 12,
    },
    h2: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '700',
      color: c.text,
      marginTop: 8,
      marginBottom: 10,
    },
    h3: {
      fontSize: 19,
      lineHeight: 26,
      fontWeight: '600',
      color: c.text,
      marginTop: 6,
      marginBottom: 8,
    },
    h4: { ...BODY, fontWeight: '600', color: c.text, marginBottom: 6 },
    list: {
      ...BODY,
      color: c.text,
      bulletColor: c.textSecondary,
      markerColor: c.textSecondary,
      gapWidth: 8,
      itemSpacing: 6,
      marginBottom: 12,
    },
    strong: { color: c.text },
    link: { color: c.accent, underline: false },
    code: {
      fontSize: 15,
      color: c.text,
      backgroundColor: c.backgroundElement,
      borderColor: c.backgroundSelected,
    },
    codeBlock: {
      fontSize: 14,
      lineHeight: 20,
      color: c.text,
      backgroundColor: codeBackground,
      borderColor: c.backgroundSelected,
      borderWidth: 1,
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
    },
    blockquote: {
      ...BODY,
      color: c.textSecondary,
      borderColor: c.backgroundSelected,
      borderWidth: 3,
      gapWidth: 12,
      marginBottom: 12,
    },
    table: {
      fontSize: 15,
      color: c.text,
      headerTextColor: c.text,
      headerBackgroundColor: c.backgroundSelected,
      rowEvenBackgroundColor: c.background,
      rowOddBackgroundColor: c.backgroundElement,
      borderColor: c.backgroundSelected,
      borderRadius: 12,
      marginBottom: 12,
    },
    thematicBreak: { color: c.backgroundSelected, marginTop: 8, marginBottom: 16 },
  };
}

// Built once per scheme so the native view always gets a stable style object.
const STYLES = {
  light: markdownStyleFor(Colors.light, false),
  dark: markdownStyleFor(Colors.dark, true),
};

const openLink = ({ url }: { url: string }) => {
  Linking.openURL(url).catch(() => {});
};

type MarkdownProps = {
  text: string;
  /** While true, half-written syntax (an unclosed `**`, a dangling list) is repaired first. */
  streaming: boolean;
  /** Native text selection (iOS handles + system Copy / Look Up / Translate / Share). */
  selectable?: boolean;
  /** Adds "Ask On-Device" to the selection menu; receives the selected text. */
  onAsk?: (selectedText: string) => void;
};

/** Assistant reply rendered as native rich text (GitHub-flavored Markdown). */
export function Markdown({ text, streaming, selectable = true, onAsk }: MarkdownProps) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const markdown = useMemo(() => (streaming ? remend(text) : text), [text, streaming]);
  // Shown first in the iOS text-selection menu, before Copy / Look Up / Translate.
  const contextMenuItems = useMemo(
    () =>
      onAsk
        ? [
            {
              text: 'Ask On-Device',
              icon: 'text.bubble',
              onPress: ({ text: t }: { text: string }) => onAsk(t),
            },
          ]
        : undefined,
    [onAsk]
  );

  return (
    <EnrichedMarkdownText
      markdown={markdown}
      flavor="github"
      markdownStyle={STYLES[scheme]}
      streamingAnimation={streaming}
      selectable={selectable}
      selectionColor={STYLES[scheme].link?.color}
      selectionHandleColor={STYLES[scheme].link?.color}
      contextMenuItems={contextMenuItems}
      allowTrailingMargin={false}
      onLinkPress={openLink}
      onCopyPress={tapLight}
    />
  );
}
