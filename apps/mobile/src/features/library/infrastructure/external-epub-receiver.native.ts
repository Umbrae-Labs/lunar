import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { PickedEpub } from './epub-picker';

interface EpubReceiverModule {
  stageEpub(uri: string): Promise<PickedEpub>;
  takeInitialShareUris(): string[];
  takePendingShareUris(): string[];
  addListener(event: 'onShare', listener: () => void): { remove(): void };
}

function receiver(): EpubReceiverModule | null {
  return requireOptionalNativeModule<EpubReceiverModule>('LunarEpubReceiver');
}

export async function stageExternalEpub(uri: string): Promise<PickedEpub> {
  const module = receiver();
  if (!module) {
    throw new Error('Rebuild Lunar to enable external EPUB import.');
  }
  return module.stageEpub(uri);
}

export function takeInitialEpubShares(): readonly string[] {
  return Platform.OS === 'android' ? (receiver()?.takeInitialShareUris() ?? []) : [];
}

export function subscribeToEpubShares(listener: (uris: readonly string[]) => void): () => void {
  if (Platform.OS !== 'android') return () => {};
  const module = receiver();
  if (!module) return () => {};
  const drain = () => {
    const uris = module.takePendingShareUris();
    if (uris.length > 0) listener(uris);
  };
  const subscription = module.addListener('onShare', drain);
  drain();
  return () => subscription.remove();
}
