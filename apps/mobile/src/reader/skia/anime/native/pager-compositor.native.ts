// This module captures SkiaViewApi for UI-runtime worklets. A type-only Skia
// import does not run NativeSetup, so cold Android/iOS starts could cache an
// undefined API forever before the renderer's first value import executed.
import '@shopify/react-native-skia';

import type { SkImage, SkPicture } from '@shopify/react-native-skia';

import type {
  NativePagerCanvasHandle,
  NativePagerEventRecord,
  NativePagerGestureRelease,
  NativePagerGestureStart,
  NativePagerGestureUpdate,
  NativePagerMotionConfig,
  NativePagerPlanarMotionTuning,
  NativePagerPictureTurnCommand,
  NativePagerStockPictureCommand,
  NativePagerTurnCommand,
  NativePagerVisualKind,
} from './pager-compositor';

interface NativePagerSkiaViewApi {
  pagerProtocolVersion?: () => number;
  pagerReady?: (nativeId: number) => boolean;
  pagerPreload?: (nativeId: number, image: SkImage) => void;
  pagerEnqueue?: (
    nativeId: number,
    turnId: string,
    frontImage: SkImage,
    backImage: SkImage | null,
    direction: 1 | -1,
    spread: boolean,
    startAtMs: number,
    durationMs: number,
    launchIntervalMs: number,
    paperColor: number,
  ) => void;
  pagerEnqueuePicture?: (
    nativeId: number,
    turnId: string,
    frontPicture: SkPicture,
    backPicture: SkPicture | null,
    backgroundLeftPicture: SkPicture | null,
    backgroundRightPicture: SkPicture | null,
    pixelWidth: number,
    pixelHeight: number,
    direction: 1 | -1,
    spread: boolean,
    startAtMs: number,
    durationMs: number,
    launchIntervalMs: number,
    paperColor: number,
  ) => void;
  pagerSetAnchor?: (nativeId: number, pageKey: string) => void;
  pagerAcknowledgePresentation?: (nativeId: number, turnId: string) => void;
  pagerStockPicture?: (
    nativeId: number,
    entryId: string,
    fromPageKey: string,
    toPageKey: string,
    frontPageKey: string,
    backPageKey: string | null,
    backgroundLeftPageKey: string | null,
    backgroundRightPageKey: string | null,
    frontPicture: SkPicture,
    backPicture: SkPicture | null,
    backgroundLeftPicture: SkPicture | null,
    backgroundRightPicture: SkPicture | null,
    pixelWidth: number,
    pixelHeight: number,
    direction: 1 | -1,
    spread: boolean,
    contentRevision: number,
    durationMs: number,
    rapidDurationMs: number,
    launchIntervalMs: number,
    paperColor: number,
  ) => void;
  pagerSetInputEnabled?: (nativeId: number, enabled: boolean) => void;
  pagerConfigureMotion?: (
    nativeId: number,
    visualKind: number,
    fixedChromeTop: number,
    fixedChromeBottom: number,
    automaticForward: readonly number[],
    automaticBackward: readonly number[],
    rapidForward: readonly number[],
    rapidBackward: readonly number[],
    gestureForward: readonly number[],
    gestureBackward: readonly number[],
    planarMotion: readonly number[],
  ) => void;
  pagerConsumeInput?: (nativeId: number, direction: 1 | -1) => boolean;
  pagerTryConsumeInput?: (nativeId: number, direction: 1 | -1) => boolean;
  pagerBeginGesture?: (
    nativeId: number,
    direction: 1 | -1,
    startBookX: number,
    fingerX: number,
    turnProgress: number,
  ) => boolean;
  pagerUpdateGesture?: (nativeId: number, fingerX: number, turnProgress: number) => boolean;
  pagerEndGesture?: (
    nativeId: number,
    fingerX: number,
    pageWidth: number,
    throwVelocity: number,
    throwAcceleration: number,
    pageWeight: number,
    commitThreshold: number,
    slowCommitEdgeX: number,
    minimumSpeedScale: number,
    maximumSpeedScale: number,
    velocityGain: number,
    idleDecaySeconds: number,
    releaseProjectionSeconds: number,
  ) => boolean;
  pagerCancelGesture?: (nativeId: number) => boolean;
  pagerRunBenchmark?: (nativeId: number, count: number, intervalMs: number, direction: 1 | -1) => void;
  pagerTakeEvents?: (nativeId: number) => readonly NativePagerEventRecord[];
  pagerReset?: (nativeId: number) => void;
}

