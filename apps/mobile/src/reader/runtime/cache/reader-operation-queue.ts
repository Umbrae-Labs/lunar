export type ReaderOperationPriority = 'foreground' | 'background';

interface QueuedReaderOperation {
  readonly operation: () => Promise<unknown>;
  readonly priority: ReaderOperationPriority;
  readonly sequence: number;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
}

/** Serializes publication mutations while allowing foreground work to run before queued background work. */
export class ReaderOperationQueue {
  private readonly pending: QueuedReaderOperation[] = [];
  private readonly idleWaiters: (() => void)[] = [];
  private running = false;
  private sequence = 0;

  enqueue<T>(operation: () => Promise<T>, priority: ReaderOperationPriority = 'foreground'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        operation: async () => operation(),
        priority,
        sequence: this.sequence++,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.pump();
    });
  }

  async drain(): Promise<void> {
    if (!this.running && this.pending.length === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    if (this.running) return;
    const next = this.takeNext();
    if (!next) {
      const waiters = this.idleWaiters.splice(0);
      for (const resolve of waiters) resolve();
      return;
    }
    this.running = true;
    Promise.resolve()
      .then(next.operation)
      .then(next.resolve, next.reject)
      .finally(() => {
        this.running = false;
        this.pump();
      });
  }

  private takeNext(): QueuedReaderOperation | undefined {
    if (this.pending.length === 0) return undefined;
    let selectedIndex = 0;
    for (let index = 1; index < this.pending.length; index += 1) {
      const selected = this.pending[selectedIndex];
      const candidate = this.pending[index];
      if (candidate.priority === 'foreground' && selected.priority === 'background') {
        selectedIndex = index;
      } else if (candidate.priority === selected.priority && candidate.sequence < selected.sequence) {
        selectedIndex = index;
      }
    }
    return this.pending.splice(selectedIndex, 1)[0];
  }
}
