import { useEffect } from 'react';

import { useApplicationLaunchStore } from '@/stores';

export function useMarkInitialContentReady(isReady: boolean): void {
  const markInitialContentReady = useApplicationLaunchStore((state) => state.markInitialContentReady);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    let secondFrame: number | undefined;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(markInitialContentReady);
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) {
        cancelAnimationFrame(secondFrame);
      }
    };
  }, [isReady, markInitialContentReady]);
}
