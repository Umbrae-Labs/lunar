// This module captures ReaderComposerApi for UI-runtime worklets. Skia installs
// it with its own bindings (modules/reader-composer), and a type-only Skia
// import does not run NativeSetup, so cold Android/iOS starts could cache an
// undefined API forever before the renderer's first value import executed.
import '@shopify/react-native-skia';

import type {
  NativePagerCanvasHandle,
  NativePagerEventRecord,
  NativePagerGestureRelease,
  NativePagerGestureStart,
  NativePagerGestureUpdate,
  NativePagerMotionConfig,
  NativePagerPage,
  NativePagerPlanarMotionTuning,
  NativePagerPresentCommand,
  NativePagerStockCommand,
  NativePagerStripWindow,
  NativePagerVisualKind,
} from './pager-compositor';

interface ReaderComposerNativeApi {
  pagerProtocolVersion?: () => number;
  pagerReady?: (nativeId: number) => boolean;
  pagerPresent?: (
    nativeId: number,
    page: NativePagerPage,
    transition: number,
    durationMs: number,
    launchIntervalMs: number,
    force: boolean,
  ) => boolean;
  pagerStockPicture?: (
    nativeId: number,
    id: string,
    source: NativePagerPage,
    target: NativePagerPage,
    direction: 1 | -1,
    durationMs: number,
    rapidDurationMs: number,
    launchIntervalMs: number,
  ) => boolean;
  pagerSetRestingOffset?: (nativeId: number, offset: number, revealColor: number) => void;
  pagerSetStrip?: (nativeId: number, windows: readonly NativePagerStripWindow[]) => boolean;
  pagerSetStripOffset?: (nativeId: number, offset: number) => void;
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
    ReaderComposerApi?: ReaderComposerNativeApi;
  }
).ReaderComposerApi;

// Reading a method from ReaderComposerApi creates a JSI HostFunction wrapper. Cache
// every RN-runtime method once instead of recreating wrappers on each render,
// stock entry, input event, and 16 ms event poll.
const nativePagerRnApi = {
  protocolVersion: nativePagerWorkletApi?.pagerProtocolVersion,
  ready: nativePagerWorkletApi?.pagerReady,
  present: nativePagerWorkletApi?.pagerPresent,
  stockPicture: nativePagerWorkletApi?.pagerStockPicture,
  setStrip: nativePagerWorkletApi?.pagerSetStrip,
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

/** The composer protocol this adapter speaks; see modules/reader-composer. */
const NATIVE_PAGER_PROTOCOL_VERSION = 16;

let nativePagerAvailability: boolean | undefined;

export function nativePagerCompositorAvailable(): boolean {
  if (nativePagerAvailability !== undefined) {
    return nativePagerAvailability;
  }
  let protocolVersion = 0;
  try {
    protocolVersion = nativePagerRnApi.protocolVersion?.() ?? 0;
  } catch {
    protocolVersion = -1;
  }
  nativePagerAvailability =
    protocolVersion >= NATIVE_PAGER_PROTOCOL_VERSION &&
    typeof nativePagerRnApi.ready === 'function' &&
    typeof nativePagerRnApi.present === 'function' &&
    typeof nativePagerRnApi.stockPicture === 'function' &&
    typeof nativePagerWorkletApi?.pagerSetRestingOffset === 'function' &&
    typeof nativePagerRnApi.setStrip === 'function' &&
    typeof nativePagerWorkletApi?.pagerSetStripOffset === 'function' &&
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
  if (!nativePagerAvailability && __DEV__) {
    // The reader has no other renderer: without the composer it shows bare paper.
    // A JS bundle newer than the installed native build is the usual cause.
    console.warn(
      `[reader-composer] unavailable: native protocol ${protocolVersion}, JS expects ${NATIVE_PAGER_PROTOCOL_VERSION}. ` +
        'Rebuild and reinstall the native app (development client included) from this commit.',
    );
  }
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

/** Shows `page` as the runtime's page; false when the composer was unavailable. */
export function presentNativePagerPage(
  canvas: NativePagerCanvasHandle | null,
  command: NativePagerPresentCommand,
): boolean {
  const present = nativePagerRnApi.present;
  if (!canvas || !present) {
    return false;
  }
  try {
    return (
      present(
        canvas.getNativeId(),
        command.page,
        command.transition,
        command.durationMs,
        command.launchIntervalMs,
        command.force,
      ) === true
    );
  } catch {
    return false;
  }
}

export function stockNativePagerPicture(
  canvas: NativePagerCanvasHandle | null,
  command: NativePagerStockCommand,
): boolean {
  const stockPicture = nativePagerRnApi.stockPicture;
  if (!canvas || !stockPicture) {
    return false;
  }
  try {
    return (
      stockPicture(
        canvas.getNativeId(),
        command.id,
        command.source,
        command.target,
        command.direction,
        command.durationMs,
        command.rapidDurationMs,
        command.launchIntervalMs,
      ) === true
    );
  } catch {
    return false;
  }
}

/** Moves the resting page down while a bookmark pull drags it; UI thread. */
export function setNativePagerRestingOffsetOnUI(nativeId: number, offset: number, revealColor: number): void {
  'worklet';
  if (nativeId < 0) return;
  try {
    nativePagerWorkletApi?.pagerSetRestingOffset?.(nativeId, offset, revealColor);
  } catch {
    // The Fabric view may already be unregistered during teardown.
  }
}

/**
 * Shows `windows` as a scrolling strip in place of the resting page and its
 * turns; an empty list ends the strip. False when the composer was unavailable.
 */
export function setNativePagerStrip(
  canvas: NativePagerCanvasHandle | null,
  windows: readonly NativePagerStripWindow[],
): boolean {
  const setStrip = nativePagerRnApi.setStrip;
  if (!canvas || !setStrip) {
    return false;
  }
  try {
    return setStrip(canvas.getNativeId(), windows) === true;
  } catch {
    return false;
  }
}

/** Scrolls the strip so the view's top shows strip position `offset`; UI thread. */
export function setNativePagerStripOffsetOnUI(nativeId: number, offset: number): void {
  'worklet';
  if (nativeId < 0) return;
  try {
    nativePagerWorkletApi?.pagerSetStripOffset?.(nativeId, offset);
  } catch {
    // The Fabric view may already be unregistered during teardown.
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
