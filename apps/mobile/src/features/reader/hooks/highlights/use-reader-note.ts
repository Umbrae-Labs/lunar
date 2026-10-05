import { useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import type { ReaderRuntime, ReaderSourceRange, ReaderTextSelection } from '@/reader';
import type { ReaderHighlight, ReaderNote } from '../../domain/reader-highlight';
import { createReaderNote, type CreateReaderHighlightInput } from '../../services/highlight-service';
import { resolveReaderSelectionSourceRange } from '../../services/highlight-overlay-service';

interface NoteTarget {
  readonly key: number;
  readonly bookId: string;
  readonly href: string;
  readonly text: string;
  readonly highlightId?: string;
  readonly sourceRange?: ReaderSourceRange;
  readonly selection?: ReaderTextSelection;
}

export function useReaderNote({
  bookId,
  runtime,
  addHighlight,
  highlights,
  updateNotes,
}: {
  readonly bookId: string;
  readonly runtime: ReaderRuntime;
  readonly addHighlight: (input: Omit<CreateReaderHighlightInput, 'bookId'>) => Promise<ReaderHighlight>;
  readonly highlights: readonly ReaderHighlight[];
  readonly updateNotes: (id: string, notes: readonly ReaderNote[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const nextKey = useRef(0);
  const [target, setTarget] = useState<NoteTarget>();
  const [open, setOpen] = useState(false);
  const activeTarget = target?.bookId === bookId ? target : undefined;
  const highlight = highlights.find((item) => item.id === activeTarget?.highlightId);

  function openHighlight(highlight: ReaderHighlight) {
    setTarget({
      key: ++nextKey.current,
      bookId: highlight.bookId,
      href: highlight.href,
      text: highlight.text,
      highlightId: highlight.id,
      sourceRange: highlight.sourceRange,
    });
    setOpen(true);
  }

  function openSelection(selection: ReaderTextSelection, href: string, highlight?: ReaderHighlight) {
    if (highlight) {
      openHighlight(highlight);
      return;
    }
    setTarget({
      key: ++nextKey.current,
      bookId,
      href,
      text: selection.text,
      selection,
      sourceRange: selection.sourceRange,
    });
    setOpen(true);
  }

  async function save(content: string, noteId?: string) {
    if (!activeTarget || !activeTarget.href || !bookId) throw new Error(t('reader.highlightUnavailable'));
    if (activeTarget.highlightId) {
      if (!highlight) throw new Error(t('reader.noteMissing'));
      const notes = highlight.notes ?? [];
      if (noteId && !notes.some((item) => item.id === noteId)) throw new Error(t('reader.noteMissing'));
      await updateNotes(
        activeTarget.highlightId,
        noteId
          ? notes.map((item) => (item.id === noteId ? { ...item, content, updatedAt: Date.now() } : item))
          : [...notes, createReaderNote(content)],
      );
      return;
    }
    const sourceRange =
      activeTarget.sourceRange ??
      (activeTarget.selection
        ? await resolveReaderSelectionSourceRange(runtime, activeTarget.selection, activeTarget.href)
        : undefined);
    if (!sourceRange) throw new Error(t('reader.highlightUnavailable'));
    const saved = await addHighlight({
      href: activeTarget.href,
      text: activeTarget.text,
      sourceRange,
      notes: [createReaderNote(content)],
    });
    setTarget((current) =>
      current?.key === activeTarget.key
        ? { ...current, highlightId: saved.id, sourceRange: saved.sourceRange, text: saved.text }
        : current,
    );
  }

  async function remove(noteId: string) {
    if (!highlight?.notes?.some((item) => item.id === noteId)) throw new Error(t('reader.noteMissing'));
    await updateNotes(
      highlight.id,
      highlight.notes.filter((item) => item.id !== noteId),
    );
  }

  return {
    target: activeTarget,
    notes: highlight?.notes ?? [],
    isOpen: open && Boolean(activeTarget),
    openHighlight,
    openSelection,
    close: () => setOpen(false),
    save,
    remove,
  };
}
