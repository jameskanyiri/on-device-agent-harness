import { Button, Form, Host, LabeledContent, Section, Text } from '@expo/ui/swift-ui';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import {
  CHAT_MODELS,
  deleteModelFile,
  formatBytes,
  modelFileSize,
  type ChatModel,
} from '@/lib/chat-models';
import { conversationsSize } from '@/lib/conversations';
import { useSettings } from '@/lib/settings';

export default function StorageScreen() {
  const { settings } = useSettings();
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [chatsBytes, setChatsBytes] = useState(0);

  const refresh = useCallback(() => {
    Promise.all(CHAT_MODELS.map(async (m) => [m.id, await modelFileSize(m)] as const)).then(
      (entries) => setSizes(Object.fromEntries(entries))
    );
    conversationsSize().then(setChatsBytes);
  }, []);
  useFocusEffect(refresh);

  const totalModels = Object.values(sizes).reduce((a, b) => a + b, 0);
  // The model in use can't be deleted: it's loaded in memory.
  const deletable = CHAT_MODELS.filter((m) => sizes[m.id] && m.id !== settings.modelId);

  const confirmDelete = (model: ChatModel) =>
    Alert.alert(
      `Delete ${model.name}?`,
      `Frees ${formatBytes(sizes[model.id] ?? 0)}. It will download again next time you use it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteModelFile(model).finally(refresh),
        },
      ]
    );

  return (
    <Host style={{ flex: 1 }}>
      <Form>
        <Section
          title="Models"
          footer={<Text>{`${formatBytes(totalModels || 1)} used by downloaded models.`}</Text>}>
          {CHAT_MODELS.map((m) => {
            const bytes = sizes[m.id] ?? 0;
            const inUse = m.id === settings.modelId;
            return (
              <LabeledContent key={m.id} label={m.name}>
                <Text>
                  {bytes ? `${formatBytes(bytes)}${inUse ? ' · In use' : ''}` : 'Not downloaded'}
                </Text>
              </LabeledContent>
            );
          })}
        </Section>

        {deletable.length > 0 && (
          <Section title="Free up space">
            {deletable.map((m) => (
              <Button
                key={m.id}
                role="destructive"
                systemImage="trash"
                label={`Delete ${m.name} (${formatBytes(sizes[m.id] ?? 0)})`}
                onPress={() => confirmDelete(m)}
              />
            ))}
          </Section>
        )}

        <Section title="Chats">
          <LabeledContent label="Saved chats">
            <Text>{formatBytes(chatsBytes || 1)}</Text>
          </LabeledContent>
        </Section>
      </Form>
    </Host>
  );
}
