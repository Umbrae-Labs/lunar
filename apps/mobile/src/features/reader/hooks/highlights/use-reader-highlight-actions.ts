import { useCallback, useRef, useState } from 'react';
import { useToast } from 'heroui-native/toast';
import { useTranslation } from '@/i18n';
import {
  createReaderTextSelectionFromSourceRange,
  type ReaderRuntime,
  type ReaderSnapshot,
  type ReaderHitEntry,
} from '@/reader';
import type { ReaderHighlight, ReaderHighlightColor, ReaderHighlightStyle } from '../../domain/reader-highlight';
import { resolveReaderSelectionSourceRange } from '../../services/highlight-overlay-service';
import type { useReaderSelection } from '../selection/use-reader-selection';
import type { useReaderHighlights } from './use-reader-highlights';

type ReaderHighlightActionsOptions = Pick<
  ReturnType<typeof useReaderSelection>,
  'selection' | 'activeHighlight' | 'clearSelection' | 'getSelection' | 'replaceSelection'
> &
  Pick<ReturnType<typeof useReaderHighlights>, 'addHighlight' | 'removeHighlights'> & {
    readonly bookId: string;
    readonly runtime: ReaderRuntime;
    readonly snapshot: ReaderSnapshot;
    readonly currentHitEntries: readonly ReaderHitEntry[];
  };

export function useReaderHighlightActions({
  bookId,
  runtime,
  snapshot,
  currentHitEntries,
  selection,
  activeHighlight,
  clearSelection,
  getSelection,
  replaceSelection,
  addHighlight,
  removeHighlights,
}: ReaderHighlightActionsOptions) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [highlightToDelete, setHighlightToDelete] = useState<ReaderHighlight>();
  const isHighlightingRef = useRef(false);
  const highlightSelection = useCallback(
    async (color?: ReaderHighlightColor, style?: ReaderHighlightStyle) => {
      const href = snapshot.position?.locator?.manifestHref;
      if (isHighlightingRef.current) return;
      if (!selection || !href || !bookId) {
        toast.show({ variant: 'danger', label: t('reader.highlightUnavailable') });
        return;
      }
      isHighlightingRef.current = true;
      setIsHighlighting(true);
      try {
        const sourceRange = await resolveReaderSelectionSourceRange(runtime, selection, href);
        if (!sourceRange) {
          toast.show({ variant: 'danger', label: t('reader.highlightUnavailable') });
          return;
        }
        const selected = getSelection();
        const operation = addHighlight({
          href,
          sourceRange,
          text: selection.text,
          color: color ?? activeHighlight?.color ?? 'yellow',
          style: style ?? activeHighlight?.style ?? 'highlight',
        });
        const saved = await operation;
        if (!color && !style && getSelection() === selected) clearSelection();
        const latest = runtime.getSnapshot();
        if (
          (color || style) &&
          getSelection() === selected &&
          latest.revisionId === selection.revisionId &&
          latest.spreadIndex === selection.spreadIndex &&
          latest.renderId === selection.renderId
        ) {
          const expanded = createReaderTextSelectionFromSourceRange(currentHitEntries, saved.sourceRange);
          if (expanded) {
            const updated = { ...selection, ...expanded, sourceRange: saved.sourceRange, text: saved.text };
            replaceSelection(updated);
          }
        }
      } catch (error) {
        toast.show({
          variant: 'danger',
          label: t('reader.highlightSaveFailed'),
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        isHighlightingRef.current = false;
        setIsHighlighting(false);
      }
    },
    [
      activeHighlight,
      addHighlight,
      bookId,
      clearSelection,
      currentHitEntries,
      getSelection,
      replaceSelection,
      selection,
      runtime,
      snapshot.position?.locator?.manifestHref,
      t,
      toast,
    ],
  );

  const deleteHighlight = useCallback(
    async (highlight = activeHighlight) => {
      if (!highlight || isHighlightingRef.current) return;
      isHighlightingRef.current = true;
      setIsHighlighting(true);
      // Close the transient controls in the same update as the optimistic removal.
      clearSelection();
      try {
        await removeHighlights([highlight.id]);
        setHighlightToDelete(undefined);
        toast.show({ variant: 'success', label: t('reader.highlightRemoved') });
      } catch (error) {
        toast.show({
          variant: 'danger',
          label: t('reader.highlightSaveFailed'),
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        isHighlightingRef.current = false;
        setIsHighlighting(false);
      }
    },
    [activeHighlight, clearSelection, removeHighlights, t, toast],
  );

  return { isHighlighting, highlightToDelete, setHighlightToDelete, highlightSelection, deleteHighlight };
}
