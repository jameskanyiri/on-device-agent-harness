import { Button, Form, Host, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { Alert } from 'react-native';

import { useConversations } from '@/lib/conversations';
import { useSettings } from '@/lib/settings';

export default function DataControlsScreen() {
  const { settings, update } = useSettings();
  const { conversations, clearAll } = useConversations();

  const confirmDeleteAll = () =>
    Alert.alert('Delete all chats?', `${conversations.length} chats will be permanently deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete all', style: 'destructive', onPress: clearAll },
    ]);

  return (
    <Host style={{ flex: 1 }}>
      <Form>
        <Section
          title="Privacy"
          footer={
            <Text>
              When on, the app tells Software Mansion (makers of the on-device AI library) which
              model was downloaded, plus your country and platform. Your chats are never sent
              anywhere.
            </Text>
          }>
          <Toggle
            label="Share download stats"
            systemImage="chart.bar"
            isOn={settings.downloadStats}
            onIsOnChange={(downloadStats) => update({ downloadStats })}
          />
        </Section>

        <Section title="Chats" footer={<Text>Chats are stored only on this iPhone.</Text>}>
          {conversations.length > 0 ? (
            <Button
              role="destructive"
              systemImage="trash"
              label="Delete all chats"
              onPress={confirmDeleteAll}
            />
          ) : (
            <Text>No saved chats</Text>
          )}
        </Section>
      </Form>
    </Host>
  );
}
