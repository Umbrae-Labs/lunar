import { Image as ExpoImage } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useThemeColor } from 'heroui-native/hooks';
import { View } from 'react-native';
import { withUniwind } from 'uniwind';
import { isPackageIcon } from '@umbrae-labs/lunar-plugin-sdk/manifest';

import type { InstalledPlugin } from '../domain/installed-plugin';
import { pluginSymbolName } from '../domain/plugin-icons';
import { pluginFileUri } from '../infrastructure/expo-plugin-files';

const Image = withUniwind(ExpoImage);

const Sizes = {
  md: { tile: 'size-14 rounded-2xl', symbol: 26 },
  lg: { tile: 'size-20 rounded-3xl', symbol: 36 },
} as const;

interface PluginIconProps {
  readonly plugin: InstalledPlugin;
  readonly size: keyof typeof Sizes;
}

/** The plugin's packaged image, or its host symbol on a neutral tile. */
export function PluginIcon({ plugin, size }: PluginIconProps) {
  const foreground = useThemeColor('foreground');
  const icon = plugin.manifest.icon;
  const { tile, symbol } = Sizes[size];
  // Development builds keep files in memory, so only installed packages can show images.
  const imageUri = isPackageIcon(icon) && plugin.directoryUri ? pluginFileUri(plugin.directoryUri, icon) : undefined;

  return (
    <View className={`${tile} items-center justify-center overflow-hidden border border-border bg-surface`}>
      {imageUri ? (
        <Image className="absolute inset-0 h-full w-full" contentFit="cover" source={{ uri: imageUri }} />
      ) : (
        <SymbolView name={pluginSymbolName(icon)} size={symbol} tintColor={foreground} />
      )}
    </View>
  );
}
