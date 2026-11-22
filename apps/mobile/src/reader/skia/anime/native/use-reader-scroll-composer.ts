import type { SkPicture } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { runOnUI } from 'react-native-worklets';

import type { ReaderPageContent } from '../core/page-turn-types';
import type { ReaderScrollWindowContent } from '../scroll/reader-scroll-coordinator';
import type { ReaderScrollSurfaceBinding } from '../scroll/use-reader-scroll';
import { NativePageRecordingCache, type NativePageRecording } from './page-recording-cache';
import { nativeScrollTextureKey } from './page-texture-key';
import {
  nativePagerCanvasReady,
  nativePagerCompositorAvailable,
  resetNativePagerCompositor,
  setNativePagerStrip,
  setNativePagerStripOffsetOnUI,
  type NativePagerCanvasHandle,
  type NativePagerStripWindow,
} from './pager-compositor';

export interface ReaderScrollComposerOptions {
  readonly canvasRef: RefObject<NativePagerCanvasHandle | null>;
  readonly binding: ReaderScrollSurfaceBinding;
  readonly windows: readonly ReaderScrollWindowContent[];
  /** Records a window's whole page, its overlays included, at the composer's pixel size. */
  readonly recordPage: (content: ReaderPageContent) => SkPicture;
  /** Every recording input besides the page itself: geometry, fonts, colors. */
  readonly paintKey: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly paperColor: number;
}

/**
 * Hands a scrolled reader's windows to the native composer as one strip. The
 * composer draws the strip at the offset the scroll gesture sets on the UI
 * thread; this side only replaces the windows when the strip gains or loses
 * one.
 */
export function useReaderScrollComposer({
  canvasRef,
  binding,
  windows,
  recordPage,
  paintKey,
  pixelWidth,
  pixelHeight,
  paperColor,
}: ReaderScrollComposerOptions): { readonly showing: boolean } {
  const recordings = useMemo(() => new NativePageRecordingCache(12, 192 * 1024 * 1024), []);
  useEffect(() => () => recordings.clear(), [recordings, paintKey]);
  const available = useMemo(() => nativePagerCompositorAvailable(), []);
  const [ready, setReady] = useState(false);
  const [showing, setShowing] = useState(false);
  const { nativePagerId, values } = binding;

  // Wait for the Canvas to register with the composer.
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    let frame = 0;
    let registered: NativePagerCanvasHandle | null = null;
    const probe = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (canvas && nativePagerCanvasReady(canvas)) {
        registered = canvas;
        const id = canvas.getNativeId();
        nativePagerId.set(id);
        runOnUI((nativeId: number) => {
          'worklet';
          setNativePagerStripOffsetOnUI(nativeId, values.offset.value);
        })(id);
        setReady(true);
        return;
      }
      frame = requestAnimationFrame(probe);
    };
    probe();
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      nativePagerId.set(-1);
      if (registered) resetNativePagerCompositor(registered);
      setReady(false);
      setShowing(false);
    };
  }, [available, canvasRef, nativePagerId, values]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || !canvas || pixelWidth <= 0 || pixelHeight <= 0) return;
    const held: NativePageRecording[] = [];
    const bytes = pixelWidth * pixelHeight * 4;
    try {
      const strip: NativePagerStripWindow[] = windows.map((window) => {
        const textureKey = nativeScrollTextureKey(window.content, paintKey);
        const recording = recordings.acquire(textureKey, recordPage, window.content, bytes);
        held.push(recording);
        return {
          top: window.top,
          length: window.length,
          page: {
            pageKey: window.key,
            textureKey,
            picture: recording.picture,
            pixelWidth,
            pixelHeight,
            spread: false,
            paperColor,
          },
        };
      });
      setShowing(setNativePagerStrip(canvas, strip) && strip.length > 0);
    } catch {
      setShowing(false);
    } finally {
      for (const recording of held) recording.release();
    }
  }, [canvasRef, paintKey, paperColor, pixelHeight, pixelWidth, ready, recordPage, recordings, windows]);

  return { showing: ready && showing };
}