// Match Skia's own Reanimated container: capture the JSI HostObject from the
// RN runtime so Worklets can serialize the reference into the UI runtime.
// Looking it up through globalThis inside a strict worklet is not reliable.
const nativePagerWorkletApi = (
  globalThis as typeof globalThis & {
    SkiaViewApi?: NativePagerSkiaViewApi;
  }
).SkiaViewApi;

// Reading a method from SkiaViewApi creates a JSI HostFunction wrapper. Cache
// every RN-runtime method once instead of recreating wrappers on each render,
// stock entry, input event, and 16 ms event poll.
const nativePagerRnApi = {
  protocolVersion: nativePagerWorkletApi?.pagerProtocolVersion,
  ready: nativePagerWorkletApi?.pagerReady,
  preload: nativePagerWorkletApi?.pagerPreload,
  enqueue: nativePagerWorkletApi?.pagerEnqueue,
  enqueuePicture: nativePagerWorkletApi?.pagerEnqueuePicture,
  setAnchor: nativePagerWorkletApi?.pagerSetAnchor,
  acknowledgePresentation: nativePagerWorkletApi?.pagerAcknowledgePresentation,
  stockPicture: nativePagerWorkletApi?.pagerStockPicture,
  setInputEnabled: nativePagerWorkletApi?.pagerSetInputEnabled,
  configureMotion: nativePagerWorkletApi?.pagerConfigureMotion,
  consumeInput: nativePagerWorkletApi?.pagerConsumeInput,
  tryConsumeInput: nativePagerWorkletApi?.pagerTryConsumeInput,
  beginGesture: nativePagerWorkletApi?.pagerBeginGesture,
  updateGesture: nativePagerWorkletApi?.pagerUpdateGesture,
  endGesture: nativePagerWorkletApi?.pagerEndGesture,
  cancelGesture: nativePagerWorkletApi?.pagerCancelGesture,
  runBenchmark: nativePagerWorkletApi?.pagerRunBenchmark,
  takeEvents: nativePagerWorkletApi?.pagerTakeEvents,
  reset: nativePagerWorkletApi?.pagerReset,
};

let nativePagerAvailability: boolean | undefined;

export function nativePagerCompositorAvailable(): boolean {
  if (nativePagerAvailability !== undefined) {
    return nativePagerAvailability;
  }
  let protocolVersion = 0;
  try {
    protocolVersion = nativePagerRnApi.protocolVersion?.() ?? 0;
  } catch {
    nativePagerAvailability = false;
    return false;
  }
  nativePagerAvailability =
    protocolVersion >= 13 &&
    typeof nativePagerRnApi.ready === 'function' &&
    typeof nativePagerRnApi.enqueue === 'function' &&
    typeof nativePagerRnApi.enqueuePicture === 'function' &&
    typeof nativePagerRnApi.setAnchor === 'function' &&
    typeof nativePagerRnApi.acknowledgePresentation === 'function' &&
    typeof nativePagerRnApi.stockPicture === 'function' &&
    typeof nativePagerRnApi.setInputEnabled === 'function' &&
    typeof nativePagerRnApi.configureMotion === 'function' &&
    typeof nativePagerRnApi.consumeInput === 'function' &&
    typeof nativePagerRnApi.tryConsumeInput === 'function' &&
    typeof nativePagerRnApi.beginGesture === 'function' &&
    typeof nativePagerRnApi.updateGesture === 'function' &&
    typeof nativePagerRnApi.endGesture === 'function' &&
    typeof nativePagerRnApi.cancelGesture === 'function' &&
    typeof nativePagerRnApi.runBenchmark === 'function' &&
    typeof nativePagerRnApi.takeEvents === 'function' &&
    typeof nativePagerRnApi.reset === 'function';
  return nativePagerAvailability;
}

export function nativePagerCanvasReady(canvas: NativePagerCanvasHandle | null): boolean {
  const ready = nativePagerRnApi.ready;
  if (!canvas || !ready) {
    return false;
  }
  try {
    return ready(canvas.getNativeId());
  } catch {
    return false;
  }
}

export function enqueueNativePagerPictureTurn(
  canvas: NativePagerCanvasHandle | null,
  command: NativePagerPictureTurnCommand,
): boolean {
  const enqueuePicture = nativePagerRnApi.enqueuePicture;
  if (!canvas || !enqueuePicture) {
    return false;
  }
  try {
    enqueuePicture(
      canvas.getNativeId(),
      command.id,
      command.frontPicture,
      command.backPicture ?? null,
      command.backgroundLeftPicture ?? null,
      command.backgroundRightPicture ?? null,
      command.pixelWidth,
      command.pixelHeight,
      command.direction,
      command.spread,
      command.startAtMs,
      command.durationMs,
      command.launchIntervalMs,
      command.paperColor,
    );
    return true;
  } catch {
    return false;
  }
}

