import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  View: ({
    children,
    accessibilityLabel,
    accessibilityRole,
  }: {
    children?: ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
  }) => (
    <div aria-label={accessibilityLabel} role={accessibilityRole}>
      {children}
    </div>
  ),
}));

vi.mock('react-native-reanimated', () => ({
  default: {
    View: ({
      children,
      accessibilityLabel,
      accessibilityRole,
    }: {
      children?: ReactNode;
      accessibilityLabel?: string;
      accessibilityRole?: string;
    }) => (
      <div aria-label={accessibilityLabel} role={accessibilityRole}>
        {children}
      </div>
    ),
  },
  Easing: { linear: (value: number) => value },
  FadeOut: { duration: () => ({}) },
  cancelAnimation: vi.fn(),
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useReducedMotion: () => false,
  useSharedValue: (initial: number) => ({ value: initial, set: vi.fn() }),
  withRepeat: (animation: unknown) => animation,
  withTiming: (value: number) => value,
}));

import { ReaderLoadingOverlay, resolveLunarPhaseMotion } from '../../src/features/reader/components/loading-overlay';

describe('ReaderLoadingOverlay', () => {
  it('starts on an upper-right crescent and cycles seamlessly through eclipse and full moon', () => {
    const start = resolveLunarPhaseMotion(0);
    expect(start.shadowX).toBeLessThan(0);
    expect(start.shadowY).toBeGreaterThan(0);
    expect(start.orbitDeg).toBe(45);

    const eclipse = resolveLunarPhaseMotion(0.18);
    expect(Math.abs(eclipse.shadowX)).toBeLessThan(1e-9);
    expect(Math.abs(eclipse.shadowY)).toBeLessThan(1e-9);

    const fullBeforeWrap = resolveLunarPhaseMotion(0.679999);
    const fullAfterWrap = resolveLunarPhaseMotion(0.68);
    expect(Math.hypot(fullBeforeWrap.shadowX, fullBeforeWrap.shadowY)).toBeGreaterThanOrEqual(26);
    expect(Math.hypot(fullAfterWrap.shadowX, fullAfterWrap.shadowY)).toBeGreaterThanOrEqual(26);

    const wrapped = resolveLunarPhaseMotion(1);
    expect(wrapped.shadowX).toBeCloseTo(start.shadowX, 6);
    expect(wrapped.shadowY).toBeCloseTo(start.shadowY, 6);
    expect(wrapped.orbitDeg).toBeCloseTo(start.orbitDeg, 6);
  });

  it('renders a progressbar without visible stage text', () => {
    const markup = renderToStaticMarkup(
      <ReaderLoadingOverlay paperColor="#000000" inkColor="#D1D1D1" accessibilityLabel="Preparing reading page" />,
    );
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="Preparing reading page"');
    expect(markup.replace(/<[^>]+>/g, '')).toBe('');
  });
});
