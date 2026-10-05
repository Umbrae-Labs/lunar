import { useMemo } from 'react';
import type { ReaderHitEntry, ReaderRuntime, ReaderSnapshot } from '@/reader';

const EmptyHitEntries: readonly ReaderHitEntry[] = [];

/** Read mutable runtime data again whenever React adopts a new page snapshot. */
export function useReaderHitEntries(runtime: ReaderRuntime, snapshot: ReaderSnapshot, enabled: boolean) {
  return useMemo(() => {
    if (!enabled || snapshot.phase !== 'ready') return EmptyHitEntries;
    const current = runtime.getSnapshot();
    if (
      current.revisionId !== snapshot.revisionId ||
      current.spreadIndex !== snapshot.spreadIndex ||
      current.renderId !== snapshot.renderId
    )
      return EmptyHitEntries;
    return runtime.getCurrentHitMap(snapshot.spreadIndex)?.entries ?? EmptyHitEntries;
  }, [enabled, runtime, snapshot]);
}
