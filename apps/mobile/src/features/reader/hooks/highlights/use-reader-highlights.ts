import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReaderHighlight, ReaderNote } from '../../domain/reader-highlight';
import {
  listReaderHighlights,
  prepareReaderHighlight,
  removeReaderHighlights,
  saveReaderHighlight,
  updateReaderHighlightNotes,
  type CreateReaderHighlightInput,
} from '../../services/highlight-service';

const EmptyHighlights: readonly ReaderHighlight[] = [];

export function useReaderHighlights(bookId: string) {
  const [state, setState] = useState<{
    readonly bookId: string;
    readonly highlights: readonly ReaderHighlight[];
  }>({ bookId: '', highlights: EmptyHighlights });
  const [failure, setFailure] = useState<{ bookId: string; error: unknown }>();
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    if (bookId)
      void listReaderHighlights(bookId)
        .then((highlights) => {
          if (active) {
            setState({ bookId, highlights });
            setFailure(undefined);
          }
        })
        .catch((cause: unknown) => {
          if (active) setFailure({ bookId, error: cause });
        });
    return () => {
      active = false;
    };
  }, [bookId]);

  const addHighlight = useCallback(
    async (input: Omit<CreateReaderHighlightInput, 'bookId'>) => {
      if (state.bookId !== bookId || pending.current) throw new Error('Highlights are still loading');
      const previous = state;
      const { highlight, removedIds } = prepareReaderHighlight({ ...input, bookId }, state.highlights);
      const updated = {
        bookId,
        highlights: [...state.highlights.filter((item) => !removedIds.includes(item.id)), highlight],
      };
      pending.current = true;
      setState(updated);
      try {
        await saveReaderHighlight(highlight, removedIds);
        return highlight;
      } catch (cause) {
        setState((current) => (current === updated ? previous : current));
        throw cause;
      } finally {
        pending.current = false;
      }
    },
    [bookId, state],
  );

  const removeHighlights = useCallback(
    async (ids: readonly string[]) => {
      if (state.bookId !== bookId || pending.current) return;
      pending.current = true;
      const previous = state;
      const updated = { bookId, highlights: state.highlights.filter((item) => !ids.includes(item.id)) };
      setState(updated);
      try {
        await removeReaderHighlights(bookId, ids);
      } catch (cause) {
        setState((current) => (current === updated ? previous : current));
        throw cause;
      } finally {
        pending.current = false;
      }
    },
    [bookId, state],
  );

  const updateNotes = useCallback(
    async (id: string, notes: readonly ReaderNote[]) => {
      if (state.bookId !== bookId || pending.current) throw new Error('Highlights are still loading');
      if (!state.highlights.some((item) => item.id === id)) throw new Error('The annotation no longer exists');
      const previous = state;
      const updated = {
        bookId,
        highlights: state.highlights.map((item) => (item.id === id ? { ...item, notes } : item)),
      };
      pending.current = true;
      setState(updated);
      try {
        await updateReaderHighlightNotes(bookId, id, notes);
      } catch (cause) {
        setState((current) => (current === updated ? previous : current));
        throw cause;
      } finally {
        pending.current = false;
      }
    },
    [bookId, state],
  );

  return {
    highlights: state.bookId === bookId ? state.highlights : EmptyHighlights,
    isLoaded: state.bookId === bookId,
    error: failure?.bookId === bookId ? failure.error : undefined,
    addHighlight,
    removeHighlights,
    updateNotes,
  };
}
