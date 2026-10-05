import {
  ImageShader,
  Picture,
  Rect,
  Shader,
  Skia,
  type SkImage,
  type SkPicture,
  type SkSurface,
  type Uniforms,
} from '@shopify/react-native-skia';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelRatio, Platform } from 'react-native';
import { useDerivedValue, useSharedValue, type DerivedValue, type SharedValue } from 'react-native-reanimated';
import { runOnUI, scheduleOnRN } from 'react-native-worklets';

import type { CompiledReaderPicture } from '../../../rendering/picture-compiler';
import { installRasterTexture, rasterizePageOnWorker, type PageCaptureTiming } from './page-rasterizer';
import {
  isReaderPerformanceEnabled,
  readerPerformanceActivity,
  readerPerformanceMark,
} from '../../../../runtime/core/performance';
import { createAutomaticCurlProfile, createGestureCurlProfile, createIncomingCurlProfile } from './geometry';
import {
  automaticSinglePreviousCurlProgress,
  gestureSinglePreviousCurlRevealProgress,
  gestureSinglePreviousCurlShapeProgress,
  singlePreviousCurlRevealProgress,
} from './progress';

/**
 * Continuous page surface adapted from react-native-natural-page-turn.
 * The surface is one Skia rectangle backed by one texture. It deliberately
 * avoids drawing a Picture once per column: the curl profile is solved into
 * 65 points and the RuntimeEffect performs the interpolation per fragment.
 */
const PROFILE_POINTS = 65;
const PROFILE_SEGMENTS = PROFILE_POINTS - 1;
const PROFILE_RUNS = 4;
const QUADRATURE_OFFSET = 0.5 / Math.sqrt(3);
const CAMERA_DISTANCE = 4;
const MAX_PERSPECTIVE_SCALE = 1.34;
const DEVICE_TEXTURE_SCALE = Math.min(3, Math.max(1, PixelRatio.get()));

const PAGE_CURL_TWO_SIDED_SHADER = createPageCurlShader(true);
const oneSidedPageCurlShaders = new Map<string, ReturnType<typeof createPageCurlShader>>();

function shaderPaperRgb(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return 'half3(1.0, 1.0, 1.0)';
  const hex = match[1]!;
  const channel = (index: number) => (Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16) / 255).toFixed(6);
  return `half3(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function getOneSidedPageCurlShader(paperColor: string) {
  const key = paperColor.toLowerCase();
  let shader = oneSidedPageCurlShaders.get(key);
  if (!shader) {
    shader = createPageCurlShader(false, shaderPaperRgb(paperColor));
    oneSidedPageCurlShaders.set(key, shader);
  }
  return shader;
}

function createPageCurlShader(twoSided: boolean, paperRgb = 'half3(1.0, 1.0, 1.0)') {
  return Skia.RuntimeEffect.Make(`
uniform shader frontTexture;
${twoSided ? 'uniform shader backTexture;' : ''}
uniform float2 pageSize;
uniform float4 geometry;
uniform float4 perspective;
uniform float4 profile[${PROFILE_POINTS}];
uniform float4 runs[${PROFILE_RUNS}];

float perspectiveScale(float depth) {
  return min(
    perspective.z,
    perspective.y / max(0.001, perspective.y - max(0.0, depth))
  );
}

float4 readProfile(int pointIndex) {
  ${profileSelector(0, PROFILE_POINTS)}
}

