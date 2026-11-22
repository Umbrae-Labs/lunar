import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { findLibraryBookById, type LibraryBookRecord } from '@/features/library';
import {
  createReaderTypographyKey,
  type ReaderContentInsets,
  type ReaderSnapshot,
  type ReaderOpenResult,
  type ReaderTheme,
  type ReaderRenderPalette,
  type ReaderViewport,
} from '@/reader';
import {
  LunarReaderRuntime,
  RitoNativePaginationBackend,
  readerPerformanceActivity,
  readerPerformanceStart,
} from '@/reader/native';
import { useFontStore, useReaderStore } from '@/stores';
import { i18n } from '@/i18n';
import { readReaderBook } from '../../infrastructure/expo-reader-book-loader';
import { readStoredFontBytes } from '../../infrastructure/expo-reader-font-storage';
import {
  repairDanglingReaderFonts,
  resolveReaderFontFace,
  resolveReaderFontFaces,
} from '../../domain/reader-font-face';
import type { ReaderReadingState } from '../../domain/reader-reading-state';
import {
  closeReaderSessionObservation,
  observeReaderSession,
  type ReaderSessionLifecycle,
  type ReaderSessionObservation,
} from '../../domain/reader-session-events';
import { ReaderSessionEventBus } from '../../services/reader-session-event-bus';
import { findReaderReadingState, saveReaderReadingState } from '../../services/reading-state-service';

/**
 * Turning pages republishes the position on every page. Saving each one
 * queues a SQLite write per turn on the JS thread, so writes are coalesced:
 * the latest position is saved at most this often, and at once when the
 * session closes or the app leaves the foreground.
 */
const READING_STATE_SAVE_INTERVAL_MS = 800;

export interface ReaderSessionOptions {
  readonly bookId: string;
  readonly viewport?: ReaderViewport;
  readonly contentInsets?: ReaderContentInsets;
  readonly theme: ReaderTheme;
  readonly palette: ReaderRenderPalette;
}

