import { Skia, type SkImage } from '@shopify/react-native-skia';

import type { ReaderImageDecoder, ReaderImageDimensions, ReaderImageResource } from '../../contracts';

export interface SkiaImageAsset extends ReaderImageDimensions {
  readonly image: SkImage;
  readonly byteLength: number;
}

export type SkiaImageDecoder = ReaderImageDecoder<SkiaImageAsset>;

export interface SkiaImageLease {
  readonly sources: readonly string[];
  release(): void;
}

export class LunarSkiaImageDecoder implements SkiaImageDecoder {
  async decode(resource: ReaderImageResource): Promise<SkiaImageAsset> {
    const data = Skia.Data.fromBytes(resource.bytes);
    try {
      const image = Skia.Image.MakeImageFromEncoded(data);
      if (!image) {
        throw new Error(`Skia could not decode the image ${resource.href}.`);
      }
      const width = image.width();
      const height = image.height();
      return {
        image,
        width,
        height,
        byteLength: Math.max(resource.bytes.byteLength, width * height * 4),
      };
    } finally {
      data.dispose();
    }
  }

  dispose(asset: SkiaImageAsset): void {
    asset.image.dispose();
  }
}

export interface SkiaImageCacheOptions {
  readonly getBytes: (source: string) => Uint8Array | undefined;
  readonly maxBytes?: number;
  readonly decoder?: SkiaImageDecoder;
}

export class SkiaImageCache {
  private readonly entries = new Map<string, SkiaImageAsset>();
  private readonly getBytes: SkiaImageCacheOptions['getBytes'];
  private readonly maxBytes: number;
  private readonly decoder: SkiaImageDecoder;
  private totalBytes = 0;
  private readonly references = new Map<string, number>();
  private readonly loads = new Map<string, Promise<SkiaImageAsset | undefined>>();
  private disposed = false;

  constructor(options: SkiaImageCacheOptions) {
    this.getBytes = options.getBytes;
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.decoder = options.decoder ?? new LunarSkiaImageDecoder();
  }

  resolveImage(source: string): SkiaImageAsset | undefined {
    const value = this.entries.get(source);
    if (!value) {
      return undefined;
    }
    this.entries.delete(source);
    this.entries.set(source, value);
    return value;
  }

  /** Preloads images and keeps them alive until the returned lease is released. */
  async acquire(sources: readonly string[]): Promise<SkiaImageLease> {
    this.assertActive();
    const unique = [...new Set(sources)];
    await this.preload(unique);
    const owned = unique.filter((source) => this.entries.has(source));
    for (const source of owned) {
      this.references.set(source, (this.references.get(source) ?? 0) + 1);
    }
    let released = false;
    return {
      sources: owned,
      release: () => {
        if (released) return;
        released = true;
        for (const source of owned) {
          const count = this.references.get(source) ?? 0;
          if (count <= 1) this.references.delete(source);
          else this.references.set(source, count - 1);
        }
        this.evictOverflow();
      },
    };
  }

  async preload(sources: readonly string[]): Promise<void> {
    this.assertActive();
    for (const source of new Set(sources)) {
      if (this.entries.has(source)) {
        this.resolveImage(source);
        continue;
      }
      let loading = this.loads.get(source);
      if (!loading) {
        loading = (async () => {
          const bytes = this.getBytes(source);
          if (!bytes) return undefined;
          return this.decoder.decode({ href: source, bytes });
        })();
        this.loads.set(source, loading);
      }
      try {
        const asset = await loading;
        if (this.disposed) {
          if (asset) this.decoder.dispose(asset);
          throw new Error('The Skia image cache is disposed.');
        }
        if (!asset || this.entries.has(source)) continue;
        this.entries.set(source, asset);
        this.totalBytes += asset.byteLength;
        this.evictOverflow(source);
      } finally {
        if (this.loads.get(source) === loading) this.loads.delete(source);
      }
    }
  }

  clear(): void {
    if (this.disposed) return;
    for (const asset of new Set(this.entries.values())) {
      this.decoder.dispose(asset);
    }
    this.entries.clear();
    this.references.clear();
    this.totalBytes = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }

  private evictOverflow(protectedSource?: string): void {
    let skipped = 0;
    while (this.totalBytes > this.maxBytes && this.entries.size > 1) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      if (oldest === protectedSource || (this.references.get(oldest) ?? 0) > 0) {
        const protectedAsset = this.entries.get(oldest);
        this.entries.delete(oldest);
        if (protectedAsset) {
          this.entries.set(oldest, protectedAsset);
        }
        skipped += 1;
        if (skipped >= this.entries.size) return;
        continue;
      }
      const asset = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (asset) {
        this.totalBytes -= asset.byteLength;
        this.decoder.dispose(asset);
      }
      skipped = 0;
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('The Skia image cache is disposed.');
  }
}