float4 sampleRun(float bookX, float4 run) {
  if (run.w < 0.5) {
    return float4(0.0, 1.0, -100000.0, -1.0);
  }
  int low = int(run.x);
  int high = int(run.y);
  float lowX = readProfile(low).x;
  float highX = readProfile(high).x;
  if (bookX < min(lowX, highX) || bookX > max(lowX, highX)) {
    return float4(0.0, 1.0, -100000.0, -1.0);
  }
  for (int step = 0; step < 7; step += 1) {
    if (high - low > 1) {
      int middle = (low + high) / 2;
      float middleX = readProfile(middle).x;
      bool lower = run.z > 0.0 ? middleX <= bookX : middleX >= bookX;
      if (lower) low = middle; else high = middle;
    }
  }
  float4 before = readProfile(low);
  float4 after = readProfile(high);
  float deltaX = after.x - before.x;
  if (abs(deltaX) < 0.000001) {
    return float4(0.0, 1.0, -100000.0, -1.0);
  }
  float screenProgress = clamp((bookX - before.x) / deltaX, 0.0, 1.0);
  float beforeScale = perspectiveScale(before.y);
  float afterScale = perspectiveScale(after.y);
  float denominator =
    (1.0 - screenProgress) * beforeScale + screenProgress * afterScale;
  float correctedProgress = denominator <= 0.000001
    ? screenProgress
    : screenProgress * afterScale / denominator;
  float material = (float(low) + correctedProgress) / ${PROFILE_SEGMENTS}.0;
  float depth = mix(before.y, after.y, correctedProgress);
  float normalZ = abs(mix(before.w, after.w, correctedProgress));
  bool screenFront = deltaX > 0.0;
  bool textureFront = (screenFront ? 1.0 : -1.0) * perspective.w > 0.0;
  float shade = (1.0 - normalZ) * 0.16;
  return float4(
    material,
    1.0 - min(0.2, shade),
    depth,
    ${twoSided ? 'screenFront' : 'textureFront'} ? 1.0 : -1.0
  );
}

