import { describe, expect, it } from 'vitest';

import { ReaderOperationQueue } from '../../src/reader/runtime/cache/reader-operation-queue';

describe('ReaderOperationQueue', () => {
  it('runs a queued foreground operation before later background work', async () => {
    const queue = new ReaderOperationQueue();
    const order: string[] = [];
    let releaseBackground!: () => void;
    const backgroundStarted = new Promise<void>((resolve) => {
      releaseBackground = resolve;
    });

    const first = queue.enqueue(async () => {
      order.push('background-1');
      await backgroundStarted;
    }, 'background');
    const second = queue.enqueue(async () => {
      order.push('background-2');
    }, 'background');
    const foreground = queue.enqueue(async () => {
      order.push('foreground');
    }, 'foreground');

    await Promise.resolve();
    expect(order).toEqual(['background-1']);
    releaseBackground();
    await Promise.all([first, second, foreground]);

    expect(order).toEqual(['background-1', 'foreground', 'background-2']);
  });

  it('drains after a rejected operation and continues with the next one', async () => {
    const queue = new ReaderOperationQueue();
    const order: string[] = [];
    const failed = queue.enqueue(async () => {
      order.push('failed');
      throw new Error('expected');
    });
    const next = queue.enqueue(async () => {
      order.push('next');
    });

    await expect(failed).rejects.toThrow('expected');
    await next;
    await queue.drain();

    expect(order).toEqual(['failed', 'next']);
  });
});
