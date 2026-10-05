import type { CanvasRef, SkPicture } from '@shopify/react-native-skia';
import { useEffect, useRef, type RefObject } from 'react';

import { AUTOMATIC_PAGE_TURN_START_INTERVAL_MS } from '../core/page-turn-concurrency';
import type { ReaderPageTurnEffect } from '../core/page-turn-effect';
import type { ReaderInteractiveTurn, ReaderPageContent } from '../core/page-turn-types';
import { nativeInteractivePageTurnStockId } from './page-turn';
import { nativePageTextureKey } from './page-texture-key';
import type { ReaderPageTurnSurfaceBinding } from './page-turn-binding';
import {
  acquireNativePageRecording,
  type NativePageRecording,
  type NativePageRecordingCache,
} from './page-recording-cache';
import { readerPerformanceEnd, readerPerformanceMark, readerPerformanceStart } from '../../../runtime/core/performance';
import { configureNativePagerInput, setNativePagerAnchor, stockNativePagerPicture } from './pager-compositor';

interface NativeInteractivePageTurnOptions {
  readonly active: boolean;
  readonly canvasRef: RefObject<CanvasRef | null>;
  readonly createPicture: (content: ReaderPageContent) => SkPicture;
  readonly recordings?: NativePageRecordingCache;
  readonly paintKey?: string;
  readonly createChromePicture?: (content: ReaderPageContent) => SkPicture;
  readonly currentContent?: ReaderPageContent;
  readonly interactiveSource?: ReaderPageContent;
  readonly interactiveTurn?: ReaderInteractiveTurn;
  readonly paperColor: number;
  readonly pageTurnEffect: ReaderPageTurnEffect;
  readonly pixelHeight: number;
  readonly pixelWidth: number;
  readonly surfaceBinding?: ReaderPageTurnSurfaceBinding;
  readonly turnsActive: boolean;
  readonly anchorKeyRef: RefObject<string | undefined>;
  readonly submittedStockIdsRef: RefObject<Set<string>>;
}

