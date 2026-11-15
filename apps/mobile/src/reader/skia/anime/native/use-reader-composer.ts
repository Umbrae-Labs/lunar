import type { CanvasRef, SkPicture } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated';

import {
  readerPerformanceActivity,
  readerPerformanceEnd,
  readerPerformanceMark,
  readerPerformanceStart,
} from '../../../runtime/core/performance';
import type { ReaderPageTurnStock } from '../controller/page-turn-store';
import { AUTOMATIC_PAGE_TURN_START_INTERVAL_MS } from '../core/page-turn-concurrency';
import type { ReaderPageTurnEffect } from '../core/page-turn-effect';
import type { ReaderPageContent } from '../core/page-turn-types';
import { nativeInteractivePageTurnStockId } from './page-turn';
import type { ReaderPageTurnSurfaceBinding } from './page-turn-binding';
import { NativePageRecordingCache, type NativePageRecording } from './page-recording-cache';
import { nativePageTextureKey } from './page-texture-key';
import {
  configureNativePagerInput,
  configureNativePagerMotion,
  nativePagerCanvasReady,
  nativePagerCompositorAvailable,
  presentNativePagerPage,
  resetNativePagerCompositor,
  setNativePagerRestingOffsetOnUI,
  stockNativePagerPicture,
  takeNativePagerEvents,
  type NativePagerPage,
} from './pager-compositor';

export type ReaderComposerLayer = 'all' | 'page' | 'chrome';

interface ReaderComposerOptions {
  readonly canvasRef: RefObject<CanvasRef | null>;
  readonly binding?: ReaderPageTurnSurfaceBinding;
  readonly pageTurnEffect: ReaderPageTurnEffect;
  readonly spread: boolean;
  /** The page the subscriber shows; the composer presents it. */
  readonly currentContent?: ReaderPageContent;
  /** Pairs the composer may turn by itself, decorated as the surface paints them. */
  readonly stocks: readonly ReaderPageTurnStock[];
  /** Records a page at the composer's pixel size, in the given layer. */
  readonly recordPage: (content: ReaderPageContent, layer: ReaderComposerLayer) => SkPicture;
  /** Every recording input besides the page itself: geometry, fonts, colors. */
  readonly paintKey: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly paperColor: number;
  readonly animationDuration: number;
  readonly fixedChromeTop: number;
  readonly fixedChromeBottom: number;
  /** A bookmark pull moves the resting page down by this distance. */
  readonly pullDistance?: SharedValue<number>;
  readonly revealColor: number;
}

export interface ReaderComposerState {
  /** The composer shows a page: nothing else may paint one under the Canvas. */
  readonly showing: boolean;
}

/**
 * Hands the reader's pages to the native composer, which alone presents
 * them: the page the runtime shows, the pairs it may turn to by itself, and
 * the pull offset. Reads the composer's events while anything native moves.
 */
