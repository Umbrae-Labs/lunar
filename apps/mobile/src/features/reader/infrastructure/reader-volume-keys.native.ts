import { requireNativeModule } from 'expo';

type VolumeKeyDirection = 'next' | 'previous';

interface ReaderVolumeKeysModule {
  setEnabled(enabled: boolean): void;
  addListener(
    eventName: 'onVolumeKey',
    callback: (event: { direction: VolumeKeyDirection }) => void,
  ): { remove(): void };
}

export function subscribeToReaderVolumeKeys(onPress: (direction: VolumeKeyDirection) => void): () => void {
  const volumeKeys = requireNativeModule<ReaderVolumeKeysModule>('LunarReaderVolumeKeys');
  const subscription = volumeKeys.addListener('onVolumeKey', ({ direction }) => onPress(direction));
  volumeKeys.setEnabled(true);

  return () => {
    volumeKeys.setEnabled(false);
    subscription.remove();
  };
}
