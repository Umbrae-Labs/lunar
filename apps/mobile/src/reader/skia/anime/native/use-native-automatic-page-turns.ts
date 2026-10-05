import type { CanvasRef, SkPicture } from '@shopify/react-native-skia';
import { useEffect, type RefObject } from 'react';

import { AUTOMATIC_PAGE_TURN_START_INTERVAL_MS } from '../core/page-turn-concurrency';
import type { ReaderPageTurnEffect } from '../core/page-turn-effect';
import type { ReaderAutomaticTurn, ReaderPageContent } from '../core/page-turn-types';
import { nativeAutomaticPageTurnFaces, nativeAutomaticPageTurnId } from './page-turn';
import { enqueueNativePagerPictureTurn } from './pager-compositor';
import {
  acquireNativePageRecording,
  type NativePageRecording,
  type NativePageRecordingCache,
} from './page-recording-cache';
import { readerPerformanceEnd, readerPerformanceMark, readerPerformanceStart } from '../../../runtime/core/performance';

interface NativeAutomaticPageTurnsOptions {
  readonly active: boolean;
  readonly canvasRef: RefObject<CanvasRef | null>;
  readonly createPicture: (content: ReaderPageContent) => SkPicture;
  readonly recordings?: NativePageRecordingCache;
  readonly paintKey?: string;
  readonly createChromePicture?: (content: ReaderPageContent) => SkPicture;
  readonly paperColor: number;
  readonly pixelHeight: number;
  readonly pixelWidth: number;
  readonly submittedTurnIds: RefObject<Set<number>>;
  readonly turns: readonly ReaderAutomaticTurn[];
  readonly onRejected: () => void;
  readonly pageTurnEffect: ReaderPageTurnEffect;
}

export function useNativeAutomaticPageTurnSubmission({
  active,
  canvasRef,
  createPicture,
  createChromePicture,
  recordings,
  paintKey,
  paperColor,
  pixelHeight,
  pixelWidth,
  submittedTurnIds,
  turns,
  onRejected,
  pageTurnEffect,
}: NativeAutomaticPageTurnsOptions): void {
  useEffect(() => {
    if (!active || turns.length === 0 || pixelWidth <= 0 || pixelHeight <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    for (const turn of turns) {
      if (submittedTurnIds.current.has(turn.id)) continue;
      const faces = nativeAutomaticPageTurnFaces(turn);
      let frontPicture: NativePageRecording | undefined;
      let backgroundPicture: NativePageRecording | undefined;
      let sourceChrome: NativePageRecording | undefined;
      let targetChrome: NativePageRecording | undefined;
      let accepted = false;
      const recordStartedAt = readerPerformanceStart();
      let submitStartedAt: number | undefined;
      let submittedAtMs: number | undefined;
      try {
        frontPicture = acquireNativePageRecording(
          recordings,
          createPicture,
          faces.front,
          'page',
          paintKey,
          pixelWidth,
          pixelHeight,
        );
        backgroundPicture = acquireNativePageRecording(
          recordings,
          createPicture,
          faces.background,
          'page',
          paintKey,
          pixelWidth,
          pixelHeight,
        );
        sourceChrome = createChromePicture
          ? acquireNativePageRecording(
              recordings,
              createChromePicture,
              turn.from,
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
              turn.to,
              'chrome',
              paintKey,
              pixelWidth,
              pixelHeight,
            )
          : undefined;
        readerPerformanceEnd('reader.native.record', recordStartedAt, {
          workId: turn.performanceId,
          pixelWidth,
          pixelHeight,
          turnId: turn.id,
        });
        submitStartedAt = readerPerformanceStart();
        submittedAtMs = submitStartedAt === undefined ? undefined : Date.now();
        accepted = enqueueNativePagerPictureTurn(canvas, {
          id: nativeAutomaticPageTurnId(turn.id),
          frontPicture: frontPicture.picture,
          backgroundLeftPicture: backgroundPicture.picture,
          // Protocol 13: single-page planar turns use these two otherwise
          // unused faces for transparent source/target fixed chrome.
          backPicture: sourceChrome?.picture,
          backgroundRightPicture: targetChrome?.picture,
          pixelWidth,
          pixelHeight,
          direction: turn.direction,
          spread: false,
          startAtMs: Date.now(),
          durationMs: pageTurnEffect.motion.getDuration({
            releaseVelocity: 0,
            animationDuration: 360,
            incomingPageLanding: turn.direction < 0,
          }),
          launchIntervalMs: AUTOMATIC_PAGE_TURN_START_INTERVAL_MS,
          paperColor,
        });
      } catch {
        accepted = false;
      } finally {
        readerPerformanceEnd('reader.native.enqueue', submitStartedAt, { workId: turn.performanceId, accepted });
        readerPerformanceMark('reader.native.submit', {
          workId: turn.performanceId,
          nativeId: nativeAutomaticPageTurnId(turn.id),
          accepted,
          submittedAtMs,
        });
        frontPicture?.release();
        backgroundPicture?.release();
        sourceChrome?.release();
        targetChrome?.release();
      }
      if (!accepted) {
        onRejected();
        return;
      }
      submittedTurnIds.current.add(turn.id);
    }
  }, [
    active,
    canvasRef,
    createPicture,
    recordings,
    paintKey,
    createChromePicture,
    onRejected,
    pageTurnEffect,
    paperColor,
    pixelHeight,
    pixelWidth,
    submittedTurnIds,
    turns,
  ]);
}
