import type { SkPicture } from '@shopify/react-native-skia';

import type { ReaderPageContent } from '../core/page-turn-types';
import { nativePageTextureKey } from './page-texture-key';

type PictureFactory = (content: ReaderPageContent) => SkPicture;

interface Entry {
  readonly picture: SkPicture;
  readonly factory: PictureFactory;
  readonly bytes: number;
  users: number;
  retained: boolean;
}

export interface NativePageRecording {
  readonly picture: SkPicture;
  release(): void;
}

/** Bounded recordings shared by adjacent turns; active borrowers survive eviction. */
export class NativePageRecordingCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;

  constructor(
    private readonly maximumEntries = 8,
    private readonly maximumBytes = 64 * 1024 * 1024,
  ) {}

  acquire(key: string, factory: PictureFactory, content: ReaderPageContent, bytes: number): NativePageRecording {
    let entry = this.entries.get(key);
    if (entry?.factory !== factory) {
      // Recording may throw. Keep the previous entry intact until it succeeds.
      const picture = factory(content);
      if (entry) this.retire(key, entry);
      entry = { picture, factory, bytes, users: 0, retained: true };
      this.bytes += bytes;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    entry.users += 1;
    while (this.entries.size > 1 && (this.entries.size > this.maximumEntries || this.bytes > this.maximumBytes)) {
      const [oldestKey, oldest] = this.entries.entries().next().value!;
      this.retire(oldestKey, oldest);
    }
    let released = false;
    return {
      picture: entry.picture,
      release: () => {
        if (released) return;
        released = true;
        entry.users -= 1;
        if (!entry.retained && entry.users === 0) entry.picture.dispose();
      },
    };
  }

  clear(): void {
    for (const [key, entry] of this.entries) this.retire(key, entry);
  }

  private retire(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    entry.retained = false;
    if (entry.users === 0) entry.picture.dispose();
  }
}

export function acquireNativePageRecording(
  cache: NativePageRecordingCache | undefined,
  factory: PictureFactory,
  content: ReaderPageContent,
  layer: 'page' | 'chrome',
  paintKey: string | undefined,
  pixelWidth: number,
  pixelHeight: number,
): NativePageRecording {
  if (cache)
    return cache.acquire(
      nativePageTextureKey(content, layer, paintKey),
      factory,
      content,
      pixelWidth * pixelHeight * 4,
    );
  const picture = factory(content);
  return { picture, release: () => picture.dispose() };
}
