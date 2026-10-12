import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSettings, type Personalization } from '@/lib/settings';

// Kept short on purpose: the system prompt is prefilled into every chat, and
// small on-device models have small context windows.
const MAX_LENGTH = 300;

const FIELDS: {
  key: keyof Personalization;
  label: string;
  placeholder: string;
  multiline: boolean;
}[] = [
  {
    key: 'name',
    label: 'What should it call you?',
    placeholder: 'Your name',
    multiline: false,
  },
  {
    key: 'about',
    label: 'About you',
    placeholder: 'e.g. Software engineer, learning on-device AI',
    multiline: true,
  },
  {
    key: 'style',
    label: 'How should it respond?',
    placeholder: 'e.g. Short and direct. Use bullet points.',
    multiline: true,
  },
];

export default function PersonalizationScreen() {
  const theme = useTheme();
  const { settings, update } = useSettings();
  const [draft, setDraft] = useState(settings.personalization);

  // Saved when a field loses focus, rather than on every keystroke.
  const save = () => update({ personalization: draft });

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets>
      {FIELDS.map((field) => (
        <View key={field.key} style={styles.field}>
          <ThemedText themeColor="textSecondary" style={styles.label}>
            {field.label}
          </ThemedText>
          <TextInput
            value={draft[field.key]}
            onChangeText={(text) => setDraft((d) => ({ ...d, [field.key]: text }))}
            onBlur={save}
            placeholder={field.placeholder}
            placeholderTextColor={theme.textSecondary}
            multiline={field.multiline}
            maxLength={MAX_LENGTH}
            style={[
              styles.input,
              field.multiline && styles.multiline,
              { color: theme.text, backgroundColor: theme.card },
            ]}
          />
        </View>
      ))}
      <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
        Sent to the model as a short system prompt at the start of each chat. Changes apply to new
        chats and chats you reopen.
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    padding: Spacing.three,
  },
  field: {
    gap: Spacing.two,
  },
  label: {
    fontSize: 15,
    fontWeight: 500,
    paddingHorizontal: Spacing.three,
  },
  input: {
    fontSize: 17,
    paddingHorizontal: Spacing.three + Spacing.one,
    paddingVertical: Spacing.three,
    borderRadius: 20,
    borderCurve: 'continuous',
  },
  multiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  footer: {
    paddingHorizontal: Spacing.three,
  },
});
