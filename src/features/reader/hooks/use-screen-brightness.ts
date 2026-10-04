import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  getScreenBrightness,
  isScreenBrightnessAvailable,
  restoreScreenBrightness,
  setScreenBrightness,
} from '../infrastructure/screen-brightness';

interface UseScreenBrightnessOptions {
  readonly enabled: boolean;
  readonly brightness: number;
}

interface UseScreenBrightnessResult {
  /** True after the native override has been applied for this reader session. */
  readonly isAvailable: boolean;
}

/**
 * Applies reader brightness to the whole device screen while the reader is focused.
 * The original value is restored when the reader loses focus or unmounts.
 */
export function useScreenBrightness({ enabled, brightness }: UseScreenBrightnessOptions): UseScreenBrightnessResult {
  const brightnessRef = useRef(brightness);
  const activeRef = useRef(false);
  const availableRef = useRef(false);
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    brightnessRef.current = brightness;
  }, [brightness]);

  useEffect(() => {
    if (!enabled) {
      activeRef.current = false;
      availableRef.current = false;
      return;
    }

    let cancelled = false;
    let previousBrightness: number | undefined;
    activeRef.current = true;
    availableRef.current = false;

    const applyBrightness = async () => {
      try {
        if (!(await isScreenBrightnessAvailable()) || cancelled) return;

        previousBrightness = await getScreenBrightness();
        if (cancelled) return;

        await setScreenBrightness(brightnessRef.current);
        if (!cancelled && activeRef.current) {
          availableRef.current = true;
          setIsAvailable(true);
        }
      } catch {
        // The page dimming layer remains available when native control is unavailable.
        availableRef.current = false;
        if (!cancelled) setIsAvailable(false);
      }
    };

    void applyBrightness();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !activeRef.current || !availableRef.current) return;

      void setScreenBrightness(brightnessRef.current).catch(() => {
        if (activeRef.current) {
          availableRef.current = false;
          setIsAvailable(false);
        }
      });
    });

    return () => {
      cancelled = true;
      subscription.remove();
      activeRef.current = false;
      availableRef.current = false;
      setIsAvailable(false);
      if (previousBrightness === undefined) return;
      void restoreScreenBrightness(previousBrightness).catch(() => undefined);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !availableRef.current) return;

    void setScreenBrightness(brightness).catch(() => {
      if (activeRef.current) {
        availableRef.current = false;
        setIsAvailable(false);
      }
    });
  }, [brightness, enabled]);

  return { isAvailable };
}
