import { useCallback, useMemo, useState } from 'react';
import { PixelRatio, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets, type SafeAreaListenerProps } from 'react-native-safe-area-context';
import type { ReaderViewport } from '@/reader';
import type { ReaderSurfaceTransform } from '@/reader/native';

// The canvas covers the window; these values only keep page content away from its edges.
const ReaderSurfaceTopSpacing = 4;
const ReaderSurfaceBottomSpacing = 4;

export function useReaderViewport() {
  const insets = useSafeAreaInsets();
  const [reservedInsets, setReservedInsets] = useState(insets);
  const [viewport, setViewport] = useState<ReaderViewport>();
  const [surfaceTransform, setSurfaceTransform] = useState<ReaderSurfaceTransform>();
  const contentInsets = useMemo(
    () => ({
      top: reservedInsets.top + ReaderSurfaceTopSpacing,
      right: reservedInsets.right,
      bottom: reservedInsets.bottom + ReaderSurfaceBottomSpacing,
      left: reservedInsets.left,
    }),
    [reservedInsets],
  );
  const handleSafeAreaChange = useCallback<SafeAreaListenerProps['onChange']>(({ insets: nextInsets }) => {
    setReservedInsets((current) => preserveLargestInsets(current, nextInsets));
  }, []);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport((current) => {
      const nextViewport = {
        width: Math.round(width),
        height: Math.round(height),
        pixelRatio: PixelRatio.get(),
      };
      return current?.width === nextViewport.width && current.height === nextViewport.height ? current : nextViewport;
    });
  }, []);

  const handleSurfaceTransform = useCallback((transform: ReaderSurfaceTransform) => {
    setSurfaceTransform(transform);
  }, []);

  return {
    viewport,
    reservedInsets,
    contentInsets,
    surfaceTransform,
    handleLayout,
    handleSurfaceTransform,
    handleSafeAreaChange,
  };
}

function preserveLargestInsets(current: EdgeInsets, next: EdgeInsets): EdgeInsets {
  const preserved = {
    top: Math.max(current.top, next.top),
    right: Math.max(current.right, next.right),
    bottom: Math.max(current.bottom, next.bottom),
    left: Math.max(current.left, next.left),
  };
  return preserved.top === current.top &&
    preserved.right === current.right &&
    preserved.bottom === current.bottom &&
    preserved.left === current.left
    ? current
    : preserved;
}
