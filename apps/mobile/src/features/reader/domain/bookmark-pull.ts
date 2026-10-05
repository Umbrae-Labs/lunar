export const BookmarkPullThreshold = 96;
export const BookmarkPullMaximum = 164;

export function bookmarkPullDistance(translationY: number): number {
  'worklet';
  return Math.min(BookmarkPullMaximum, Math.max(0, translationY) * 0.6);
}

export function shouldSavePulledBookmark(translationY: number, success: boolean): boolean {
  'worklet';
  return success && bookmarkPullDistance(translationY) >= BookmarkPullThreshold;
}