export function enqueueNativePagerTurn(
  canvas: NativePagerCanvasHandle | null,
  command: NativePagerTurnCommand,
): boolean {
  const enqueue = nativePagerRnApi.enqueue;
  if (!canvas || !enqueue) {
    return false;
  }
  try {
    enqueue(
      canvas.getNativeId(),
      command.id,
      command.frontImage,
      command.backImage ?? null,
      command.direction,
      command.spread,
      command.startAtMs,
      command.durationMs,
      command.launchIntervalMs,
      command.paperColor,
    );
    return true;
  } catch {
    return false;
  }
}

export function preloadNativePagerImage(canvas: NativePagerCanvasHandle | null, image: SkImage): boolean {
  const preload = nativePagerRnApi.preload;
  if (!canvas || !preload) {
    return false;
  }
  try {
    preload(canvas.getNativeId(), image);
    return true;
  } catch {
    return false;
  }
}

export function setNativePagerAnchor(canvas: NativePagerCanvasHandle | null, pageKey: string): boolean {
  const setAnchor = nativePagerRnApi.setAnchor;
  if (!canvas || !setAnchor) {
    return false;
  }
  try {
    setAnchor(canvas.getNativeId(), pageKey);
    return true;
  } catch {
    return false;
  }
}

export function acknowledgeNativePagerPresentation(canvas: NativePagerCanvasHandle | null, turnId: string): boolean {
  const acknowledgePresentation = nativePagerRnApi.acknowledgePresentation;
  if (!canvas || !acknowledgePresentation || !turnId) {
    return false;
  }
  try {
    acknowledgePresentation(canvas.getNativeId(), turnId);
    return true;
  } catch {
    return false;
  }
}

export function acknowledgeNativePagerPresentationById(nativeId: number, turnId: string): boolean {
  const acknowledgePresentation = nativePagerRnApi.acknowledgePresentation;
  if (nativeId < 0 || !acknowledgePresentation || !turnId) {
    return false;
  }
  try {
    acknowledgePresentation(nativeId, turnId);
    return true;
  } catch {
    return false;
  }
}

export function stockNativePagerPicture(
  canvas: NativePagerCanvasHandle | null,
  command: NativePagerStockPictureCommand,
): boolean {
  const stockPicture = nativePagerRnApi.stockPicture;
  if (!canvas || !stockPicture) {
    return false;
  }
  try {
    stockPicture(
      canvas.getNativeId(),
      command.id,
      command.fromPageKey,
      command.toPageKey,
      command.frontPageKey,
      command.backPageKey ?? null,
      command.backgroundLeftPageKey ?? null,
      command.backgroundRightPageKey ?? null,
      command.frontPicture,
      command.backPicture ?? null,
      command.backgroundLeftPicture ?? null,
      command.backgroundRightPicture ?? null,
      command.pixelWidth,
      command.pixelHeight,
      command.direction,
      command.spread,
      command.contentRevision,
      command.durationMs,
      command.rapidDurationMs,
      command.launchIntervalMs,
      command.paperColor,
    );
    return true;
  } catch {
    return false;
  }
}

export function configureNativePagerInput(canvas: NativePagerCanvasHandle | null, enabled: boolean): boolean {
  const setInputEnabled = nativePagerRnApi.setInputEnabled;
  if (!canvas || !setInputEnabled) {
    return false;
  }
  try {
    setInputEnabled(canvas.getNativeId(), enabled);
    return true;
  } catch {
    return false;
  }
}

export function configureNativePagerMotion(
  canvas: NativePagerCanvasHandle | null,
  visualKind: NativePagerVisualKind,
  fixedChromeTop: number,
  fixedChromeBottom: number,
  config: NativePagerMotionConfig,
  planarMotion?: NativePagerPlanarMotionTuning,
): boolean {
  const configureMotion = nativePagerRnApi.configureMotion;
  if (!canvas || !configureMotion) {
    return false;
  }
  try {
    configureMotion(
      canvas.getNativeId(),
      visualKind === 'slide' ? 1 : 0,
      fixedChromeTop,
      fixedChromeBottom,
      motionTuningValues(config.automatic.forward),
      motionTuningValues(config.automatic.backward),
      motionTuningValues(config.rapid.forward),
      motionTuningValues(config.rapid.backward),
      motionTuningValues(config.gesture.forward),
      motionTuningValues(config.gesture.backward),
      planarMotionTuningValues(planarMotion),
    );
    return true;
  } catch {
    return false;
  }
}

