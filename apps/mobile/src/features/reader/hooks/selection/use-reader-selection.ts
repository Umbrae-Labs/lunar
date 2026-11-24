import * as Clipboard from 'expo-clipboard';
import { useToast } from 'heroui-native/toast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useTranslation } from '@/i18n';
import {
  createReaderWordSelectionAtPoint,
  createReaderTextSelectionFromRange,
  createReaderTextSelectionFromSourceRange,
  updateReaderTextSelectionAtPoint,
  type ReaderRuntime,
  type ReaderSnapshot,
  type ReaderHitEntry,
  type ReaderTextSelection,
  type ReaderTextSelectionRange,
  type ReaderSelectionPoint,
} from '@/reader';
import type { LunarReaderRuntime, ReaderSurfaceTransform } from '@/reader/native';
import { containsHighlightRange } from '../../domain/highlight-ranges';
import type { ReaderHighlight } from '../../domain/reader-highlight';
import { createReaderHighlightRegions } from '../../services/highlight-overlay-service';
import { configureReaderSelectionGesture } from './selection-gesture';
import { useReaderSelectionDrag } from './use-reader-selection-drag';

export interface OwnedReaderTextSelection extends ReaderTextSelection {
  readonly kind: 'text' | 'highlight';
  readonly revisionId: number;
  readonly spreadIndex: number;
  readonly renderId?: number;
}

interface ReaderSelectionOptions {
  readonly runtime: ReaderRuntime & Pick<LunarReaderRuntime, 'suspendBackgroundPagination'>;
  readonly snapshot: ReaderSnapshot;
  readonly currentHitEntries: readonly ReaderHitEntry[];
  readonly highlights: readonly ReaderHighlight[];
  readonly surfaceTransform?: ReaderSurfaceTransform;
  readonly enabled: boolean;
  readonly onSelectionStart: () => void;
  /**
   * Makes the page under a view point the runtime's own before a selection
   * starts there, for a view showing more than one page: true when it already
   * is, otherwise whether it got there.
   */
  readonly focusPress?: (x: number, y: number) => true | Promise<boolean>;
}

