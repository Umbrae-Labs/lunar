/**
 * Bounded cache for encoded image bytes used while materializing reader
 * frames. Decoded Skia images are owned by the rendering cache; this cache is
 * limited to the bytes needed to compile a frame again.
 */
export class ReaderImageByteCache {
  private readonly entries = new Map<string, Uint8Array>();
  private readonly order = new Map<string, void>();
  private totalBytes = 0;

  constructor(private readonly maxBytes = 64 * 1024 * 1024) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      throw new RangeError('ReaderImageByteCache maxBytes must be a positive integer.');
    }
  }

  get(source: string): Uint8Array | undefined {
    const bytes = this.entries.get(source);
    if (bytes) this.touch(source);
    return bytes;
  }

  set(source: string, bytes: Uint8Array, protectedSources: readonly string[] = []): void {
    const previous = this.entries.get(source);
    if (previous) this.totalBytes -= previous.byteLength;
    this.entries.set(source, bytes);
    this.totalBytes += bytes.byteLength;
    this.touch(source);
    this.prune(protectedSources);
  }

  clear(): void {
    this.entries.clear();
    this.order.clear();
    this.totalBytes = 0;
  }

  private touch(source: string): void {
    this.order.delete(source);
    this.order.set(source, undefined);
  }

  private prune(protectedSources: readonly string[]): void {
    const protectedSet = new Set(protectedSources);
    while (this.totalBytes > this.maxBytes && this.order.size > 0) {
      const oldest = this.order.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      if (protectedSet.has(oldest)) {
        this.touch(oldest);
        if ([...this.order.keys()].every((source) => protectedSet.has(source))) return;
        continue;
      }
      this.order.delete(oldest);
      const bytes = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (bytes) this.totalBytes -= bytes.byteLength;
    }
  }
}
