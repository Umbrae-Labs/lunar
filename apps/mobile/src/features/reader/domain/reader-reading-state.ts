import type { ReaderPosition, ReaderTheme, ReaderTypography } from '@/reader';

export interface ReaderReadingState {
  readonly bookId: string;
  readonly position: ReaderPosition;
  readonly totalSpreads?: number;
  readonly typography: ReaderTypography;
  readonly theme: ReaderTheme;
  readonly updatedAt: number;
}
