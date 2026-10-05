import { Image } from 'expo-image';
import { CloseButton } from 'heroui-native/close-button';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { withUniwind } from 'uniwind';

const StyledImage = withUniwind(Image);
const MaximumScale = 5;
const DoubleTapScale = 2.5;
const SpringConfig = { damping: 18, stiffness: 180, mass: 0.8, overshootClamping: true };
const ZoomTiming = { duration: 240, easing: Easing.out(Easing.cubic) };

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ImageViewerProps {
  readonly uri: string;
  readonly origin: Rect;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly description: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly onError: () => void;
}

function rubberBand(value: number, limit: number): number {
  'worklet';
  const distance = Math.abs(value);
  return distance <= limit ? value : Math.sign(value) * (limit + (distance - limit) * 0.28);
}

function translationLimit(imageSize: number, viewportSize: number, scale: number): number {
  'worklet';
  return Math.max(0, (imageSize * scale - viewportSize) / 2);
}

export function ImageViewer({ uri, origin, viewport, description, closeLabel, onClose, onError }: ImageViewerProps) {
  const insets = useSafeAreaInsets();
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>();
  const progress = useSharedValue(0);
  const openingStarted = useSharedValue(false);
  const closing = useSharedValue(false);
  const dismissingDrag = useSharedValue(false);
  const gestureOwner = useSharedValue<'idle' | 'pan' | 'pinch'>('idle');
  const scale = useSharedValue(1);
  const pinchStartScale = useSharedValue(1);
  const pinchGestureScale = useSharedValue(1);
  const pinchPointers = useSharedValue(0);
  const pinchFocalX = useSharedValue(0);
  const pinchFocalY = useSharedValue(0);
  const pinchStartX = useSharedValue(0);
  const pinchStartY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const panGestureX = useSharedValue(0);
  const panGestureY = useSharedValue(0);
  const target = useMemo(() => {
    if (!dimensions?.width || !dimensions.height) return origin;
    const fit = Math.min(viewport.width / dimensions.width, viewport.height / dimensions.height);
    const width = dimensions.width * fit;
    const height = dimensions.height * fit;
    return { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height };
  }, [dimensions, origin, viewport.height, viewport.width]);

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    if (!dimensions || openingStarted.value || closing.value) return;
    openingStarted.value = true;
    progress.value = withTiming(1, { duration: 340 });
  }, [closing, dimensions, openingStarted, progress]);

  const close = useCallback(() => {
    'worklet';
    if (closing.value) return;
    closing.value = true;
    scale.value = withTiming(1, { duration: 280 });
    translateX.value = withTiming(0, { duration: 280 });
    translateY.value = withTiming(0, { duration: 280 });
    progress.value = withTiming(0, { duration: 320 }, (finished) => {
      if (finished) scheduleOnRN(onClose);
    });
  }, [closing, onClose, progress, scale, translateX, translateY]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close]);

  const gesture = useMemo(() => {
    const settle = () => {
      'worklet';
      if (closing.value || progress.value < 1) return;
      const settledScale = Math.max(1, Math.min(MaximumScale, scale.value));
      const maxX = translationLimit(target.width, viewport.width, settledScale);
      const maxY = translationLimit(target.height, viewport.height, settledScale);
      const settledX = Math.max(-maxX, Math.min(maxX, translateX.value));
      const settledY = Math.max(-maxY, Math.min(maxY, translateY.value));
      if (scale.value !== settledScale) scale.value = withSpring(settledScale, SpringConfig);
      if (translateX.value !== settledX) translateX.value = withSpring(settledX, SpringConfig);
      if (translateY.value !== settledY) translateY.value = withSpring(settledY, SpringConfig);
    };
    const pinch = Gesture.Pinch()
      .enabled(Boolean(dimensions))
      .onStart((event) => {
        if (closing.value || progress.value < 1) return;
        gestureOwner.value = 'pinch';
        dismissingDrag.value = false;
        cancelAnimation(scale);
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        pinchStartScale.value = scale.value;
        pinchGestureScale.value = event.scale;
        pinchPointers.value = event.numberOfPointers;
        pinchFocalX.value = event.focalX - viewport.width / 2;
        pinchFocalY.value = event.focalY - viewport.height / 2;
        pinchStartX.value = translateX.value;
        pinchStartY.value = translateY.value;
      })
      .onUpdate((event) => {
        if (closing.value || gestureOwner.value !== 'pinch') return;
        // A changed pointer count changes the reported center. Start a new
        // anchor at the current transform instead of moving the image to it.
        if (pinchPointers.value !== event.numberOfPointers) {
          pinchPointers.value = event.numberOfPointers;
          pinchStartScale.value = scale.value;
          pinchGestureScale.value = event.scale;
          pinchStartX.value = translateX.value;
          pinchStartY.value = translateY.value;
          pinchFocalX.value = event.focalX - viewport.width / 2;
          pinchFocalY.value = event.focalY - viewport.height / 2;
          return;
        }
        const rawScale = (pinchStartScale.value * event.scale) / pinchGestureScale.value;
        const nextScale =
          rawScale < 1
            ? 1 - (1 - rawScale) * 0.28
            : rawScale > MaximumScale
              ? MaximumScale + (rawScale - MaximumScale) * 0.28
              : rawScale;
        scale.value = nextScale;
        const ratio = nextScale / pinchStartScale.value;
        const focusX = event.focalX - viewport.width / 2;
        const focusY = event.focalY - viewport.height / 2;
        translateX.value = focusX - (pinchFocalX.value - pinchStartX.value) * ratio;
        translateY.value = focusY - (pinchFocalY.value - pinchStartY.value) * ratio;
      })
      .onFinalize(() => {
        if (gestureOwner.value !== 'pinch') return;
        gestureOwner.value = 'idle';
        settle();
      });
    const pan = Gesture.Pan()
      .enabled(Boolean(dimensions))
      .maxPointers(1)
      .minDistance(4)
      .onStart((event) => {
        if (closing.value || progress.value < 1 || gestureOwner.value === 'pinch') return;
        gestureOwner.value = 'pan';
        cancelAnimation(scale);
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        dismissingDrag.value = scale.value <= 1.01;
        panStartX.value = translateX.value;
        panStartY.value = translateY.value;
        panGestureX.value = event.translationX;
        panGestureY.value = event.translationY;
      })
      .onUpdate((event) => {
        if (closing.value || gestureOwner.value !== 'pan' || event.numberOfPointers !== 1) return;
        const movementX = event.translationX - panGestureX.value;
        const movementY = event.translationY - panGestureY.value;
        if (dismissingDrag.value) {
          translateX.value = panStartX.value + movementX * 0.35;
          translateY.value = panStartY.value + movementY;
          scale.value = 1 - Math.min(0.18, (Math.abs(movementY) / viewport.height) * 0.35);
          return;
        }
        const maxX = translationLimit(target.width, viewport.width, scale.value);
        const maxY = translationLimit(target.height, viewport.height, scale.value);
        translateX.value = rubberBand(panStartX.value + movementX, maxX);
        translateY.value = rubberBand(panStartY.value + movementY, maxY);
      })
      .onEnd((event, success) => {
        if (closing.value || gestureOwner.value !== 'pan') return;
        gestureOwner.value = 'idle';
        if (!success && event.numberOfPointers > 1) return;
        const distance = Math.abs(event.translationY);
        const shouldDismiss =
          distance >= Math.min(120, viewport.height * 0.16) ||
          (distance > 24 && Math.abs(event.velocityY) > 900 && event.translationY * event.velocityY > 0);
        if (success && dismissingDrag.value && shouldDismiss) {
          close();
          return;
        }
        settle();
      })
      .onFinalize((event, success) => {
        // Failed tap candidates never owned the transform and must not
        // interrupt a double-tap zoom or an active pinch.
        if (gestureOwner.value !== 'pan') return;
        gestureOwner.value = 'idle';
        if (!success && event.numberOfPointers < 2) settle();
      });
    const doubleTap = Gesture.Tap()
      .enabled(Boolean(dimensions))
      .numberOfTaps(2)
      .onEnd((event, success) => {
        if (!success || closing.value || progress.value < 1) return;
        dismissingDrag.value = false;
        cancelAnimation(scale);
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        if (scale.value > 1) {
          scale.value = withTiming(1, ZoomTiming);
          translateX.value = withTiming(0, ZoomTiming);
          translateY.value = withTiming(0, ZoomTiming);
          return;
        }
        const maxX = translationLimit(target.width, viewport.width, DoubleTapScale);
        const maxY = translationLimit(target.height, viewport.height, DoubleTapScale);
        translateX.value = withTiming(
          Math.max(-maxX, Math.min(maxX, (viewport.width / 2 - event.x) * (DoubleTapScale - 1))),
          ZoomTiming,
        );
        translateY.value = withTiming(
          Math.max(-maxY, Math.min(maxY, (viewport.height / 2 - event.y) * (DoubleTapScale - 1))),
          ZoomTiming,
        );
        scale.value = withTiming(DoubleTapScale, ZoomTiming);
      });
    const backdropTap = Gesture.Tap().onEnd((event, success) => {
      if (!success || closing.value || progress.value < 1) return;
      const centerX = viewport.width / 2 + translateX.value;
      const centerY = viewport.height / 2 + translateY.value;
      const halfWidth = (target.width * scale.value) / 2;
      const halfHeight = (target.height * scale.value) / 2;
      if (Math.abs(event.x - centerX) > halfWidth || Math.abs(event.y - centerY) > halfHeight) close();
    });
    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, backdropTap));
  }, [
    close,
    closing,
    dimensions,
    dismissingDrag,
    gestureOwner,
    panGestureX,
    panGestureY,
    panStartX,
    panStartY,
    pinchFocalX,
    pinchFocalY,
    pinchGestureScale,
    pinchPointers,
    pinchStartScale,
    pinchStartX,
    pinchStartY,
    progress,
    scale,
    target.height,
    target.width,
    translateX,
    translateY,
    viewport.height,
    viewport.width,
  ]);
  /* eslint-enable react-hooks/immutability */

  const backdropStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(progress.value, [0, 0.35, 1], [0, 0, 1], Extrapolation.CLAMP) *
      (dismissingDrag.value ? Math.max(0.3, 1 - Math.abs(translateY.value) / (viewport.height * 0.6)) : 1),
  }));
  const imageStyle = useAnimatedStyle(() => ({
    left: interpolate(progress.value, [0, 1], [origin.x, target.x]),
    top: interpolate(progress.value, [0, 1], [origin.y, target.y]),
    width: interpolate(progress.value, [0, 1], [origin.width, target.width]),
    height: interpolate(progress.value, [0, 1], [origin.height, target.height]),
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));
  const closeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.65, 1], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <View accessibilityViewIsModal onAccessibilityEscape={close} className="absolute inset-0 z-50 overflow-hidden">
      <Animated.View pointerEvents="none" className="absolute inset-0 bg-black" style={backdropStyle} />
      <GestureDetector gesture={gesture}>
        <View collapsable={false} className="absolute inset-0">
          <Animated.View className="absolute" style={imageStyle}>
            <StyledImage
              source={uri}
              className="h-full w-full"
              contentFit="contain"
              accessible
              accessibilityLabel={description}
              onLoad={(event) =>
                setDimensions((current) =>
                  current?.width === event.source.width && current.height === event.source.height
                    ? current
                    : { width: event.source.width, height: event.source.height },
                )
              }
              onError={onError}
            />
          </Animated.View>
        </View>
      </GestureDetector>
      <Animated.View
        pointerEvents="box-none"
        className="absolute top-0 right-0 left-0 items-end px-4"
        style={[closeStyle, { paddingTop: insets.top + 12 }]}>
        <CloseButton accessibilityLabel={closeLabel} iconProps={{ color: '#FFFFFF' }} onPress={close} />
      </Animated.View>
    </View>
  );
}
