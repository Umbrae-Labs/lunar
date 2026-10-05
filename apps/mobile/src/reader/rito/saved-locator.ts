import type { ReaderLocator } from '../contracts';
import type { RitoArtifactRequest } from './rito-native';

export function toRitoSavedLocator(locator: ReaderLocator, href: string): RitoArtifactRequest['locator'] {
  const point = locator.sourcePoint ?? locator.sourceRange?.start;
  // Rito rejects a locator containing both a point and a range. Navigation
  // targets the range start; the full range remains in the saved annotation.
  return {
    href,
    anchorId: point ? undefined : locator.anchorId,
    sourcePoint: point ? { nodePath: point.nodePath, textOffset: BigInt(point.textOffset) } : undefined,
    progression: point || locator.anchorId ? undefined : locator.chapterProgress,
  };
}
