import type { PickedEpub } from './epub-picker';

export async function stageExternalEpub(_uri: string): Promise<PickedEpub> {
  throw new Error('External EPUB import is available in the Android and iOS app.');
}

export function takeInitialEpubShares(): readonly string[] {
  return [];
}

export function subscribeToEpubShares(_listener: (uris: readonly string[]) => void): () => void {
  return () => {};
}