export function useReaderComposer({
  canvasRef,
  binding,
  pageTurnEffect,
  spread,
  currentContent,
  stocks,
  recordPage,
  paintKey,
  pixelWidth,
  pixelHeight,
  paperColor,
  animationDuration,
  fixedChromeTop,
  fixedChromeBottom,
  pullDistance,
  revealColor,
}: ReaderComposerOptions): ReaderComposerState {
  const recordings = useMemo(() => new NativePageRecordingCache(24, 256 * 1024 * 1024), []);
  useEffect(() => () => recordings.clear(), [recordings, paintKey]);
  const available = useMemo(() => nativePagerCompositorAvailable(), []);
  const native = pageTurnEffect.native;
  const separateChrome = native?.separateChrome === true && !spread;
  const configKey = `${native?.visualKind ?? 'none'}:${fixedChromeTop}:${fixedChromeBottom}`;
  const [configuredKey, setConfiguredKey] = useState<string>();
  const ready = available && configuredKey === configKey;
  const [showing, setShowing] = useState(false);
  const presentedEpoch = useRef<number | undefined>(undefined);
  const paintRevision = useRef(0);
  const submittedStocks = useRef(new Set<string>());
  const store = binding?.store;
  const [presentEpoch, setPresentEpoch] = useState(() => store?.getState().presentEpoch ?? 0);
  const [eventsActive, setEventsActive] = useState(() => store?.getState().composerEventsActive ?? false);
  const [stockPaused, setStockPaused] = useState(() => store?.getState().nativeGestureDriven ?? false);

  useEffect(() => {
    if (!store) return;
    const sync = () => {
      const state = store.getState();
      setPresentEpoch(state.presentEpoch);
      setEventsActive(state.composerEventsActive);
      setStockPaused(state.nativeGestureDriven);
    };
    sync();
    return store.subscribe(sync);
  }, [store]);

  // Wait for the Canvas to register with the composer, then configure it.
  useEffect(() => {
    if (!available || configuredKey === configKey) return;
    let cancelled = false;
    let frame = 0;
    const probe = () => {
      if (cancelled) return;
      readerPerformanceActivity('native.ready-probe');
      const canvas = canvasRef.current;
      if (
        canvas &&
        nativePagerCanvasReady(canvas) &&
        (!native ||
          configureNativePagerMotion(
            canvas,
            native.visualKind,
            fixedChromeTop,
            fixedChromeBottom,
            native.motion,
            native.planarMotion,
          ))
      ) {
        setConfiguredKey(configKey);
        return;
      }
      frame = requestAnimationFrame(probe);
    };
    probe();
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [available, canvasRef, configKey, configuredKey, fixedChromeBottom, fixedChromeTop, native]);

  // Input targets the composer only while it is ready.
  useEffect(() => {
    const values = binding?.values;
    const canvas = canvasRef.current;
    if (!ready || !canvas) {
      values?.nativePagerId.set(-1);
      values?.nativeInputReady.set(false);
      return;
    }
    const submitted = submittedStocks.current;
    values?.nativePagerId.set(canvas.getNativeId());
    values?.nativeInputReady.set(native !== undefined && configureNativePagerInput(canvas, true));
    return () => {
      configureNativePagerInput(canvas, false);
      resetNativePagerCompositor(canvas);
      submitted.clear();
      presentedEpoch.current = undefined;
      setShowing(false);
      values?.nativePagerId.set(-1);
      values?.nativeInputReady.set(false);
      binding?.onStockLost();
    };
  }, [binding, canvasRef, native, ready]);

  // One recorder per layer: the recording cache re-records when its recorder changes.
  const recorders = useMemo(
    () => ({
      all: (content: ReaderPageContent) => recordPage(content, 'all'),
      page: (content: ReaderPageContent) => recordPage(content, 'page'),
      chrome: (content: ReaderPageContent) => recordPage(content, 'chrome'),
    }),
    [recordPage],
  );

  const pageOf = (content: ReaderPageContent, held: NativePageRecording[]): NativePagerPage => {
    const layer: ReaderComposerLayer = separateChrome ? 'page' : 'all';
    const acquire = (page: ReaderPageContent, pageLayer: ReaderComposerLayer, bytes: number) => {
      const recording = recordings.acquire(
        nativePageTextureKey(page, 'page', `${paintKey}:${pageLayer}`),
        recorders[pageLayer],
        page,
        bytes,
      );
      held.push(recording);
      return recording.picture;
    };
    const pageBytes = pixelWidth * pixelHeight * 4;
    return {
      pageKey: content.key,
      textureKey: nativePageTextureKey(content, 'page', `${paintKey}:${layer}`),
      picture: acquire(content, layer, pageBytes),
      chromePicture: separateChrome ? acquire(content, 'chrome', pageBytes / 16) : undefined,
      pullPicture: content.bookmarked ? acquire({ ...content, bookmarked: false }, layer, pageBytes) : undefined,
      pixelWidth,
      pixelHeight,
      spread,
      paperColor,
    };
  };

  // Present the page the subscriber shows. A turn the coordinator announced
  // for it plays from the shown page; a forced present re-anchors a composer
  // that led where the runtime could not follow.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || !canvas || !currentContent || pixelWidth <= 0 || pixelHeight <= 0) return;
    const force = presentedEpoch.current !== undefined && presentedEpoch.current !== presentEpoch;
    const transition = binding?.takeTurnIntent(currentContent.key) ?? 0;
    const held: NativePageRecording[] = [];
    const startedAt = readerPerformanceStart();
    let presented = false;
    try {
      presented = presentNativePagerPage(canvas, {
        page: pageOf(currentContent, held),
        transition: native ? transition : 0,
        durationMs: pageTurnEffect.motion.getDuration({
          releaseVelocity: 0,
          animationDuration,
          incomingPageLanding: pageTurnEffect.visual.isIncomingPageLanding(
            transition < 0 ? -1 : 1,
            spread ? 'double' : 'single',
          ),
        }),
        launchIntervalMs: AUTOMATIC_PAGE_TURN_START_INTERVAL_MS,
        force,
      });
    } catch {
      presented = false;
    } finally {
      for (const recording of held) recording.release();
    }
    readerPerformanceEnd('reader.native.present', startedAt, {
      page: currentContent.key,
      transition,
      force,
      presented,
    });
    if (!presented) return;
    presentedEpoch.current = presentEpoch;
    setShowing(true);
    // pageOf reads the recording inputs listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    animationDuration,
    binding,
    canvasRef,
    currentContent,
    paintKey,
    paperColor,
    pixelHeight,
    pixelWidth,
    presentEpoch,
    ready,
    recorders,
    separateChrome,
    spread,
  ]);

  // Hand the composer the pairs it may turn by itself, one a frame: recording
  // replays a whole page through Skia's JS bindings, and an idle refill must
  // not cost a drag a frame.
  useEffect(() => {
    if (!ready || !binding || !native || stocks.length === 0 || stockPaused || pixelWidth <= 0 || pixelHeight <= 0) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stockKeyOf = (stock: ReaderPageTurnStock) =>
      JSON.stringify([
        stock.token,
        stock.preparedTurnId,
        nativePageTextureKey(stock.source, 'page', paintKey),
        nativePageTextureKey(stock.target, 'page', paintKey),
      ]);
    const liveKeys = new Set(stocks.map(stockKeyOf));
    for (const key of submittedStocks.current) {
      if (!liveKeys.has(key)) submittedStocks.current.delete(key);
    }
    const submit = (stock: ReaderPageTurnStock): boolean => {
      const held: NativePageRecording[] = [];
      const startedAt = readerPerformanceStart();
      let accepted = false;
      try {
        accepted = stockNativePagerPicture(canvas, {
          id: nativeInteractivePageTurnStockId(stock.token, stock.preparedTurnId, ++paintRevision.current),
          source: pageOf(stock.source, held),
          target: pageOf(stock.target, held),
          direction: stock.direction,
          durationMs: pageTurnEffect.motion.getDuration({
            releaseVelocity: 0,
            animationDuration,
            incomingPageLanding: pageTurnEffect.visual.isIncomingPageLanding(
              stock.direction,
              spread ? 'double' : 'single',
            ),
          }),
          rapidDurationMs: pageTurnEffect.motion.getDuration({
            releaseVelocity: 0,
            animationDuration,
            incomingPageLanding: false,
          }),
          launchIntervalMs: AUTOMATIC_PAGE_TURN_START_INTERVAL_MS,
        });
      } catch {
        accepted = false;
      } finally {
        for (const recording of held) recording.release();
      }
      readerPerformanceEnd('reader.native.stock', startedAt, { workId: stock.performanceId, accepted });
      readerPerformanceMark('reader.native.submit', { workId: stock.performanceId, accepted });
      return accepted;
    };

    let cancelled = false;
    let frame: number | undefined;
    let index = 0;
    const submitNext = () => {
      frame = undefined;
      while (!cancelled && index < stocks.length) {
        const stock = stocks[index++]!;
        const key = stockKeyOf(stock);
        if (submittedStocks.current.has(key)) {
          binding.onStocked(stock.token);
          continue;
        }
        if (!submit(stock)) return;
        submittedStocks.current.add(key);
        binding.onStocked(stock.token);
        break;
      }
      if (!cancelled && index < stocks.length) frame = requestAnimationFrame(submitNext);
    };
    submitNext();
    return () => {
      cancelled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
    // pageOf reads the recording inputs listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    animationDuration,
    binding,
    canvasRef,
    native,
    paintKey,
    paperColor,
    pixelHeight,
    pixelWidth,
    ready,
    recorders,
    separateChrome,
    spread,
    stockPaused,
    stocks,
  ]);

  // Read the composer's events while it moves on its own.
  const onNativeEvent = binding?.onNativeEvent;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || !eventsActive || !canvas || !onNativeEvent) return;
    const drain = () => {
      for (const event of takeNativePagerEvents(canvas)) {
        readerPerformanceMark('reader.native.event', {
          nativeId: event.id,
          event: event.event,
          nativeAtMs: event.eventAtMs,
          deliveryDelayMs: Math.max(0, Date.now() - event.eventAtMs),
        });
        onNativeEvent(event);
      }
    };
    drain();
    const timer = setInterval(drain, 16);
    return () => {
      clearInterval(timer);
      drain();
    };
  }, [canvasRef, eventsActive, onNativeEvent, ready]);

  // A bookmark pull moves the resting page on the UI thread.
  const nativePagerId = binding?.values.nativePagerId;
  useAnimatedReaction(
    () => (pullDistance ? pullDistance.value : 0),
    (distance, previous) => {
      if (!nativePagerId || distance === previous) return;
      setNativePagerRestingOffsetOnUI(nativePagerId.value, distance, revealColor);
    },
    [nativePagerId, pullDistance, revealColor],
  );

  return { showing: ready && showing };
}
