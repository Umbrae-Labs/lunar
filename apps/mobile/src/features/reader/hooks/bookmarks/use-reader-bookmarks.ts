import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReaderBookmark } from '../../domain/reader-bookmark';
import { listReaderBookmarks, removeReaderBookmark, saveReaderBookmark } from '../../services/bookmark-service';

const EmptyBookmarks: readonly ReaderBookmark[] = [];

export function useReaderBookmarks(bookId: string) {
  const [state, setState] = useState<{ bookId: string; bookmarks: readonly ReaderBookmark[] }>({
    bookId: '',
    bookmarks: EmptyBookmarks,
  });
  const [failure, setFailure] = useState<{ bookId: string; error: unknown }>();
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    if (bookId)
      void listReaderBookmarks(bookId)
        .then((bookmarks) => {
          if (active) {
            setState({ bookId, bookmarks });
            setFailure(undefined);
          }
        })
        .catch((error: unknown) => {
          if (active) setFailure({ bookId, error });
        });
    return () => {
      active = false;
    };
  }, [bookId]);

  const addBookmark = useCallback(
    async (input: Omit<ReaderBookmark, 'bookId' | 'id' | 'createdAt'>) => {
      if (state.bookId !== bookId || pending.current) throw new Error('Bookmarks are busy.');
      pending.current = true;
      try {
        const saved = await saveReaderBookmark({ ...input, bookId });
        setState((current) =>
          current.bookId === bookId
            ? { bookId, bookmarks: [saved, ...current.bookmarks.filter((item) => item.id !== saved.id)] }
            : current,
        );
        return saved;
      } finally {
        pending.current = false;
      }
    },
    [bookId, state.bookId],
  );

  const removeBookmark = useCallback(
    async (id: string) => {
      if (state.bookId !== bookId || pending.current) throw new Error('Bookmarks are busy.');
      pending.current = true;
      try {
        await removeReaderBookmark(bookId, id);
        setState((current) =>
          current.bookId === bookId
            ? { bookId, bookmarks: current.bookmarks.filter((item) => item.id !== id) }
            : current,
        );
      } finally {
        pending.current = false;
      }
    },
    [bookId, state.bookId],
  );

  return {
    bookmarks: state.bookId === bookId ? state.bookmarks : EmptyBookmarks,
    isLoaded: state.bookId === bookId,
    error: failure?.bookId === bookId ? failure.error : undefined,
    addBookmark,
    removeBookmark,
  };
}
