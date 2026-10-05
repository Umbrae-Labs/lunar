import * as Brightness from 'expo-brightness';
import { Platform } from 'react-native';

export function isScreenBrightnessAvailable(): Promise<boolean> {
  return Brightness.isAvailableAsync();
}

export function getScreenBrightness(): Promise<number> {
  return Brightness.getBrightnessAsync();
}

export function setScreenBrightness(value: number): Promise<void> {
  return Brightness.setBrightnessAsync(value);
}

/**
 * Remove the activity override on Android and restore the captured value on iOS.
 * The Expo API exposes different reset semantics on the two platforms.
 */
export async function restoreScreenBrightness(previousBrightness: number): Promise<void> {
  if (Platform.OS === 'android') {
    await Brightness.restoreSystemBrightnessAsync();
    return;
  }

  if (Platform.OS === 'ios') {
    await Brightness.setBrightnessAsync(previousBrightness);
  }
}