half4 main(float2 position) {
  float bookX = (position.x - geometry.x) / geometry.y;
  float4 visible = float4(0.0, 1.0, -100000.0, -1.0);
  float4 candidate;
  ${Array.from(
    { length: PROFILE_RUNS },
    (_, index) => `candidate = sampleRun(bookX, runs[${index}]);
  if (candidate.z > visible.z) visible = candidate;`,
  ).join('\n  ')}
  if (visible.z < -99999.0) return half4(0.0);
  float sourceY = 0.5 + (position.y / pageSize.y - 0.5) / perspectiveScale(visible.z);
  float sourceMaterial = visible.w > 0.0 ? visible.x : 1.0 - visible.x;
  float2 source = float2(clamp(sourceMaterial, 0.0, 1.0), clamp(sourceY, 0.0, 1.0));
  ${
    twoSided
      ? `
  half4 paper = visible.w > 0.0
    ? frontTexture.eval(source)
    : backTexture.eval(source);
  return half4(paper.rgb * visible.y, paper.a);`
      : `
  if (visible.w < 0.0) {
    return half4(${paperRgb} * visible.y, 1.0);
  }
  half4 paper = frontTexture.eval(source);
  return half4(paper.rgb * visible.y, paper.a);`
  }
}
`);
}

export interface PageCurlTexture {
  readonly image: SharedValue<SkImage | null>;
  readonly ready: boolean;
}

interface PageCurlMeshProps {
  readonly picture: CompiledReaderPicture;
  readonly width: number;
  readonly height: number;
  readonly direction: 1 | -1;
  readonly progress: SharedValue<number> | DerivedValue<number>;
  readonly initialProgress?: number;
  readonly grabX: number;
  readonly grabY: number;
  readonly grabYValue?: SharedValue<number>;
  readonly pressedEdgeX?: number;
  readonly pressedEdgeXValue?: SharedValue<number>;
  readonly heldRollTilt?: number;
  readonly heldRollTiltValue?: SharedValue<number>;
  readonly texture: PageCurlTexture;
  readonly backTexture?: PageCurlTexture;
  readonly paperColor?: string;
  readonly phase?: 'full' | 'incoming-landing';
  readonly spreadMode?: 'single' | 'double';
  readonly gestureDriven?: boolean;
  readonly settling?: boolean;
  readonly settleTo?: 0 | 1;
}

type CaptureTiming = PageCaptureTiming;

function capturePictureTexture(
  texture: SharedValue<SkImage | null>,
  backingSurface: SharedValue<SkSurface | null>,
  picture: SkPicture,
  width: number,
  height: number,
  textureScale: number,
  captureId: number,
  textureIdentity: string,
  disposePictureAfterCapture: boolean,
  onReady: (captureId: number, textureIdentity: string, ready: boolean, timing?: CaptureTiming) => void,
  queuedAtMs?: number,
): void {
  'worklet';
  const startedAt = queuedAtMs === undefined ? undefined : performance.now();
  const startedAtMs = queuedAtMs === undefined ? 0 : Date.now();
  let ready = false;
  try {
    const surface = Skia.Surface.MakeOffscreen(
      Math.max(1, Math.round(width * textureScale)),
      Math.max(1, Math.round(height * textureScale)),
    );
    if (!surface) return;
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    canvas.scale(textureScale, textureScale);
    canvas.drawPicture(picture);
    surface.flush();
    const nextTexture = surface.makeImageSnapshot();
    const previousTexture = texture.value;
    const previousSurface = backingSurface.value;
    // Swap only after the replacement snapshot exists. Clearing the shared
    // image first leaves one or more transparent frames on Android while the
    // new GPU-backed texture is being prepared.
    texture.value = nextTexture;
    // Android snapshots may remain GPU-backed by this Surface. Keep it alive
    // until the texture is released instead of disposing it immediately.
    backingSurface.value = surface;
    previousTexture?.dispose();
    previousSurface?.dispose();
    ready = true;
  } finally {
    // Generated chrome pictures belong to this queued UI task. Releasing them
    // here prevents RN cleanup from racing canvas.drawPicture above.
    if (disposePictureAfterCapture) picture.dispose();
    // Reuse the readiness callback; never cross runtimes once per animation frame.
    scheduleOnRN(
      onReady,
      captureId,
      textureIdentity,
      ready,
      startedAt === undefined
        ? undefined
        : {
            queueMs: Math.max(0, startedAtMs - queuedAtMs!),
            rasterMs: Math.max(0, performance.now() - startedAt),
            startedAtMs,
            completedAtMs: Date.now(),
          },
    );
  }
}

function disposePictureTexture(
  texture: SharedValue<SkImage | null>,
  backingSurface: SharedValue<SkSurface | null>,
): void {
  'worklet';
  texture.value?.dispose();
  texture.value = null;
  backingSurface.value?.dispose();
  backingSurface.value = null;
}

export function PageCurlMesh(props: PageCurlMeshProps) {
  const { picture, texture, width, height } = props;
  const image = texture.image;
  const backImage = props.backTexture?.image;
  const twoSided = props.backTexture !== undefined;
  const shader = twoSided ? PAGE_CURL_TWO_SIDED_SHADER : getOneSidedPageCurlShader(props.paperColor ?? '#FFFFFF');
  const textureReady = texture.ready && (!props.backTexture || props.backTexture.ready);
  const incomingLanding = props.phase === 'incoming-landing';

  // Worklets freezes each published uniform tree. Build fresh nested arrays
  // so the next frame never mutates values already consumed by Skia.
  const uniforms = useDerivedValue<Uniforms>(
    () =>
      createCurlUniforms(
        props.progress.value,
        props.direction,
        props.grabX,
        props.grabYValue?.value ?? props.grabY,
        width,
        height,
        props.pressedEdgeXValue?.value ?? props.pressedEdgeX,
        props.heldRollTiltValue?.value ?? props.heldRollTilt,
        props.phase,
        props.spreadMode,
        props.gestureDriven,
        props.settling,
        props.settleTo,
        props.initialProgress,
      ),
    [
      height,
      props.direction,
      props.grabX,
      props.grabY,
      props.grabYValue,
      props.heldRollTilt,
      props.heldRollTiltValue,
      props.pressedEdgeX,
      props.pressedEdgeXValue,
      props.progress,
      props.phase,
      props.spreadMode,
      props.gestureDriven,
      props.settling,
      props.settleTo,
      props.initialProgress,
      width,
    ],
  );

  if (!shader) {
    return incomingLanding ? null : <Picture picture={picture.picture} />;
  }
  if (!textureReady) {
    return incomingLanding ? null : <Picture picture={picture.picture} />;
  }

  return (
    <Rect x={0} y={0} width={width} height={height}>
      <Shader source={shader} uniforms={uniforms}>
        <ImageShader
          fit="fill"
          image={image}
          height={1}
          sampling={{ B: 0, C: 0.5 }}
          tx="clamp"
          ty="clamp"
          width={1}
          x={0}
          y={0}
        />
        {backImage && (
          <ImageShader
            fit="fill"
            image={backImage}
            height={1}
            sampling={{ B: 0, C: 0.5 }}
            tx="clamp"
            ty="clamp"
            width={1}
            x={0}
            y={0}
          />
        )}
      </Shader>
    </Rect>
  );
}

export function usePageCurlTexture(
  picture: SkPicture | undefined,
  width: number,
  height: number,
  identity?: string,
  disposePictureAfterCapture = false,
): PageCurlTexture {
  const image = useSharedValue<SkImage | null>(null);
  const backingSurface = useSharedValue<SkSurface | null>(null);
  const textureIdentity = identity ?? `${width}:${height}`;
  const [readyIdentity, setReadyIdentity] = useState<string>();
  const captureId = useRef(0);
  const captureGeneration = useSharedValue(0);
  const markTextureReady = useCallback(
    (completedCaptureId: number, completedIdentity: string, ready: boolean, timing?: CaptureTiming) => {
      if (timing) {
        readerPerformanceMark('reader.texture.capture', {
          page: completedIdentity,
          captureId: completedCaptureId,
          ready,
          ...timing,
          callbackDelayMs: Math.max(0, Date.now() - timing.completedAtMs),
        });
        readerPerformanceActivity('texture.capture', timing.rasterMs);
      }
      if (ready && captureId.current === completedCaptureId) setReadyIdentity(completedIdentity);
    },
    [],
  );
  const textureReady = Boolean(picture && width > 0 && height > 0 && readyIdentity === textureIdentity);

  useEffect(() => {
    captureId.current += 1;
    const nextCaptureId = captureId.current;
    captureGeneration.set(nextCaptureId);
    if (!picture || width <= 0 || height <= 0) return;
    if (Platform.OS === 'android') {
      // CPU raster work runs outside UI. Only the completed image swap uses UI.
      const scale = Math.min(DEVICE_TEXTURE_SCALE, Math.sqrt((24 * 1024 * 1024) / (width * height * 4)));
      void rasterizePageOnWorker(
        picture,
        width,
        height,
        scale,
        disposePictureAfterCapture,
        isReaderPerformanceEnabled() ? Date.now() : undefined,
      )
        .then(({ image: captured, timing }) => {
          runOnUI(installRasterTexture)(
            image,
            backingSurface,
            captureGeneration,
            nextCaptureId,
            textureIdentity,
            captured,
            markTextureReady,
            timing,
          );
        })
        .catch(() => {
          if (captureId.current === nextCaptureId) markTextureReady(nextCaptureId, textureIdentity, false);
        });
      return;
    }
    // SkPicture and SkImage are native host objects. Keep the rasterisation on
    // the UI runtime and prepare the current page before a gesture starts.
    runOnUI(capturePictureTexture)(
      image,
      backingSurface,
      picture,
      width,
      height,
      DEVICE_TEXTURE_SCALE,
      nextCaptureId,
      textureIdentity,
      disposePictureAfterCapture,
      markTextureReady,
      isReaderPerformanceEnabled() ? Date.now() : undefined,
    );
  }, [
    backingSurface,
    captureGeneration,
    disposePictureAfterCapture,
    height,
    image,
    markTextureReady,
    picture,
    textureIdentity,
    width,
  ]);

  useEffect(
    () => () => {
      captureId.current += 1;
      captureGeneration.set(captureId.current);
      runOnUI(disposePictureTexture)(image, backingSurface);
    },
    [backingSurface, captureGeneration, image],
  );

  return { image, ready: textureReady };
}

function profileSelector(start: number, end: number): string {
  if (end - start === 1) return `return profile[${start}];`;
  const middle = Math.floor((start + end) * 0.5);
  return `if (pointIndex < ${middle}) { ${profileSelector(start, middle)} } else { ${profileSelector(middle, end)} }`;
}

function createCurlUniforms(
  progress: number,
  direction: 1 | -1,
  grabX: number,
  grabY: number,
  width: number,
  height: number,
  pressedEdgeX = 1,
  heldRollTilt = 0,
  phase: PageCurlMeshProps['phase'] = 'full',
  spreadMode: PageCurlMeshProps['spreadMode'] = 'double',
  gestureDriven = false,
  settling = false,
  settleTo: 0 | 1 = 1,
  initialProgress = progress,
): Uniforms {
  'worklet';
  const animationProgress = Math.min(1, Math.max(0, progress));
  const incomingLanding = phase === 'incoming-landing';
  const turn = incomingLanding
    ? gestureDriven
      ? gestureSinglePreviousCurlShapeProgress(animationProgress)
      : automaticSinglePreviousCurlProgress(animationProgress)
    : animationProgress;
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const spineX = incomingLanding ? 0 : direction > 0 ? 0 : safeWidth;
  const startMaterial = incomingLanding ? 0.4 : Math.min(1, Math.max(0, Math.abs(grabX - spineX) / safeWidth));
  let amplitude: number;
  let rotation: number;
  let landedLength: number;
  let uniformity: number;
  let cornerTilt: number;
  if (incomingLanding) {
    const incomingProfile = createIncomingCurlProfile(turn, gestureDriven ? 0.6 : 0.4);
    amplitude = incomingProfile.amplitude;
    rotation = incomingProfile.rotation;
    landedLength = incomingProfile.landedLength;
    uniformity = incomingProfile.uniformity;
    cornerTilt = 0;
  } else if (gestureDriven) {
    const gestureProfile = createGestureCurlProfile({
      progress: animationProgress,
      direction,
      startBookX: startMaterial,
      pressedEdgeX,
      heldRollTilt,
      spreadMode,
      settling,
      settleTo,
      releaseProgress: initialProgress,
    });
    amplitude = gestureProfile.amplitude;
    rotation = gestureProfile.rotation;
    landedLength = gestureProfile.landedLength;
    uniformity = gestureProfile.uniformity;
    // The reference renderer models an inextensible strip. Vertical movement
    // contributes to release intent but does not rotate the entire strip.
    cornerTilt = 0;
  } else {
    const automaticProfile = createAutomaticCurlProfile(turn);
    amplitude = automaticProfile.amplitude;
    rotation = automaticProfile.rotation;
    landedLength = automaticProfile.landedLength;
    uniformity = automaticProfile.uniformity;
    cornerTilt = 0;
  }
  // RuntimeEffect uniforms are flattened by Skia's uniform processor. Use
  // ordinary number arrays here; Float32Array is treated as a single vector
  // by the Android animated-prop bridge and arrives as only four values.
  const projected = new Array<number>(PROFILE_POINTS * 4).fill(0);
  let x = 0;
  let z = 0;
  projected[0] = 0;
  projected[1] = 0;
  for (let segment = 0; segment < PROFILE_SEGMENTS; segment += 1) {
    const material = (segment + 0.5) / PROFILE_SEGMENTS;
    const first = material - QUADRATURE_OFFSET / PROFILE_SEGMENTS;
    const second = material + QUADRATURE_OFFSET / PROFILE_SEGMENTS;
    const firstClamped = Math.min(1, Math.max(0, first));
    const secondClamped = Math.min(1, Math.max(0, second));
    const firstAirborne = Math.max(1e-4, 1 - landedLength);
    const firstMaterial =
      landedLength > 0 && firstClamped <= landedLength ? 0 : (firstClamped - landedLength) / firstAirborne;
    const secondMaterial =
      landedLength > 0 && secondClamped <= landedLength ? 0 : (secondClamped - landedLength) / firstAirborne;
    const firstPinned = Math.cos(Math.PI * Math.min(1, Math.max(0, firstMaterial)));
    const secondPinned = Math.cos(Math.PI * Math.min(1, Math.max(0, secondMaterial)));
    const firstUniform = 1 - 2 * Math.min(1, Math.max(0, firstMaterial));
    const secondUniform = 1 - 2 * Math.min(1, Math.max(0, secondMaterial));
    const firstCurl = firstPinned + uniformity * (firstUniform - firstPinned);
    const secondCurl = secondPinned + uniformity * (secondUniform - secondPinned);
    const firstAngle =
      (landedLength > 0 && firstClamped <= landedLength ? Math.PI : rotation + amplitude * firstCurl) + cornerTilt;
    const secondAngle =
      (landedLength > 0 && secondClamped <= landedLength ? Math.PI : rotation + amplitude * secondCurl) + cornerTilt;
    x += ((Math.cos(firstAngle) + Math.cos(secondAngle)) * 0.5) / PROFILE_SEGMENTS;
    z += ((Math.sin(firstAngle) + Math.sin(secondAngle)) * 0.5) / PROFILE_SEGMENTS;
    const offset = (segment + 1) * 4;
    projected[offset] = x;
    projected[offset + 1] = z;
  }
  for (let index = 0; index < PROFILE_POINTS; index += 1) {
    const before = Math.max(0, index - 1) * 4;
    const after = Math.min(PROFILE_POINTS - 1, index + 1) * 4;
    const offset = index * 4;
    const tangentX = projected[after]! - projected[before]!;
    const tangentZ = projected[after + 1]! - projected[before + 1]!;
    const length = Math.max(1e-7, Math.hypot(tangentX, tangentZ));
    projected[offset + 2] = -tangentZ / length;
    projected[offset + 3] = tangentX / length;
  }

  for (let index = 0; index < PROFILE_POINTS; index += 1) {
    const offset = index * 4;
    const physicalX = projected[offset]! * direction;
    const depth = Math.max(0, projected[offset + 1]!);
    const normalX = projected[offset + 2]! * direction;
    const normalZ = projected[offset + 3]!;
    const scale = Math.min(MAX_PERSPECTIVE_SCALE, CAMERA_DISTANCE / Math.max(0.001, CAMERA_DISTANCE - depth));
    projected[offset] = 0.5 + (physicalX - 0.5) * scale;
    projected[offset + 1] = depth;
    projected[offset + 2] = normalX;
    projected[offset + 3] = normalZ;
  }
  if (incomingLanding) {
    const reveal = gestureDriven
      ? gestureSinglePreviousCurlRevealProgress(animationProgress)
      : singlePreviousCurlRevealProgress(animationProgress);
    if (reveal < 1) {
      let maximumX = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < PROFILE_POINTS; index += 1) {
        maximumX = Math.max(maximumX, projected[index * 4]!);
      }
      const revealOffset = -Math.max(0, maximumX) * (1 - reveal);
      for (let index = 0; index < PROFILE_POINTS; index += 1) {
        projected[index * 4] = projected[index * 4]! + revealOffset;
      }
    }
  }

  const runs = new Array<number>(PROFILE_RUNS * 4).fill(0);
  let runCount = 0;
  let runStart = 0;
  let runDirection = 0;
  for (let segment = 0; segment < PROFILE_SEGMENTS; segment += 1) {
    const delta = projected[(segment + 1) * 4]! - projected[segment * 4]!;
    if (Math.abs(delta) < 1e-6) continue;
    const nextDirection = delta > 0 ? 1 : -1;
    if (runDirection === 0) {
      runDirection = nextDirection;
    } else if (nextDirection !== runDirection && runCount < PROFILE_RUNS - 1) {
      const offset = runCount * 4;
      runs[offset] = runStart;
      runs[offset + 1] = segment;
      runs[offset + 2] = runDirection;
      runs[offset + 3] = 1;
      runCount += 1;
      runStart = segment;
      runDirection = nextDirection;
    }
  }
  const finalOffset = runCount * 4;
  runs[finalOffset] = runStart;
  runs[finalOffset + 1] = PROFILE_POINTS - 1;
  runs[finalOffset + 2] = runDirection || direction;
  runs[finalOffset + 3] = 1;

  return {
    pageSize: [safeWidth, safeHeight],
    geometry: [spineX, safeWidth, PROFILE_POINTS - 1, PROFILE_RUNS],
    // Incoming single pages carry the destination's printed front. Their
    // motion is mirrored, but their printed face is still screen-front.
    // Outgoing sheets retain the source-facing convention in double mode.
    perspective: [0.5, CAMERA_DISTANCE, MAX_PERSPECTIVE_SCALE, incomingLanding ? 1 : direction],
    profile: projected,
    runs,
  };
}
