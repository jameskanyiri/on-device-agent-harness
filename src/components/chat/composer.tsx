import { Image } from 'expo-image';
import type { RefObject } from 'react';
import { Button, Host, Image as SwiftImage, Menu } from '@expo/ui/swift-ui';
import { contentShape, frame, shapes } from '@expo/ui/swift-ui/modifiers';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import Animated from 'react-native-reanimated';

import { ContextRing, type ContextUsage } from '@/components/chat/context-ring';
import { GlassSurface } from '@/components/ui/glass';
import { Icon, type IconName } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Motion } from '@/constants/motion';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapLight } from '@/lib/haptics';
import type { PhotoSource } from '@/lib/photos';

type ComposerProps = {
  /** Lets the chat focus the input (e.g. after "Ask On-Device" quotes a selection). */
  inputRef?: RefObject<TextInput | null>;
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop?: () => void;
  isGenerating: boolean;
  isReady: boolean;
  /** Doubles as model status, e.g. "Ask Gemma 4" or "Loading Gemma 4…". */
  placeholder: string;
  /** Photo waiting to be sent with the next message. */
  attachmentUri?: string;
  onAttach: (source: PhotoSource) => void;
  onRemoveAttachment: () => void;
  isListening: boolean;
  onToggleMic: () => void;
  /** Model context usage; the ring shows once known. */
  contextUsage?: ContextUsage | null;
};

const BUTTON_SIZE = 36;

/** A glass capsule: + (photo), input, mic, and a round send/stop button. */
export function Composer({
  inputRef,
  value,
  onChangeText,
  onSend,
  onStop,
  isGenerating,
  isReady,
  placeholder,
  attachmentUri,
  onAttach,
  onRemoveAttachment,
  isListening,
  onToggleMic,
  contextUsage,
}: ComposerProps) {
  const theme = useTheme();
  const hasContent = value.trim().length > 0 || !!attachmentUri;
  const canSend = isReady && !isGenerating && !isListening && hasContent;
  const sendActive = isGenerating || canSend;

  return (
    <GlassSurface style={styles.capsule}>
      {attachmentUri && (
        <Animated.View entering={Motion.enter()} exiting={Motion.exit()} style={styles.attachment}>
          <Image source={{ uri: attachmentUri }} style={styles.thumbnail} contentFit="cover" />
          <Pressable
            onPress={onRemoveAttachment}
            hitSlop={8}
            accessibilityLabel="Remove photo"
            style={[styles.removeAttachment, { backgroundColor: theme.text }]}>
            <Icon name="close" size={10} color={theme.background} weight="bold" />
          </Pressable>
        </Animated.View>
      )}

      <Animated.View layout={Motion.layout()} style={styles.row}>
        {/* Native Liquid Glass pop-up. The SwiftUI label and the host are pinned to
            the same 36×36 box as the other buttons, so it sits on the same line. */}
        <Host style={styles.button}>
          <Menu
            label={
              <SwiftImage
                systemName="plus"
                size={19}
                color={theme.text}
                modifiers={[
                  frame({ width: BUTTON_SIZE, height: BUTTON_SIZE }),
                  contentShape(shapes.rectangle()),
                ]}
              />
            }>
            <Button label="Take Photo" systemImage="camera" onPress={() => onAttach('camera')} />
            <Button
              label="Photo Library"
              systemImage="photo.on.rectangle"
              onPress={() => onAttach('library')}
            />
          </Menu>
        </Host>

        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={isListening ? 'Listening…' : placeholder}
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text }]}
          multiline
        />

        {contextUsage && !isListening && <ContextRing {...contextUsage} />}
        {!isGenerating && (
          <RoundButton
            icon={isListening ? 'stop' : 'mic'}
            label={isListening ? 'Stop dictation' : 'Dictate'}
            onPress={onToggleMic}
            background={isListening ? theme.destructive : 'transparent'}
            tint={isListening ? '#ffffff' : theme.text}
          />
        )}
        <RoundButton
          icon={isGenerating ? 'stop' : 'send'}
          label={isGenerating ? 'Stop generating' : 'Send'}
          onPress={isGenerating ? onStop : onSend}
          disabled={!sendActive}
          background={sendActive ? theme.accent : theme.backgroundSelected}
          tint={sendActive ? '#ffffff' : theme.textSecondary}
        />
      </Animated.View>
    </GlassSurface>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  disabled,
  background,
  tint,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  background: string;
  tint: string;
}) {
  return (
    <PressableScale
      onPress={() => {
        tapLight();
        onPress?.();
      }}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.button, { backgroundColor: background }]}>
      {/* Keyed by icon so swapping (send ⇄ stop, mic ⇄ stop) cross-fades. */}
      <Animated.View key={icon} entering={Motion.swapIn()} exiting={Motion.swapOut()}>
        <Icon name={icon} size={icon === 'stop' ? 13 : 17} color={tint} weight="bold" />
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  capsule: {
    gap: Spacing.two,
    minHeight: 52,
    borderRadius: 26,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.one,
  },
  input: {
    flex: 1,
    maxHeight: 140,
    paddingTop: 7,
    paddingBottom: 7,
    paddingHorizontal: Spacing.one,
    fontSize: 17,
    lineHeight: 22,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachment: {
    alignSelf: 'flex-start',
    marginLeft: Spacing.two,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 14,
  },
  removeAttachment: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