export function useReaderSelection({
  runtime,
  snapshot,
  currentHitEntries,
  highlights,
  surfaceTransform,
  enabled,
  onSelectionStart,
  focusPress,
}: ReaderSelectionOptions) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [selectionState, setSelection] = useState<OwnedReaderTextSelection>();
  const selectionRef = useRef<ReaderTextSelection | undefined>(undefined);
  const selection =
    selectionState?.revisionId === snapshot.revisionId &&
    selectionState.spreadIndex === snapshot.spreadIndex &&
    selectionState.renderId === snapshot.renderId
      ? selectionState
      : undefined;
  const textSelection = selection?.kind === 'text' ? selection : undefined;
  const chapterHref = snapshot.position?.locator?.manifestHref ?? '';
  const highlightRegions = useMemo(
    () => createReaderHighlightRegions(currentHitEntries, highlights, chapterHref),
    [chapterHref, currentHitEntries, highlights],
  );
  const activeHighlight = selection?.sourceRange
    ? highlights.find(
        (highlight) =>
          highlight.href === chapterHref && containsHighlightRange(highlight.sourceRange, selection.sourceRange!),
      )
    : undefined;
  const expandHighlightSelection = useCallback(
    (value: ReaderTextSelection): ReaderTextSelection => {
      const range = value.sourceRange;
      if (!range) return value;
      const highlight = highlights.find(
        (item) => item.href === chapterHref && containsHighlightRange(item.sourceRange, range),
      );
      if (!highlight) return value;
      const expanded = createReaderTextSelectionFromSourceRange(currentHitEntries, highlight.sourceRange);
      return expanded ? { ...expanded, text: highlight.text, sourceRange: highlight.sourceRange } : value;
    },
    [chapterHref, currentHitEntries, highlights],
  );
  const clearSelection = useCallback(() => {
    selectionRef.current = undefined;
    setSelection(undefined);
  }, []);

  const displayPoint = useCallback(
    (x: number, y: number) => {
      return surfaceTransform?.toDisplayPoint(x, y) ?? { x, y };
    },
    [surfaceTransform],
  );

  const isCurrentPage = useCallback(() => {
    const current = runtime.getSnapshot();
    return (
      current.phase === 'ready' &&
      current.revisionId === snapshot.revisionId &&
      current.spreadIndex === snapshot.spreadIndex &&
      current.renderId === snapshot.renderId
    );
  }, [runtime, snapshot.renderId, snapshot.revisionId, snapshot.spreadIndex]);

  const resolveSelectionBounds = useCallback(
    async (value: ReaderTextSelection) => {
      const groups = await Promise.all(
        value.geometryRequests.map((request) => runtime.resolveTextRangeGeometry(request).catch(() => [])),
      );
      return groups.length && groups.every((group) => group.length)
        ? groups.flat().map((rect) => rect.bounds)
        : value.bounds;
    },
    [runtime],
  );

  const publishSelection = useCallback(
    async (requested: ReaderTextSelection) => {
      selectionRef.current = requested;
      const bounds = await resolveSelectionBounds(requested);
      if (selectionRef.current !== requested || !isCurrentPage()) return;
      const refined = { ...requested, bounds };
      selectionRef.current = refined;
      setSelection({
        ...refined,
        kind: 'text',
        revisionId: snapshot.revisionId,
        spreadIndex: snapshot.spreadIndex,
        renderId: snapshot.renderId,
      });
    },
    [isCurrentPage, resolveSelectionBounds, snapshot.renderId, snapshot.revisionId, snapshot.spreadIndex],
  );

  const selectionPageKey = `${snapshot.revisionId}:${snapshot.spreadIndex}:${snapshot.renderId}`;
  const commitSelectionDrag = useCallback(
    async (range: ReaderTextSelectionRange | undefined, point: ReaderSelectionPoint, owner: string) => {
      if (!isCurrentPage()) return;
      const snapshot = runtime.getSnapshot();
      if (owner !== `${snapshot.revisionId}:${snapshot.spreadIndex}:${snapshot.renderId}`) return;
      const entries = runtime.getCurrentHitMap()?.entries;
      const current = selectionRef.current;
      if (!entries) return;
      const display = displayPoint(point.x, point.y);
      const next = range
        ? createReaderTextSelectionFromRange(entries, range)
        : current
          ? updateReaderTextSelectionAtPoint(entries, current, display.x, display.y)
          : undefined;
      if (!next) {
        clearSelection();
        return;
      }
      await publishSelection(expandHighlightSelection(next));
    },
    [clearSelection, displayPoint, expandHighlightSelection, isCurrentPage, publishSelection, runtime],
  );
  const selectionDrag = useReaderSelectionDrag({
    entries: currentHitEntries,
    resolveSelectionBounds,
    transform: surfaceTransform,
    selection: textSelection,
    pageKey: selectionPageKey,
    onCommit: commitSelectionDrag,
  });
  const {
    begin: beginSelectionDrag,
    move: moveSelectionDrag,
    finish: finishSelectionDrag,
    initialize: initializeSelectionDrag,
  } = selectionDrag;
  const hasSelection = Boolean(selection);
  useEffect(() => {
    if (hasSelection) return runtime.suspendBackgroundPagination();
  }, [hasSelection, runtime]);

  // A press on another page waits for the runtime to reach it, then starts
  // over with that page's snapshot and transform.
  const pendingPress = useRef<{ readonly x: number; readonly y: number } | undefined>(undefined);
  const [pressEpoch, setPressEpoch] = useState(0);
  const beginSelection = useCallback(
    (x: number, y: number) => {
      if (!enabled) return;
      const focused = focusPress?.(x, y) ?? true;
      if (focused !== true) {
        pendingPress.current = { x, y };
        void focused.then((reached) => {
          if (pendingPress.current?.x !== x || pendingPress.current.y !== y) return;
          if (reached) setPressEpoch((epoch) => epoch + 1);
          else pendingPress.current = undefined;
        });
        return;
      }
      // A pending press stays until the snapshot of the page it reached arrives.
      if (!isCurrentPage()) return;
      pendingPress.current = undefined;
      const hitMap = runtime.getCurrentHitMap();
      if (!hitMap) return;
      const point = displayPoint(x, y);
      const wordSelection = createReaderWordSelectionAtPoint(hitMap.entries, point.x, point.y);
      if (!wordSelection) return;
      const nextSelection = expandHighlightSelection(wordSelection);
      initializeSelectionDrag(nextSelection);
      setSelection({
        ...nextSelection,
        bounds: [],
        kind: 'text',
        revisionId: snapshot.revisionId,
        spreadIndex: snapshot.spreadIndex,
        renderId: snapshot.renderId,
      });
      void publishSelection(nextSelection);
      onSelectionStart();
    },
    [
      displayPoint,
      enabled,
      focusPress,
      isCurrentPage,
      onSelectionStart,
      expandHighlightSelection,
      initializeSelectionDrag,
      publishSelection,
      runtime,
      snapshot.renderId,
      snapshot.revisionId,
      snapshot.spreadIndex,
    ],
  );

  useEffect(() => {
    const press = pendingPress.current;
    if (!press || pressEpoch === 0 || !isCurrentPage()) return;
    beginSelection(press.x, press.y);
  }, [beginSelection, isCurrentPage, pressEpoch]);

  /* eslint-disable react-hooks/refs -- Gesture callbacks execute on events, outside React rendering. */
  const selectionGesture = useMemo(
    () =>
      configureReaderSelectionGesture(Gesture.Pan())
        .enabled(enabled)
        .averageTouches(true)
        .cancelsTouchesInView(true)
        .onStart((event) => {
          'worklet';
          beginSelectionDrag('extend', event.x, event.y);
          scheduleOnRN(beginSelection, event.x, event.y);
        })
        .onUpdate((event) => {
          'worklet';
          moveSelectionDrag('extend', event.x, event.y);
        })
        .onEnd((event, success) => {
          'worklet';
          moveSelectionDrag('extend', event.x, event.y);
          finishSelectionDrag(!success);
        })
        .onFinalize((_event, success) => {
          'worklet';
          if (!success) finishSelectionDrag(true);
        }),
    [beginSelection, beginSelectionDrag, finishSelectionDrag, enabled, moveSelectionDrag],
  );
  /* eslint-enable react-hooks/refs */
  const selectHighlightAtPoint = useCallback(
    (x: number, y: number) => {
      if (!enabled || !isCurrentPage()) return false;
      const point = displayPoint(x, y);
      const region = highlightRegions.find(({ selection: highlightedSelection }) =>
        highlightedSelection.bounds.some(
          (bounds) =>
            point.x >= bounds.x &&
            point.x <= bounds.x + bounds.width &&
            point.y >= bounds.y &&
            point.y <= bounds.y + bounds.height,
        ),
      );
      if (region) {
        const nextSelection = {
          ...region.selection,
          sourceRange: region.highlight.sourceRange,
          text: region.highlight.text,
        };
        selectionRef.current = nextSelection;
        setSelection({
          ...nextSelection,
          kind: 'highlight',
          revisionId: snapshot.revisionId,
          spreadIndex: snapshot.spreadIndex,
          renderId: snapshot.renderId,
        });
        onSelectionStart();
        return true;
      }
      return false;
    },
    [displayPoint, enabled, highlightRegions, isCurrentPage, onSelectionStart, snapshot],
  );

  const getSelection = useCallback(() => selectionRef.current, []);
  const replaceSelection = useCallback((value: OwnedReaderTextSelection) => {
    selectionRef.current = value;
    setSelection(value);
  }, []);

  const copySelection = useCallback(async () => {
    if (!selection?.text) return;
    await Clipboard.setStringAsync(selection.text);
    toast.show({ variant: 'success', label: t('reader.selectionCopied') });
    clearSelection();
  }, [clearSelection, selection, t, toast]);

  const selectionViewportRects = useMemo(() => {
    if (!selection || !surfaceTransform) return [];
    return selection.bounds.map((bounds) => {
      const origin = surfaceTransform.toViewportPoint(bounds.x, bounds.y);
      return {
        x: origin.x,
        y: origin.y,
        width: bounds.width * surfaceTransform.scale,
        height: bounds.height * surfaceTransform.scale,
      };
    });
  }, [selection, surfaceTransform]);
  return {
    selection,
    textSelection,
    activeHighlight,
    selectionDrag,
    selectionGesture,
    selectionViewportRects,
    clearSelection,
    copySelection,
    selectHighlightAtPoint,
    getSelection,
    replaceSelection,
  };
}