export function useReaderSession({ bookId, viewport, contentInsets, theme, palette }: ReaderSessionOptions) {
  const storedTypography = useReaderStore((state) => state.typography);
  const readingMode = useReaderStore((state) => state.readingMode);
  // Scrolling is a layout of its own: Rito lays each chapter out as a strip of
  // windows. The stored typography keeps the paged spread mode to return to.
  const typography = useMemo(
    () => (readingMode === 'scroll' ? { ...storedTypography, spreadMode: 'scrolled' as const } : storedTypography),
    [readingMode, storedTypography],
  );
  const chromeFont = typography.fonts.chrome;
  const fonts = useFontStore((state) => state.fonts);
  const runtime = useMemo(() => createReaderRuntime(), []);
  const [book, setBook] = useState<LibraryBookRecord>();
  const [openResult, setOpenResult] = useState<{
    bookId: string;
    result: ReaderOpenResult;
  }>();
  const [readingState, setReadingState] = useState<{
    bookId: string;
    state?: ReaderReadingState;
  }>();
  const [bookError, setBookError] = useState<{ bookId: string; message: string }>();
  const [layoutError, setLayoutError] = useState<{ bookId: string; message: string }>();
  const activeBookId = useRef<string | undefined>(undefined);
  const layoutKey = useRef<string | undefined>(undefined);
  const layoutQueue = useRef(Promise.resolve());
  const sessionMounted = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const pendingReadingState = useRef<ReaderReadingState | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime]);
  const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const events = useMemo(() => new ReaderSessionEventBus(), []);
  const observation = useRef<ReaderSessionObservation | undefined>(undefined);
  const [lifecycle, setLifecycle] = useState<ReaderSessionLifecycle>('closed');
  const currentBook = book?.id === bookId ? book : undefined;
  const currentOpenResult = openResult?.bookId === bookId ? openResult.result : undefined;
  const flushReadingState = useCallback(() => {
    if (saveTimer.current !== undefined) {
      clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
    }
    const state = pendingReadingState.current;
    if (!state) return;
    pendingReadingState.current = undefined;
    const queuedAt = readerPerformanceStart();
    saveQueue.current = saveQueue.current
      .then(async () => {
        if (queuedAt !== undefined) readerPerformanceActivity('reading-state.queue', performance.now() - queuedAt);
        const startedAt = readerPerformanceStart();
        try {
          await saveReaderReadingState(state);
        } finally {
          if (startedAt !== undefined) readerPerformanceActivity('reading-state.save', performance.now() - startedAt);
        }
      })
      .catch(() => undefined);
  }, []);
  const persistSnapshot = useCallback(
    (currentSnapshot: ReaderSnapshot) => {
      if (
        !currentBook ||
        currentSnapshot.bookId !== currentBook.id ||
        currentSnapshot.phase !== 'ready' ||
        !currentSnapshot.position
      ) {
        return;
      }
      const state: ReaderReadingState = {
        bookId: currentBook.id,
        position: currentSnapshot.position,
        totalSpreads: currentSnapshot.totalSpreads,
        typography: storedTypography,
        theme,
        updatedAt: Date.now(),
      };
      // Another book's pending position is written before this one replaces it.
      if (pendingReadingState.current && pendingReadingState.current.bookId !== state.bookId) flushReadingState();
      pendingReadingState.current = state;
      saveTimer.current ??= setTimeout(flushReadingState, READING_STATE_SAVE_INTERVAL_MS);
    },
    [currentBook, flushReadingState, storedTypography, theme],
  );

  useEffect(() => {
    let active = true;
    findReaderReadingState(bookId)
      .then((state) => {
        if (active) {
          setReadingState({ bookId, state });
        }
      })
      .catch(() => {
        if (active) {
          setReadingState({ bookId });
        }
      });
    findLibraryBookById(bookId)
      .then((record) => {
        if (!active) {
          return;
        }
        if (record) {
          setBook(record);
        } else {
          setBookError({ bookId, message: i18n.t('reader.bookMissing') });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setBookError({
            bookId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [bookId]);

  useEffect(() => {
    if (!currentBook || readingState?.bookId !== bookId || !viewport || viewport.width < 1 || viewport.height < 1) {
      return;
    }
    const nextLayoutKey = [
      currentBook.id,
      viewport.width,
      viewport.height,
      viewport.pixelRatio,
      contentInsets?.top ?? 0,
      contentInsets?.right ?? 0,
      contentInsets?.bottom ?? 0,
      contentInsets?.left ?? 0,
      theme,
      palette.backgroundColor,
      palette.foregroundColor,
      palette.spreadBodyBackgroundColor,
      createReaderTypographyKey(typography),
    ].join(':');
    // Opening/reflowing releases native resources. Serialize those operations
    // so a newer font choice cannot dispose a session that is still opening.
    // Compare against the completed layout inside the queue: a user can switch
    // A -> B -> A while B is in flight, even though A is still the stored key.
    let cancelled = false;
    layoutQueue.current = layoutQueue.current
      .then(async () => {
        if (cancelled || layoutKey.current === nextLayoutKey) {
          return;
        }
        const fontFaces = await resolveReaderFontFaces(typography, fonts, readStoredFontBytes).catch(() => undefined);
        if (cancelled) {
          return;
        }
        const layout = {
          viewport,
          contentInsets,
          typography,
          theme,
          palette,
          fontFaces,
        };
        // Record a key only after success. Cancelling font resolution must not
        // make an unapplied layout look complete to the next effect.
        layoutKey.current = undefined;
        if (activeBookId.current === currentBook.id) {
          await runtime.updateLayout(layout);
        } else {
          const result = await runtime.open({
            bookId: currentBook.id,
            fileUri: currentBook.fileUri,
            ...layout,
            restorePosition: readingState.state?.position,
          });
          activeBookId.current = currentBook.id;
          if (sessionMounted.current) {
            setOpenResult({ bookId: currentBook.id, result });
          }
        }
        layoutKey.current = nextLayoutKey;
        if (sessionMounted.current) {
          setLayoutError(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && sessionMounted.current) {
          setLayoutError({
            bookId: currentBook.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, contentInsets, currentBook, fonts, readingState, runtime, theme, palette, typography, viewport]);

  // Repoints any choice whose font is no longer in the catalog. Deleting a font
  // already repairs the references, so this only catches state that predates the
  // file going missing.
  useEffect(() => {
    const repaired = repairDanglingReaderFonts(storedTypography, fonts);
    if (repaired) {
      useReaderStore.getState().setTypography(repaired);
    }
  }, [fonts, storedTypography]);

  // Chrome is drawn by this app rather than laid out by Rito, so it travels on
  // its own channel: this must never reach `updateLayout`, which re-reads the
  // book and re-paginates every chapter.
  useEffect(() => {
    let cancelled = false;
    void resolveReaderFontFace(chromeFont, fonts, readStoredFontBytes)
      .catch(() => undefined)
      .then((face) => {
        if (!cancelled) {
          runtime.setChromeFontFace(face);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chromeFont, fonts, runtime]);

  // Reads the latest preferences without making preference changes tear down
  // the runtime or resubscribe listeners. Only the runtime's lifetime owns close().
  const persistCurrentSnapshot = useEffectEvent(() => {
    persistSnapshot(runtime.getSnapshot());
  });

  useEffect(() => {
    const unsubscribe = events.onAny((event) => {
      if (
        event.type === 'ready' ||
        event.type === 'locationChange' ||
        event.type === 'layoutChange' ||
        event.type === 'paginationChange'
      ) {
        persistCurrentSnapshot();
      }
    });
    return unsubscribe;
  }, [events]);

  // Lifecycle events are derived after React adopts a snapshot, so listeners
  // never run inside page-turn gestures or the runtime's own dispatch. The
  // persistence listener above subscribes first and sees every event.
  useEffect(() => {
    const result = observeReaderSession(observation.current, snapshot);
    observation.current = result.observation;
    setLifecycle(result.observation?.lifecycle ?? 'closed');
    for (const event of result.events) events.emit(event);
  }, [events, snapshot]);

  // A preference change rewrites the saved typography and theme for the
  // current position before the resulting reflow reports its own layout event.
  useEffect(() => {
    persistCurrentSnapshot();
  }, [persistSnapshot]);

  // The process may be killed in the background before a coalesced save runs.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushReadingState();
    });
    return () => subscription.remove();
  }, [flushReadingState]);

  useEffect(() => {
    sessionMounted.current = true;
    return () => {
      sessionMounted.current = false;
      persistCurrentSnapshot();
      flushReadingState();
      const closing = closeReaderSessionObservation(observation.current);
      observation.current = undefined;
      if (closing) events.emit(closing);
      layoutQueue.current = layoutQueue.current
        .then(async () => {
          await runtime.close();
          activeBookId.current = undefined;
          layoutKey.current = undefined;
        })
        .catch(() => undefined);
    };
  }, [events, flushReadingState, runtime]);

  return {
    runtime,
    snapshot,
    events,
    lifecycle,
    book: currentBook,
    metadata: currentOpenResult?.metadata,
    toc: currentOpenResult?.toc ?? [],
    errorMessage:
      (bookError?.bookId === bookId ? bookError.message : undefined) ??
      (layoutError?.bookId === bookId ? layoutError.message : undefined) ??
      snapshot.errorMessage,
  };
}

function createReaderRuntime(): LunarReaderRuntime {
  return new LunarReaderRuntime((request) => readReaderBook(request.fileUri), new RitoNativePaginationBackend());
}