function planarMotionTuningValues(tuning?: NativePagerPlanarMotionTuning): [number, number, number, number, number] {
  return [
    tuning?.minimumReleaseSpeedPxPerMs ?? 0.2,
    tuning?.maximumReleaseSpeedPxPerMs ?? 1,
    tuning?.maximumPlaybackRate ?? 2,
    tuning?.minimumBoostedSettleMs ?? 90,
    tuning?.maximumEaseOutBlend ?? 1 / 3,
  ];
}

function motionTuningValues(
  tuning: NativePagerMotionConfig['automatic']['forward'],
): [number, number, number, number, number, number, number, number, number, number, number, number] {
  return [
    tuning.releaseX,
    tuning.liftVelocity,
    tuning.liftToLeft,
    tuning.curvatureRelaxation,
    tuning.incomingLandingStartProgress ?? 0.3,
    tuning.incomingRevealStartProgress ?? 0,
    tuning.incomingRevealEndProgress ?? 0.28,
    tuning.incomingDragProgressScale ?? 1,
    tuning.incomingDragProgressExponent ?? 1,
    tuning.incomingSettleDurationSeconds ?? 0.52,
    tuning.incomingSettleEasingPower ?? 2,
    tuning.incomingRevertDurationSeconds ?? 0.72,
  ];
}

export function consumeNativePagerInputOnUI(nativeId: number, direction: 1 | -1): boolean | undefined {
  'worklet';
  try {
    return nativePagerWorkletApi?.pagerConsumeInput?.(nativeId, direction);
  } catch {
    return undefined;
  }
}

/**
 * Consumes a stocked page immediately or rejects this cadence tick. Unlike a
 * real tap, a held riffle must never queue work that can outlive the finger.
 */
export function tryConsumeNativePagerInputOnUI(nativeId: number, direction: 1 | -1): boolean | undefined {
  'worklet';
  try {
    return nativePagerWorkletApi?.pagerTryConsumeInput?.(nativeId, direction);
  } catch {
    return undefined;
  }
}

export function beginNativePagerGestureOnUI(nativeId: number, start: NativePagerGestureStart): boolean | undefined {
  'worklet';
  try {
    return nativePagerWorkletApi?.pagerBeginGesture?.(
      nativeId,
      start.direction,
      start.startBookX,
      start.fingerX,
      start.turnProgress,
    );
  } catch {
    return undefined;
  }
}

export function updateNativePagerGestureOnUI(nativeId: number, update: NativePagerGestureUpdate): boolean | undefined {
  'worklet';
  try {
    return nativePagerWorkletApi?.pagerUpdateGesture?.(nativeId, update.fingerX, update.turnProgress);
  } catch {
    return undefined;
  }
}

export function endNativePagerGestureOnUI(nativeId: number, release: NativePagerGestureRelease): boolean | undefined {
  'worklet';
  try {
    return nativePagerWorkletApi?.pagerEndGesture?.(
      nativeId,
      release.fingerX,
      release.pageWidth,
      release.throwVelocity,
      release.throwAcceleration,
      release.pageWeight,
      release.commitThreshold,
      release.slowCommitEdgeX,
      release.minimumSpeedScale,
      release.maximumSpeedScale,
      release.velocityGain,
      release.idleDecaySeconds,
      release.releaseProjectionSeconds,
    );
  } catch {
    return undefined;
  }
}

export function cancelNativePagerGestureOnUI(nativeId: number): boolean | undefined {
  'worklet';
  try {
    return nativePagerWorkletApi?.pagerCancelGesture?.(nativeId);
  } catch {
    return undefined;
  }
}

export function runNativePagerBenchmark(
  canvas: NativePagerCanvasHandle | null,
  count: number,
  intervalMs: number,
  direction: 1 | -1,
): boolean {
  const runBenchmark = nativePagerRnApi.runBenchmark;
  if (!canvas || !runBenchmark) {
    return false;
  }
  try {
    runBenchmark(canvas.getNativeId(), count, intervalMs, direction);
    return true;
  } catch {
    return false;
  }
}

export function takeNativePagerEvents(canvas: NativePagerCanvasHandle | null): readonly NativePagerEventRecord[] {
  const takeEvents = nativePagerRnApi.takeEvents;
  if (!canvas || !takeEvents) {
    return [];
  }
  try {
    return takeEvents(canvas.getNativeId());
  } catch {
    return [];
  }
}

export function resetNativePagerCompositor(canvas: NativePagerCanvasHandle | null): void {
  const reset = nativePagerRnApi.reset;
  if (canvas && reset) {
    try {
      reset(canvas.getNativeId());
    } catch {
      // The Fabric view may already be unregistered during teardown.
    }
  }
}
