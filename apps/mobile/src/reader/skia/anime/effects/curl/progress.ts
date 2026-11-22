import { clampUnit } from '../../core/page-turn-math';

/** Turn progress of a single page dragged back onto the book; it lands by 72% of the drag. */
export function gestureSinglePreviousCurlProgress(progress: number): number {
  'worklet';
  return clampUnit(progress / 0.72);
}
