import { SymbolView, type SFSymbol, type SymbolWeight } from 'expo-symbols';
import { memo } from 'react';
import type { ColorValue } from 'react-native';

/** The app's icons, by role, mapped to Apple SF Symbols. */
const SYMBOLS = {
  menu: 'line.3.horizontal',
  search: 'magnifyingglass',
  close: 'xmark',
  settings: 'gearshape',
  newChat: 'square.and.pencil',
  send: 'arrow.up',
  stop: 'stop.fill',
  mic: 'mic',
  scrollDown: 'arrow.down',
  pin: 'pin',
  pinned: 'pin.fill',
  unpin: 'pin.slash',
  rename: 'pencil',
  trash: 'trash',
  speaker: 'speaker.wave.2',
  warning: 'exclamationmark.triangle',
  sparkles: 'sparkles',
  lightBulb: 'lightbulb',
  calendar: 'calendar',
  write: 'pencil.line',
  chevronDown: 'chevron.down',
  download: 'arrow.down.circle',
  plus: 'plus',
  more: 'ellipsis',
  check: 'checkmark',
  copy: 'doc.on.doc',
  share: 'square.and.arrow.up',
  regenerate: 'arrow.clockwise',
  folder: 'folder',
  checklist: 'checklist',
  stepDone: 'checkmark.circle.fill',
  stepOpen: 'circle',
} as const satisfies Record<string, SFSymbol>;

export type IconName = keyof typeof SYMBOLS;

type IconProps = {
  name: IconName;
  size?: number;
  color: ColorValue;
  weight?: SymbolWeight;
};

/** A native SF Symbol for one of the app's icon roles. */
export const Icon = memo(function Icon({ name, size = 24, color, weight = 'regular' }: IconProps) {
  return (
    <SymbolView
      name={SYMBOLS[name]}
      size={size}
      tintColor={color as string}
      weight={weight}
      style={{ width: size, height: size }}
    />
  );
});
