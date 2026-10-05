import { useFocusEffect } from 'expo-router';
import { useCallback, useLayoutEffect, useRef } from 'react';

import { subscribeToReaderVolumeKeys } from '../../infrastructure/reader-volume-keys';

export function useReaderVolumeKeys(enabled: boolean, onPress: (direction: 'next' | 'previous') => void): void {
  const onPressRef = useRef(onPress);
  useLayoutEffect(() => {
    onPressRef.current = onPress;
  }, [onPress]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      return subscribeToReaderVolumeKeys((direction) => onPressRef.current(direction));
    }, [enabled]),
  );
}
