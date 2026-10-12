import { Form, Host, LabeledContent, Link, Section, Text } from '@expo/ui/swift-ui';

import { APP_NAME } from '@/components/chat/brand';
import { CHAT_MODELS } from '@/lib/chat-models';

export default function AboutScreen() {
  return (
    <Host style={{ flex: 1 }}>
      <Form>
        <Section>
          <Text>
            {`${APP_NAME} runs open language models directly on your iPhone with React Native ExecuTorch. After a model downloads once, chats work offline and stay on the device.`}
          </Text>
        </Section>

        <Section title="Models">
          {CHAT_MODELS.map((m) => (
            <LabeledContent key={m.id} label={m.name}>
              <Text>{m.description.split(' · ')[0]!}</Text>
            </LabeledContent>
          ))}
        </Section>

        <Section title="Built with">
          <Link
            label="React Native ExecuTorch"
            destination="https://docs.swmansion.com/react-native-executorch/"
          />
          <Link
            label="Enriched Markdown"
            destination="https://github.com/software-mansion/enriched-markdown"
          />
          <Link label="Expo" destination="https://expo.dev" />
        </Section>
      </Form>
    </Host>
  );
}