export function useNativeInteractivePageTurn({
  active,
  canvasRef,
  createPicture,
  createChromePicture,
  recordings,
  paintKey,
  currentContent,
  interactiveSource,
  interactiveTurn,
  paperColor,
  pageTurnEffect,
  pixelHeight,
  pixelWidth,
  surfaceBinding,
  turnsActive,
  anchorKeyRef,
  submittedStockIdsRef,
}: NativeInteractivePageTurnOptions): void {
  const paintRevision = useRef(0);
  useEffect(() => {
    if (!active || !surfaceBinding || turnsActive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Consumption advances the composer's anchor while its released sheet is
    // still moving. Mirror that address without resetting the native queue.
    if (interactiveTurn?.nativeGesture?.consumed && interactiveTurn.content) {
      anchorKeyRef.current = interactiveTurn.content.key;
      return;
    }
    const source = interactiveSource ?? currentContent;
    if (!source || interactiveTurn?.nativeGesture?.driven) return;
    if (anchorKeyRef.current === source.key) return;
    if (!setNativePagerAnchor(canvas, source.key)) {
      surfaceBinding.inputReady.set(false);
      return;
    }
    surfaceBinding.inputReady.set(configureNativePagerInput(canvas, true));
    anchorKeyRef.current = source.key;
    submittedStockIdsRef.current.clear();
    surfaceBinding.stockedGestureToken.set(0);
  }, [
    active,
    anchorKeyRef,
    canvasRef,
    createPicture,
    recordings,
    paintKey,
    currentContent,
    interactiveSource,
    interactiveTurn,
    submittedStockIdsRef,
    surfaceBinding,
    turnsActive,
  ]);

  useEffect(() => {
    const nativeGesture = interactiveTurn?.nativeGesture;
    if (
      !active ||
      !surfaceBinding ||
      !nativeGesture ||
      nativeGesture.driven ||
      !interactiveTurn?.content ||
      !interactiveSource ||
      pixelWidth <= 0 ||
      pixelHeight <= 0
    ) {
      if (!interactiveTurn) surfaceBinding?.stockedGestureToken.set(0);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || anchorKeyRef.current !== interactiveSource.key) return;
    const stockKey = JSON.stringify([
      nativeGesture.token,
      nativeGesture.preparedTurnId,
      nativePageTextureKey(interactiveSource, 'page', paintKey),
      nativePageTextureKey(interactiveTurn.content, 'page', paintKey),
    ]);
    if (submittedStockIdsRef.current.has(stockKey)) {
      surfaceBinding.stockedGestureToken.set(nativeGesture.token);
      return;
    }
    const stockId = nativeInteractivePageTurnStockId(
      nativeGesture.token,
      nativeGesture.preparedTurnId,
      ++paintRevision.current,
    );

    let sourcePicture: NativePageRecording | undefined;
    let targetPicture: NativePageRecording | undefined;
    let sourceChrome: NativePageRecording | undefined;
    let targetChrome: NativePageRecording | undefined;
    let accepted = false;
    const recordStartedAt = readerPerformanceStart();
    let submitStartedAt: number | undefined;
    let submittedAtMs: number | undefined;
    try {
      sourcePicture = acquireNativePageRecording(
        recordings,
        createPicture,
        interactiveSource,
        'page',
        paintKey,
        pixelWidth,
        pixelHeight,
      );
      targetPicture = acquireNativePageRecording(
        recordings,
        createPicture,
        interactiveTurn.content,
        'page',
        paintKey,
        pixelWidth,
        pixelHeight,
      );
      sourceChrome = createChromePicture
        ? acquireNativePageRecording(
            recordings,
            createChromePicture,
            interactiveSource,
            'chrome',
            paintKey,
            pixelWidth,
            pixelHeight,
          )
        : undefined;
      targetChrome = createChromePicture
        ? acquireNativePageRecording(
            recordings,
            createChromePicture,
            interactiveTurn.content,
            'chrome',
            paintKey,
            pixelWidth,
            pixelHeight,
          )
        : undefined;
      readerPerformanceEnd('reader.native.record', recordStartedAt, {
        workId: interactiveTurn.performanceId,
        pixelWidth,
        pixelHeight,
        prepared: nativeGesture.preparedTurnId,
      });
      submitStartedAt = readerPerformanceStart();
      submittedAtMs = submitStartedAt === undefined ? undefined : Date.now();
      const forward = interactiveTurn.direction > 0;
      accepted = stockNativePagerPicture(canvas, {
        id: stockId,
        fromPageKey: interactiveSource.key,
        toPageKey: interactiveTurn.content.key,
        frontPageKey: nativePageTextureKey(forward ? interactiveSource : interactiveTurn.content, 'page', paintKey),
        backgroundLeftPageKey: nativePageTextureKey(
          forward ? interactiveTurn.content : interactiveSource,
          'page',
          paintKey,
        ),
        frontPicture: (forward ? sourcePicture : targetPicture).picture,
        // Curl keeps a blank back. Planar effects use the spare faces for
        // independent fixed chrome; their backward body stays underneath.
        backgroundLeftPicture: (forward ? targetPicture : sourcePicture).picture,
        backPicture: sourceChrome?.picture,
        backPageKey: sourceChrome ? nativePageTextureKey(interactiveSource, 'chrome', paintKey) : undefined,
        backgroundRightPicture: targetChrome?.picture,
        backgroundRightPageKey: targetChrome
          ? nativePageTextureKey(interactiveTurn.content, 'chrome', paintKey)
          : undefined,
        pixelWidth,
        pixelHeight,
        direction: interactiveTurn.direction,
        spread: false,
        contentRevision: interactiveTurn.content.snapshot.revisionId,
        durationMs: pageTurnEffect.motion.getDuration({
          releaseVelocity: 0,
          animationDuration: 360,
          incomingPageLanding: interactiveTurn.direction < 0,
        }),
        rapidDurationMs: pageTurnEffect.motion.getDuration({
          releaseVelocity: 0,
          animationDuration: 360,
          incomingPageLanding: false,
        }),
        launchIntervalMs: AUTOMATIC_PAGE_TURN_START_INTERVAL_MS,
        paperColor,
      });
    } catch {
      accepted = false;
    } finally {
      readerPerformanceEnd('reader.native.stock', submitStartedAt, { workId: interactiveTurn.performanceId, accepted });
      readerPerformanceMark('reader.native.submit', {
        workId: interactiveTurn.performanceId,
        nativeId: stockId,
        accepted,
        submittedAtMs,
      });
      sourcePicture?.release();
      targetPicture?.release();
      sourceChrome?.release();
      targetChrome?.release();
    }
    if (!accepted) {
      surfaceBinding.inputReady.set(false);
      return;
    }
    // Only the latest paint version is stocked. A -> B -> A must publish A
    // again rather than mistaking its earlier submission for current stock.
    submittedStockIdsRef.current.clear();
    submittedStockIdsRef.current.add(stockKey);
    surfaceBinding.stockedGestureToken.set(nativeGesture.token);
  }, [
    active,
    anchorKeyRef,
    canvasRef,
    createPicture,
    recordings,
    paintKey,
    createChromePicture,
    interactiveSource,
    interactiveTurn,
    paperColor,
    pageTurnEffect,
    pixelHeight,
    pixelWidth,
    submittedStockIdsRef,
    surfaceBinding,
  ]);
}
