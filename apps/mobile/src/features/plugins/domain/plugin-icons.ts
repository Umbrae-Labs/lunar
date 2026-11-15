import type { IconName, IconSpec, PluginIcon } from '@umbrae-labs/lunar-plugin-sdk';
import { isPackageIcon } from '@umbrae-labs/lunar-plugin-sdk/manifest';

import type { IconSource, IconName as AppIconName } from '@/components/ui/icon';

const Icons: Record<IconName, AppIconName> = {
  book: 'book',
  bookmark: 'bookmark',
  chart: 'chart',
  edit: 'pencil',
  extension: 'extension',
  headphones: 'headphones',
  info: 'info',
  list: 'list',
  pause: 'pause',
  play: 'play',
  search: 'search',
  settings: 'settings',
  sparkles: 'sparkles',
  star: 'star',
  stop: 'stop',
  text: 'text',
  timer: 'timer',
  translate: 'translate',
};

/** Material Symbols names that custom icon specs commonly use, drawn from the host icon set instead. */
const MaterialAliases: Readonly<Record<string, AppIconName>> = {
  add: 'plus',
  arrow_back: 'back',
  arrow_downward: 'download',
  bookmark: 'bookmark',
  check: 'check',
  close: 'close',
  content_copy: 'copy',
  delete: 'delete',
  download: 'download',
  edit: 'pencil',
  file_download: 'download',
  info: 'info',
  more_vert: 'more',
  remove: 'minus',
  search: 'search',
  settings: 'settings',
  share: 'share',
  translate: 'translate',
};

/**
 * Maps a manifest icon to a host icon. Named icons and common Material Symbols names use the
 * host icon set; other custom platform symbol names are passed through unchecked. Packaged
 * images fall back to the generic plugin icon.
 */
export function pluginIconSource(icon: IconSpec | PluginIcon | undefined): IconSource {
  if (icon === undefined || isPackageIcon(icon)) return Icons.extension;
  if (typeof icon === 'string') return Icons[icon];
  return Object.hasOwn(MaterialAliases, icon.android)
    ? MaterialAliases[icon.android]
    : { ios: icon.ios, android: icon.android };
}
