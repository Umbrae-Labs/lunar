import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTypographyCommitScheduler,
  stepTypographyValue,
} from '../../src/features/reader/services/typography-adjustment';

describe('typography button adjustments', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves the last values together after consecutive presses stop', () => {
    const save = vi.fn();
    const scheduler = createTypographyCommitScheduler(save);
    scheduler.schedule('fontSize', 20);
    vi.advanceTimersByTime(200);
    scheduler.schedule('fontSize', 21);
    scheduler.schedule('marginHorizontal', 28);
    vi.advanceTimersByTime(249);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledExactlyOnceWith({ fontSize: 21, marginHorizontal: 28 });
  });

  it('uses the slider release value when a button save is still pending', () => {
    const save = vi.fn();
    const scheduler = createTypographyCommitScheduler(save);
    scheduler.schedule('fontSize', 20);
    scheduler.schedule('lineHeight', 1.7);
    scheduler.commit('fontSize', 24);
    expect(save).toHaveBeenCalledExactlyOnceWith({ fontSize: 24, lineHeight: 1.7 });
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves on dismissal and cancels the delayed duplicate save', () => {
    const save = vi.fn();
    const scheduler = createTypographyCommitScheduler(save);
    scheduler.schedule('marginHorizontal', 32);
    scheduler.flush();
    scheduler.flush();
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledExactlyOnceWith({ marginHorizontal: 32 });
  });

  it('keeps repeated fractional adjustments precise and within the limits', () => {
    let value = 1.65;
    for (let index = 0; index < 3; index++) value = stepTypographyValue(value, 1, 0.05, 1.1, 2.4);
    expect(value).toBe(1.8);
    expect(stepTypographyValue(2.4, 1, 0.05, 1.1, 2.4)).toBe(2.4);
    expect(stepTypographyValue(1.1, -1, 0.05, 1.1, 2.4)).toBe(1.1);
    expect(stepTypographyValue(55, 1, 4, 8, 56)).toBe(56);
    expect(stepTypographyValue(12, -1, 1, 12, 32)).toBe(12);
  });
});
