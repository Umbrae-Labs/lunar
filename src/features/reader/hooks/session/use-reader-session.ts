import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';

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
import { findReaderReadingState, saveReaderReadingState } from '../../services/reading-state-service';

export interface ReaderSessionOptions {
  readonly bookId: string;
  readonly viewport?: ReaderViewport;
  readonly contentInsets?: ReaderContentInsets;
  readonly theme: ReaderTheme;
  readonly palette: ReaderRenderPalette;
}

export function useReaderSession({ bookId, viewport, contentInsets, theme, palette }: ReaderSessionOptions) {
  const typography = useReaderStore((state) => state.typography);
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
  const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime]);
  const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const currentBook = book?.id === bookId ? book : undefined;
  const currentOpenResult = openResult?.bookId === bookId ? openResult.result : undefined;
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
        typography,
        theme,
        updatedAt: Date.now(),
      };
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
    },
    [currentBook, saveQueue, theme, typography],
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
    const repaired = repairDanglingReaderFonts(typography, fonts);
    if (repaired) {
      useReaderStore.getState().setTypography(repaired);
    }
  }, [fonts, typography]);

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

  useEffect(() => {
    persistSnapshot(snapshot);
  }, [persistSnapshot, snapshot]);

  // Saving on exit reads the latest preferences without making preference
  // changes tear down the runtime. Only the runtime's lifetime owns close().
  const persistOnExit = useEffectEvent(() => {
    persistSnapshot(runtime.getSnapshot());
  });

  useEffect(() => {
    sessionMounted.current = true;
    return () => {
      sessionMounted.current = false;
      persistOnExit();
      layoutQueue.current = layoutQueue.current
        .then(async () => {
          await runtime.close();
          activeBookId.current = undefined;
          layoutKey.current = undefined;
        })
        .catch(() => undefined);
    };
  }, [runtime]);

  return {
    runtime,
    snapshot,
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
