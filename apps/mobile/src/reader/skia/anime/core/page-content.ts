import type { ReaderSnapshot } from '../../../contracts';
import type { LunarReaderRuntime, ReaderPreparedTurn } from '../../../runtime/core/native-reader-runtime';
import type { ReaderPageContent } from './page-turn-types';

type ReaderPageIdentity = Pick<ReaderSnapshot, 'revisionId' | 'spreadIndex' | 'renderId'>;

export function describeSnapshotIdentity(snapshot: ReaderPageIdentity): string {
  return `${snapshot.revisionId}:${snapshot.spreadIndex}:${snapshot.renderId ?? 'none'}`;
}

export function sameSnapshotIdentity(first: ReaderPageIdentity, second: ReaderPageIdentity): boolean {
  return (
    first.revisionId === second.revisionId &&
    first.spreadIndex === second.spreadIndex &&
    first.renderId === second.renderId
  );
}

export function readerPageContentForSnapshot(
  runtime: LunarReaderRuntime,
  snapshot: ReaderSnapshot,
): ReaderPageContent | undefined {
  if (snapshot.phase !== 'ready') return undefined;
  const picture = runtime.getCurrentPicture(snapshot.revisionId, snapshot.spreadIndex, snapshot.renderId);
  const frame = runtime.getCurrentFrame(snapshot.spreadIndex);
  if (!picture || !frame) return undefined;
  return {
    key: describeSnapshotIdentity(snapshot),
    snapshot,
    picture,
    frame,
  };
}

export function describePreparedTarget(preparedTurn: ReaderPreparedTurn): string {
  return `${preparedTurn.revisionId}:${preparedTurn.targetSpreadIndex}:${preparedTurn.targetRenderId}`;
}

export function formatTraceNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : String(value);
}
