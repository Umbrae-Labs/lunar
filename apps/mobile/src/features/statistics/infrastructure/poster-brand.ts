import { Skia, type SkImage } from '@shopify/react-native-skia';
import { Asset } from 'expo-asset';

let pending: Promise<SkImage> | undefined;
/** Reuse the application's transparent character mark; the renderer supplies its palette. */
export function loadPosterBrand() {
  return (pending ??= (async () => {
    const asset = Asset.fromModule(require('../../../../assets/images/brand-mark.png'));
    await asset.downloadAsync();
    const data = await Skia.Data.fromURI(asset.localUri || asset.uri);
    try {
      const image = Skia.Image.MakeImageFromEncoded(data);
      if (!image) throw Error('Brand image unavailable');
      return image;
    } finally {
      data.dispose();
    }
  })().catch((error) => {
    pending = undefined;
    throw error;
  }));
}
