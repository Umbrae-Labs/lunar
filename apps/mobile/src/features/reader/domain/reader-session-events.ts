import type { ReaderLocator, ReaderSnapshot } from '@/reader';

export interface ReaderSessionChapter {
  readonly href: string;
  readonly title?: string;
}

export interface ReaderSessionLocation {
  readonly locator?: ReaderLocator;
  readonly chapter?: ReaderSessionChapter;
  /** Whole-book progression from 0 to 1. */
  readonly progression: number;
  /** Whole-book page number, absent until whole-book pagination provides it. */
  readonly page?: number;
  readonly totalPages?: number;
}

export type ReaderSessionLifecycle = 'closed' | 'opening' | 'open';

export type ReaderSessionEvent =
  | { readonly type: 'open'; readonly bookId: string }
  | { readonly type: 'ready'; readonly bookId: string; readonly location: ReaderSessionLocation }
  | { readonly type: 'locationChange'; readonly bookId: string; readonly location: ReaderSessionLocation }
  | {
      readonly type: 'chapterChange';
      readonly bookId: string;
      readonly previous?: ReaderSessionChapter;
      readonly chapter?: ReaderSessionChapter;
    }
  | { readonly type: 'layoutChange'; readonly bookId: string; readonly location: ReaderSessionLocation }
  | {
      readonly type: 'paginationChange';
      readonly bookId: string;
      readonly totalPages?: number;
      readonly complete: boolean;
    }
  | { readonly type: 'close'; readonly bookId: string; readonly location?: ReaderSessionLocation };

export type ReaderSessionEventType = ReaderSessionEvent['type'];
export type ReaderSessionEventOf<T extends ReaderSessionEventType> = Extract<ReaderSessionEvent, { type: T }>;

/** What the event derivation remembers between snapshots. */
export interface ReaderSessionObservation {
  readonly bookId: string;
  readonly lifecycle: Exclude<ReaderSessionLifecycle, 'closed'>;
  readonly revisionId: number;
  readonly locationKey?: string;
  readonly chapter?: ReaderSessionChapter;
  readonly totalPages?: number;
  readonly paginationComplete: boolean;
  readonly location?: ReaderSessionLocation;
}

export interface ReaderSessionObservationResult {
  readonly observation?: ReaderSessionObservation;
  readonly events: readonly ReaderSessionEvent[];
}

/**
 * Derives explicit lifecycle events from consecutive runtime snapshots. Phases
 * between `ready` states (`paginating`, `reflowing`) keep the session open and
 * only the adopted `ready` snapshot reports location and layout changes.
 */
export function observeReaderSession(
  previous: ReaderSessionObservation | undefined,
  snapshot: ReaderSnapshot,
): ReaderSessionObservationResult {
  const events: ReaderSessionEvent[] = [];
  let current = previous;

  if (current && (snapshot.bookId !== current.bookId || isClosedPhase(snapshot.phase))) {
    events.push(closeEvent(current));
    current = undefined;
  }
  if (!snapshot.bookId || isClosedPhase(snapshot.phase) || snapshot.phase === 'error') {
    return { observation: current, events };
  }

  const bookId = snapshot.bookId;
  if (!current) {
    events.push({ type: 'open', bookId });
    current = {
      bookId,
      lifecycle: 'opening',
      revisionId: snapshot.revisionId,
      paginationComplete: false,
    };
  }
  if (snapshot.phase !== 'ready') return { observation: current, events };

  const location = createReaderSessionLocation(snapshot);
  const next: ReaderSessionObservation = {
    bookId,
    lifecycle: 'open',
    revisionId: snapshot.revisionId,
    locationKey: readerLocationKey(snapshot),
    chapter: location.chapter,
    totalPages: snapshot.totalSpreads,
    paginationComplete: snapshot.paginationComplete === true,
    location,
  };

  if (current.lifecycle === 'opening') {
    events.push({ type: 'ready', bookId, location });
    return { observation: next, events };
  }

  if (next.revisionId !== current.revisionId) events.push({ type: 'layoutChange', bookId, location });
  if (next.chapter?.href !== current.chapter?.href) {
    events.push({ type: 'chapterChange', bookId, previous: current.chapter, chapter: next.chapter });
  }
  if (next.locationKey !== current.locationKey) events.push({ type: 'locationChange', bookId, location });
  if (next.totalPages !== current.totalPages || next.paginationComplete !== current.paginationComplete) {
    events.push({
      type: 'paginationChange',
      bookId,
      totalPages: next.totalPages,
      complete: next.paginationComplete,
    });
  }
  return { observation: next, events };
}

/** Ends an observation that will receive no further snapshots, such as on unmount. */
export function closeReaderSessionObservation(
  observation: ReaderSessionObservation | undefined,
): ReaderSessionEvent | undefined {
  return observation ? closeEvent(observation) : undefined;
}

export function createReaderSessionLocation(snapshot: ReaderSnapshot): ReaderSessionLocation {
  const locator = snapshot.position?.locator;
  const href = locator?.manifestHref;
  return {
    locator,
    chapter: href ? { href, title: snapshot.chapterTitle } : undefined,
    progression: snapshot.position?.progression ?? 0,
    page: snapshot.bookSpreadIndex,
    totalPages: snapshot.totalSpreads,
  };
}

function readerLocationKey(snapshot: ReaderSnapshot): string | undefined {
  const locator = snapshot.position?.locator;
  if (!locator && snapshot.bookSpreadIndex === undefined) return undefined;
  const point = locator?.sourcePoint;
  return [
    locator?.spineIdref ?? '',
    locator?.chapterProgress ?? '',
    snapshot.bookSpreadIndex ?? snapshot.position?.spreadIndex ?? '',
    // A scrolled reader refines its position within one window.
    point ? `${point.nodePath.join('.')}@${point.textOffset}` : '',
  ].join(':');
}

function closeEvent(observation: ReaderSessionObservation): ReaderSessionEvent {
  return { type: 'close', bookId: observation.bookId, location: observation.location };
}

function isClosedPhase(phase: ReaderSnapshot['phase']): boolean {
  return phase === 'idle' || phase === 'closing';
}
