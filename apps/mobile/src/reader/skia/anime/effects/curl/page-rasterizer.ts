import type { SharedValue } from 'react-native-reanimated';
import { Skia, type SkImage, type SkPicture, type SkSurface } from '@shopify/react-native-skia';
import { createWorkletRuntime, runOnRuntimeAsync, scheduleOnRN, type WorkletRuntime } from 'react-native-worklets';

export interface PageCaptureTiming {
  readonly queueMs: number;
  readonly rasterMs: number;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
}

let rasterRuntime: WorkletRuntime | undefined;

/** Android CPU images can cross runtimes without sharing a GPU context. */
export async function rasterizePageOnWorker(
  picture: SkPicture,
  width: number,
  height: number,
  scale: number,
  ownsPicture: boolean,
  queuedAtMs?: number,
): Promise<{ image: SkImage | null; timing?: PageCaptureTiming }> {
  let ownedPicture = ownsPicture ? picture : undefined;
  try {
    rasterRuntime ??= createWorkletRuntime({ name: 'lunar-reader-page-raster' });
    if (!ownedPicture) {
      // The runtime may evict a borrowed page while CPU raster work is queued.
      // This recording owns a native reference independent of that JS wrapper.
      const recorder = Skia.PictureRecorder();
      try {
        recorder.beginRecording(Skia.XYWHRect(0, 0, width, height)).drawPicture(picture);
        ownedPicture = recorder.finishRecordingAsPicture();
      } finally {
        recorder.dispose();
      }
    }
    return await runOnRuntimeAsync(rasterRuntime, rasterizePage, ownedPicture, width, height, scale, queuedAtMs);
  } catch {
    // Raster errors inside the worker return null. Rejection here means the
    // transfer failed; the submitting runtime still owns the recording.
    ownedPicture?.dispose();
    return { image: null };
  }
}

function rasterizePage(
  picture: SkPicture,
  width: number,
  height: number,
  scale: number,
  queuedAtMs?: number,
): { image: SkImage | null; timing?: PageCaptureTiming } {
  'worklet';
  const startedAtMs = queuedAtMs === undefined ? undefined : Date.now();
  let surface: ReturnType<typeof Skia.Surface.Make> = null;
  try {
    surface = Skia.Surface.Make(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    if (!surface) return { image: null };
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    canvas.scale(scale, scale);
    canvas.drawPicture(picture);
    surface.flush();
    const image = surface.makeImageSnapshot();
    const completedAtMs = startedAtMs === undefined ? undefined : Date.now();
    return {
      image,
      timing:
        startedAtMs === undefined
          ? undefined
          : {
              queueMs: Math.max(0, startedAtMs - queuedAtMs!),
              rasterMs: Math.max(0, completedAtMs! - startedAtMs),
              startedAtMs,
              completedAtMs: completedAtMs!,
            },
    };
  } catch {
    return { image: null };
  } finally {
    surface?.dispose();
    picture.dispose();
  }
}

export function installRasterTexture(
  texture: SharedValue<SkImage | null>,
  backingSurface: SharedValue<SkSurface | null>,
  generation: SharedValue<number>,
  captureId: number,
  textureIdentity: string,
  nextTexture: SkImage | null,
  onReady: (captureId: number, identity: string, ready: boolean, timing?: PageCaptureTiming) => void,
  timing?: PageCaptureTiming,
): void {
  'worklet';
  if (generation.value !== captureId) {
    nextTexture?.dispose();
    return;
  }
  if (nextTexture) {
    const previous = texture.value;
    texture.value = nextTexture;
    previous?.dispose();
    backingSurface.value?.dispose();
    backingSurface.value = null;
  }
  scheduleOnRN(onReady, captureId, textureIdentity, nextTexture !== null, timing);
}
