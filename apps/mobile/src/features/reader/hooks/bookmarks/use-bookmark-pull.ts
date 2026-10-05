import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { bookmarkPullDistance, shouldSavePulledBookmark } from '../../domain/bookmark-pull';

export function useBookmarkPull({
  enabled,
  bookmarked,
  onStart,
  onCommit,
}: {
  readonly enabled: boolean;
  readonly bookmarked: boolean;
  readonly onStart: () => void;
  readonly onCommit: () => void;
}) {
  const distance = useSharedValue(0);
  const pullBookmarked = useSharedValue(bookmarked);
  /* eslint-disable react-hooks/immutability */
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
        .activeOffsetY(12)
        .failOffsetY(-8)
        .failOffsetX([-12, 12])
        .cancelsTouchesInView(true)
        .onStart(() => {
          'worklet';
          pullBookmarked.value = bookmarked;
          scheduleOnRN(onStart);
        })
        .onUpdate((event) => {
          'worklet';
          distance.value = bookmarkPullDistance(event.translationY);
        })
        .onEnd((event, success) => {
          'worklet';
          if (shouldSavePulledBookmark(event.translationY, success)) scheduleOnRN(onCommit);
        })
        .onFinalize(() => {
          'worklet';
          distance.value = withTiming(0, { duration: 220 });
        }),
    [bookmarked, distance, enabled, onCommit, onStart, pullBookmarked],
  );
  /* eslint-enable react-hooks/immutability */
  return { gesture, distance, pullBookmarked };
}
