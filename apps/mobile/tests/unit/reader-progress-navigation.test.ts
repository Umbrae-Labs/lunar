import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgressNavigationController } from '../../src/features/reader/services/progress-navigation';

function setup() {
  let resolve!: (page: number) => void;
  let reject!: (error: Error) => void;
  const navigate = vi.fn(() => new Promise<number>((yes, no) => { resolve = yes; reject = no; }));
  const onFailure = vi.fn();
  const controller = createProgressNavigationController(navigate, onFailure);
  controller.observe(10);
  return { controller, navigate, onFailure, resolve: (page: number) => resolve(page), reject: () => reject(new Error('Failed')) };
}

describe('reader progress navigation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the target visible until navigation completes and the displayed snapshot arrives', async () => {
    const { controller, navigate, resolve } = setup();
    controller.preview(50);
    controller.request(50);
    expect(controller.getSnapshot().draftPage).toBe(50);
    await vi.advanceTimersByTimeAsync(250);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(50);
    controller.observe(10);
    resolve(50);
    await Promise.resolve();
    expect(controller.getSnapshot()).toEqual({ draftPage: 50, isNavigating: true });
    controller.observe(50);
    expect(controller.getSnapshot()).toEqual({ isNavigating: false });
  });

  it('also acknowledges a snapshot that arrives before the navigation promise settles', async () => {
    const { controller, resolve } = setup();
    controller.request(50);
    await vi.advanceTimersByTimeAsync(250);
    controller.observe(50);
    expect(controller.getSnapshot().draftPage).toBe(50);
    resolve(50);
    await Promise.resolve();
    expect(controller.getSnapshot()).toEqual({ isNavigating: false });
  });

  it('debounces releases and cancels a previous release when another drag begins', async () => {
    const { controller, navigate } = setup();
    controller.request(20);
    await vi.advanceTimersByTimeAsync(200);
    controller.preview(30);
    await vi.advanceTimersByTimeAsync(500);
    expect(navigate).not.toHaveBeenCalled();
    controller.request(30);
    await vi.advanceTimersByTimeAsync(200);
    controller.request(40);
    await vi.advanceTimersByTimeAsync(249);
    expect(navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(40);
  });

  it('cancels the queued release on drag begin without notifying React subscribers', async () => {
    const { controller, navigate } = setup();
    controller.request(20);
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.beginDrag();
    await vi.advanceTimersByTimeAsync(500);
    expect(listener).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    controller.request(30);
    expect(listener).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(250);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(30);
  });

  it('ignores extra input while navigating and restores actual progress after a failure', async () => {
    const { controller, navigate, onFailure, reject } = setup();
    controller.request(50);
    await vi.advanceTimersByTimeAsync(250);
    controller.preview(70);
    controller.request(80);
    expect(controller.getSnapshot().draftPage).toBe(50);
    reject();
    await Promise.resolve();
    expect(controller.getSnapshot()).toEqual({ isNavigating: false });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledTimes(1);
    controller.request(20);
    await vi.advanceTimersByTimeAsync(250);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('commits a released target on dismissal but discards an unfinished drag', async () => {
    const { controller, navigate } = setup();
    controller.preview(20);
    controller.dismiss();
    expect(controller.getSnapshot()).toEqual({ isNavigating: false });
    expect(navigate).not.toHaveBeenCalled();
    controller.request(30);
    controller.dismiss();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(30);
    await vi.advanceTimersByTimeAsync(500);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('drops pending requests when the reading session changes', async () => {
    const { controller, navigate } = setup();
    controller.request(30);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(500);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores old completions after cleanup and supports React effect reconnection', async () => {
    const { controller, resolve } = setup();
    controller.request(30);
    await vi.advanceTimersByTimeAsync(250);
    controller.dispose();
    controller.activate();
    controller.preview(40);
    resolve(30);
    await Promise.resolve();
    expect(controller.getSnapshot()).toEqual({ draftPage: 40, isNavigating: false });
  });

  it('skips navigation when the requested page is already visible', async () => {
    const { controller, navigate } = setup();
    controller.request(10);
    await vi.advanceTimersByTimeAsync(250);
    expect(navigate).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual({ isNavigating: false });
  });
});
