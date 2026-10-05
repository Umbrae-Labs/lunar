type VolumeKeyDirection = 'next' | 'previous';

export function subscribeToReaderVolumeKeys(_onPress: (direction: VolumeKeyDirection) => void): () => void {
  return () => {};
}
