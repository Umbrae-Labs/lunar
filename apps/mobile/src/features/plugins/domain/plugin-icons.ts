import type { SymbolViewProps } from 'expo-symbols';
import type { IconName, IconSpec, PluginIcon } from '@umbrae-labs/lunar-plugin-sdk';
import { isPackageIcon } from '@umbrae-labs/lunar-plugin-sdk/manifest';

type SymbolName = SymbolViewProps['name'];

const Icons: Record<IconName, { readonly ios: string; readonly android: string }> = {
  book: { ios: 'book', android: 'menu_book' },
  bookmark: { ios: 'bookmark', android: 'bookmark' },
  chart: { ios: 'chart.bar', android: 'bar_chart' },
  edit: { ios: 'pencil', android: 'edit' },
  extension: { ios: 'puzzlepiece.extension', android: 'extension' },
  headphones: { ios: 'headphones', android: 'headphones' },
  info: { ios: 'info.circle', android: 'info' },
  list: { ios: 'list.bullet', android: 'format_list_bulleted' },
  pause: { ios: 'pause.fill', android: 'pause' },
  play: { ios: 'play.fill', android: 'play_arrow' },
  search: { ios: 'magnifyingglass', android: 'search' },
  settings: { ios: 'gearshape', android: 'settings' },
  sparkles: { ios: 'sparkles', android: 'auto_awesome' },
  star: { ios: 'star', android: 'star' },
  stop: { ios: 'stop.fill', android: 'stop' },
  text: { ios: 'textformat', android: 'text_fields' },
  timer: { ios: 'timer', android: 'timer' },
  translate: { ios: 'translate', android: 'translate' },
};

/**
 * Maps a manifest icon to platform symbols; custom names are passed through unchecked.
 * Packaged images fall back to the generic plugin symbol.
 */
export function pluginSymbolName(icon: IconSpec | PluginIcon | undefined): SymbolName {
  const resolved = pluginSymbols(icon);
  return { ios: resolved.ios, android: resolved.android, web: resolved.android } as SymbolName;
}

/** Platform symbol names for a manifest icon, falling back to the generic plugin symbol. */
export function pluginSymbols(icon: IconSpec | PluginIcon | undefined): {
  readonly ios: string;
  readonly android: string;
} {
  return icon === undefined || isPackageIcon(icon) ? Icons.extension : typeof icon === 'string' ? Icons[icon] : icon;
}
