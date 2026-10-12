import { Button, HStack, Image, Label, Spacer } from '@expo/ui/swift-ui';
import { foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { router, type Href } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';

/** A Form row that pushes another settings page, with the system chevron. */
export function LinkRow({ title, icon, href }: { title: string; icon: SFSymbol; href: Href }) {
  return (
    <Button onPress={() => router.push(href)}>
      <HStack>
        <Label title={title} systemImage={icon} />
        <Spacer />
        <Image
          systemName="chevron.right"
          size={13}
          modifiers={[foregroundStyle({ type: 'hierarchical', style: 'tertiary' })]}
        />
      </HStack>
    </Button>
  );
}
