import { Button, HStack, Host, Image, Menu, Picker, Section, Text } from '@expo/ui/swift-ui';
import { font, foregroundStyle, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CHAT_MODELS, isModelDownloaded } from '@/lib/chat-models';
import { tapLight, tapSelection } from '@/lib/haptics';

type HeaderActionsProps = {
  modelId: string;
  onSelectModel: (id: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  /** Shown only when the current chat has been saved. */
  onDeleteChat?: () => void;
};

const HEIGHT = 44;

/**
 * Top-right glass capsule: New chat, plus a native SwiftUI "⋯" menu (iOS's
 * Liquid Glass pop-up) holding the model picker, Settings and Delete.
 */
export function HeaderActions({
  modelId,
  onSelectModel,
  onNewChat,
  onOpenSettings,
  onDeleteChat,
}: HeaderActionsProps) {
  const theme = useTheme();

  return (
    <GlassSurface interactive style={styles.capsule}>
      <PressableScale
        onPress={() => {
          tapLight();
          onNewChat();
        }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="New chat"
        style={styles.slot}>
        <Icon name="newChat" size={22} color={theme.text} />
      </PressableScale>

      <View style={styles.slot}>
        <Host matchContents>
          <Menu label={<Image systemName="ellipsis" size={18} color={theme.text} />}>
            <ModelPickerSection modelId={modelId} onSelectModel={onSelectModel} />
            <Button label="Settings" systemImage="gearshape" onPress={onOpenSettings} />
            {onDeleteChat && (
              <Button
                label="Delete chat"
                systemImage="trash"
                role="destructive"
                onPress={onDeleteChat}
              />
            )}
          </Menu>
        </Host>
      </View>
    </GlassSurface>
  );
}

/** The model list used in both menus, with "On device" or download size per model. */
function ModelPickerSection({
  modelId,
  onSelectModel,
}: Pick<HeaderActionsProps, 'modelId' | 'onSelectModel'>) {
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});

  // Refresh "On device" labels when the model changes (a download may have finished).
  useEffect(() => {
    Promise.all(CHAT_MODELS.map(async (m) => [m.id, await isModelDownloaded(m)] as const)).then(
      (entries) => setDownloaded(Object.fromEntries(entries))
    );
  }, [modelId]);

  return (
    <Section title="Model · runs on this iPhone">
      <Picker
        selection={modelId}
        onSelectionChange={(id: string) => {
          tapSelection();
          onSelectModel(id);
        }}
        modifiers={[pickerStyle('inline')]}>
        {CHAT_MODELS.map((m) => (
          <Text key={m.id} modifiers={[tag(m.id)]}>
            {`${m.name} · ${downloaded[m.id] ? 'On device' : m.sizeLabel}`}
          </Text>
        ))}
      </Picker>
    </Section>
  );
}

/** Empty-chat header pill ("Gemma 4 ⌄") for choosing the model before the first message. */
export function ModelPill({
  modelId,
  onSelectModel,
}: Pick<HeaderActionsProps, 'modelId' | 'onSelectModel'>) {
  const theme = useTheme();
  const name = CHAT_MODELS.find((m) => m.id === modelId)?.name ?? '';

  return (
    <GlassSurface interactive style={styles.pill}>
      <Host matchContents>
        <Menu
          label={
            <HStack spacing={6}>
              <Text
                modifiers={[font({ size: 16, weight: 'semibold' }), foregroundStyle(theme.text)]}>
                {name}
              </Text>
              <Image systemName="chevron.down" size={11} color={theme.textSecondary} />
            </HStack>
          }>
          <ModelPickerSection modelId={modelId} onSelectModel={onSelectModel} />
        </Menu>
      </Host>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    paddingHorizontal: Spacing.one,
  },
  pill: {
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  slot: {
    width: HEIGHT,
    height: HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
