import type { ReaderTypography } from '@/reader';

export type AdjustableTypographyKey = 'fontSize' | 'marginHorizontal' | 'lineHeight';
type TypographyChanges = Partial<Pick<ReaderTypography, AdjustableTypographyKey>>;

export function stepTypographyValue(value: number, direction: -1 | 1, step: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round((value + direction * step) * 100) / 100));
}

/** Coalesces button presses while keeping slider releases and dismissal immediate. */
export function createTypographyCommitScheduler(onCommit: (changes: TypographyChanges) => void) {
  let pending: TypographyChanges = {};
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const changes = pending;
    pending = {};
    if (Object.keys(changes).length > 0) onCommit(changes);
  }

  return {
    flush,
    schedule(key: AdjustableTypographyKey, value: number) {
      pending = { ...pending, [key]: value };
      clearTimeout(timer);
      timer = setTimeout(flush, 250);
    },
    commit(key: AdjustableTypographyKey, value: number) {
      pending = { ...pending, [key]: value };
      flush();
    },
  };
}
