export interface ReaderFrameKey {
  readonly revisionId: number;
  readonly spreadIndex: number;
  readonly renderId?: number;
}

interface CacheEntry<T> {
  readonly key: ReaderFrameKey;
  readonly value: T;
}

export type FrameDisposer<T> = (value: T) => void;

export class FrameCache<T> {
  readonly maxEntries: number;

  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly dispose?: FrameDisposer<T>;

  constructor(maxEntries = 3, dispose?: FrameDisposer<T>) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError('FrameCache maxEntries must be a positive integer.');
    }

    this.maxEntries = maxEntries;
    this.dispose = dispose;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: ReaderFrameKey): T | undefined {
    const serializedKey = serializeFrameKey(key);
    const entry = this.entries.get(serializedKey);
    if (!entry) {
      return undefined;
    }

    this.entries.delete(serializedKey);
    this.entries.set(serializedKey, entry);
    return entry.value;
  }

  /**
   * Reads a cached render identity without assuming the slot that first
   * materialized it. A single compiled Picture may be assigned to several
   * logical slots while navigation crosses a chapter boundary.
   */
  getByRenderId(revisionId: number, renderId: number): T | undefined {
    for (const [serializedKey, entry] of this.entries) {
      if (entry.key.revisionId !== revisionId || entry.key.renderId !== renderId) {
        continue;
      }
      this.entries.delete(serializedKey);
      this.entries.set(serializedKey, entry);
      return entry.value;
    }
    return undefined;
  }

  set(key: ReaderFrameKey, value: T): void {
    const serializedKey = serializeFrameKey(key);
    const current = this.entries.get(serializedKey);
    if (current && current.value !== value) {
      this.dispose?.(current.value);
    }

    this.entries.delete(serializedKey);
    this.entries.set(serializedKey, { key, value });
    this.evictOverflow();
  }

  delete(key: ReaderFrameKey): boolean {
    const serializedKey = serializeFrameKey(key);
    const entry = this.entries.get(serializedKey);
    if (!entry) {
      return false;
    }

    this.entries.delete(serializedKey);
    this.dispose?.(entry.value);
    return true;
  }

  deleteRevision(revisionId: number): void {
    for (const [serializedKey, entry] of this.entries) {
      if (entry.key.revisionId === revisionId) {
        this.entries.delete(serializedKey);
        this.dispose?.(entry.value);
      }
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      this.dispose?.(entry.value);
    }
    this.entries.clear();
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }

      const entry = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (entry) {
        this.dispose?.(entry.value);
      }
    }
  }
}

function serializeFrameKey(key: ReaderFrameKey): string {
  return `${key.revisionId}:${key.spreadIndex}:${key.renderId ?? 0}`;
}
