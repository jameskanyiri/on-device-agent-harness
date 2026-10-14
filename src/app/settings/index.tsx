import { Form, Host, Label, Picker, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

import { LinkRow } from '@/components/settings/link-row';
import { CHAT_MODELS } from '@/lib/chat-models';
import { tapSelection } from '@/lib/haptics';
import { useSettings, type AppearanceMode } from '@/lib/settings';

const APPEARANCE_OPTIONS: { mode: AppearanceMode; label: string }[] = [
  { mode: 'system', label: 'System' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
];

/** Settings as a native SwiftUI Form: system grouped list, toggles and menu pickers. */
export default function SettingsScreen() {
  const { settings, update } = useSettings();

  return (
    <Host style={{ flex: 1 }}>
      <Form>
        <Section
          footer={<Text>Models run entirely on this iPhone. Your chats never leave it.</Text>}>
          <Label title="Private by design" systemImage="lock.shield" />
        </Section>

        <Section title="Customize">
          <LinkRow title="Personalization" icon="face.smiling" href="/settings/personalization" />
          <Picker
            label="Model"
            systemImage="cpu"
            selection={settings.modelId}
            onSelectionChange={(modelId: string) => {
              tapSelection();
              update({ modelId });
            }}
            modifiers={[pickerStyle('menu')]}>
            {CHAT_MODELS.map((m) => (
              <Text key={m.id} modifiers={[tag(m.id)]}>
                {m.name}
              </Text>
            ))}
          </Picker>
          <Toggle
            label="File tools"
            systemImage="folder"
            isOn={settings.fileTools}
            onIsOnChange={(fileTools) => update({ fileTools })}
          />
          <Toggle
            label="Bash tool"
            systemImage="terminal"
            isOn={settings.bash}
            onIsOnChange={(bash) => update({ bash })}
          />
          <Toggle
            label="Plan with a todo list"
            systemImage="checklist"
            isOn={settings.planning}
            onIsOnChange={(planning) => update({ planning })}
          />
        </Section>

        <Section title="Theme">
          <Picker
            label="Appearance"
            systemImage="sun.max"
            selection={settings.appearance}
            onSelectionChange={(appearance: AppearanceMode) => {
              tapSelection();
              update({ appearance });
            }}
            modifiers={[pickerStyle('menu')]}>
            {APPEARANCE_OPTIONS.map((o) => (
              <Text key={o.mode} modifiers={[tag(o.mode)]}>
                {o.label}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section title="App settings">
          <Toggle
            label="Haptics"
            systemImage="iphone.radiowaves.left.and.right"
            isOn={settings.haptics}
            onIsOnChange={(haptics) => update({ haptics })}
          />
          <LinkRow title="Storage" icon="externaldrive" href="/settings/storage" />
          <LinkRow title="Data controls" icon="hand.raised" href="/settings/data-controls" />
        </Section>

        <Section
          title="Developer"
          footer={<Text>See this phone live on your Mac: memory, CPU, heat, battery and every reply.</Text>}>
          <LinkRow title="Dashboard" icon="gauge.with.dots.needle.67percent" href="/bench" />
        </Section>

        <Section title="Get help">
          <LinkRow title="About" icon="info.circle" href="/settings/about" />
        </Section>
      </Form>
    </Host>
  );
}
