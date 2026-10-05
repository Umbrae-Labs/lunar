import { TabBarHeight } from './tab-bar';

export const BarHeight = TabBarHeight;

export function getBarInset(bottomSafeArea: number): number {
  return bottomSafeArea + BarHeight;
}
