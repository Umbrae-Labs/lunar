import { useCallback, useEffect, useMemo } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { runOnUI, scheduleOnRN } from 'react-native-worklets';
import {
  createReaderSelectionHits,
  moveReaderSelectionRange,
  readerSelectionHandlePoints,
  readerSelectionRects,
  selectionEndpointAtPoint,
  type ReaderHitEntry,
  type ReaderRect,
  type ReaderSelectionPoint,
  type ReaderTextSelection,
  type ReaderTextSelectionRange,
} from '@/reader';
import type { ReaderSelectionBinding, ReaderSurfaceTransform } from '@/reader/native';

type Boundary = 'start' | 'end' | 'extend';

export function useReaderSelectionDrag({
  entries,
  transform,
  selection,
  pageKey,
  onCommit,
}: {
  readonly entries: readonly ReaderHitEntry[];
  readonly transform?: ReaderSurfaceTransform;
  readonly selection?: ReaderTextSelection;
  readonly pageKey: string;
  readonly onCommit: (
    range: ReaderTextSelectionRange | undefined,
    point: ReaderSelectionPoint,
    pageKey: string,
  ) => void;
}) {
  const scale = transform?.scale ?? 1;
  const offsetX = transform?.offsetX ?? 0;
  const offsetY = transform?.offsetY ?? 0;
  const hits = useMemo(
    () => createReaderSelectionHits(entries, scale, offsetX, offsetY),
    [entries, offsetX, offsetY, scale],
  );
  const rects = useSharedValue<readonly ReaderRect[]>([]);
  const startHandle = useSharedValue<ReaderSelectionPoint>({ x: 0, y: 0 });
  const endHandle = useSharedValue<ReaderSelectionPoint>({ x: 0, y: 0 });
  const dragging = useSharedValue(false);
  const visible = useSharedValue(false);
  const active = useSharedValue<Boundary | undefined>(undefined);
  const range = useSharedValue<ReaderTextSelectionRange | undefined>(undefined);
  const origin = useSharedValue<ReaderTextSelectionRange | undefined>(undefined);
  const beforeDrag = useSharedValue<ReaderTextSelectionRange | undefined>(undefined);
  const anchor = useSharedValue<ReaderSelectionPoint>({ x: 0, y: 0 });
  const latest = useSharedValue<ReaderSelectionPoint>({ x: 0, y: 0 });
  const owner = useSharedValue(pageKey);
  const binding = useMemo<ReaderSelectionBinding>(
    () => ({ rects, startHandle, endHandle, dragging, visible }),
    [dragging, endHandle, rects, startHandle, visible],
  );

  const paintRange = useCallback(
    (next: ReaderTextSelectionRange) => {
      'worklet';
      range.set(next);
      const boxes = readerSelectionRects(hits, next);
      rects.set(boxes);
      const handles = readerSelectionHandlePoints(boxes);
      startHandle.set(handles.start);
      endHandle.set(handles.end);
      visible.set(boxes.length > 0);
    },
    [endHandle, hits, range, rects, startHandle, visible],
  );

  const move = useCallback(
    (boundary: Boundary, x: number, y: number) => {
      'worklet';
      latest.set({ x, y });
      if (owner.value !== pageKey || active.value !== boundary) return;
      const current = range.value;
      const initial = origin.value;
      if (!current || !initial) return;
      const endpoint = selectionEndpointAtPoint(hits, x, y, (boundary === 'extend' ? 48 : 72) * scale);
      if (endpoint) {
        const next = moveReaderSelectionRange(current, initial, boundary, endpoint);
        if (next !== current) paintRange(next);
      }
      // The dragged knob follows the finger continuously; selection fills snap
      // to character boundaries. Neither update needs a React commit.
      if (boundary === 'start') startHandle.set({ x, y });
      if (boundary === 'end') endHandle.set({ x, y });
    },
    [active, endHandle, hits, latest, origin, owner, pageKey, paintRange, range, scale, startHandle],
  );

  const begin = useCallback(
    (boundary: Boundary, x = 0, y = 0) => {
      'worklet';
      if (owner.value !== pageKey) return;
      beforeDrag.set(range.value);
      active.set(boundary);
      dragging.set(true);
      anchor.set(boundary === 'start' ? startHandle.value : endHandle.value);
      if (boundary === 'extend') {
        range.set(undefined);
        latest.set({ x, y });
        visible.set(false);
      }
    },
    [active, anchor, beforeDrag, dragging, endHandle, latest, owner, pageKey, range, startHandle, visible],
  );

  const moveHandle = useCallback(
    (boundary: 'start' | 'end', dx: number, dy: number) => {
      'worklet';
      move(boundary, anchor.value.x + dx, anchor.value.y + dy);
    },
    [anchor, move],
  );

  const finish = useCallback(
    (cancelled: boolean) => {
      'worklet';
      if (owner.value !== pageKey || !active.value) return;
      const selected = cancelled ? beforeDrag.value : range.value;
      active.set(undefined);
      if (selected) paintRange(selected);
      // Keep the toolbar hidden until RN adopts the final text and source range.
      scheduleOnRN(onCommit, selected, latest.value, pageKey);
    },
    [active, beforeDrag, latest, onCommit, owner, pageKey, paintRange, range],
  );

  const initialize = useCallback(
    (value: ReaderTextSelection) => {
      runOnUI((initial: ReaderTextSelectionRange) => {
        'worklet';
        if (owner.value !== pageKey) return;
        origin.set(initial);
        paintRange(initial);
        if (active.value === 'extend') move('extend', latest.value.x, latest.value.y);
      })(value.origin);
    },
    [active, latest, move, origin, owner, pageKey, paintRange],
  );

  useEffect(() => {
    const boxes =
      selection?.bounds.map((b) => ({
        x: offsetX + b.x * scale,
        y: offsetY + b.y * scale,
        width: b.width * scale,
        height: b.height * scale,
      })) ?? [];
    runOnUI(
      (
        key: string,
        next: ReaderTextSelectionRange | undefined,
        initial: ReaderTextSelectionRange | undefined,
        boxes: readonly ReaderRect[],
      ) => {
        'worklet';
        if (owner.value !== key) {
          owner.set(key);
          active.set(undefined);
        }
        if (active.value) return;
        range.set(next);
        origin.set(initial);
        rects.set(boxes);
        const handles = readerSelectionHandlePoints(boxes);
        startHandle.set(handles.start);
        endHandle.set(handles.end);
        visible.set(boxes.length > 0);
        dragging.set(false);
      },
    )(pageKey, selection?.range, selection?.origin, boxes);
  }, [
    active,
    dragging,
    endHandle,
    offsetX,
    offsetY,
    origin,
    owner,
    pageKey,
    range,
    rects,
    scale,
    selection,
    startHandle,
    visible,
  ]);

  return { binding, begin, move, moveHandle, finish, initialize };
}

export type ReaderSelectionDragController = ReturnType<typeof useReaderSelectionDrag>;
