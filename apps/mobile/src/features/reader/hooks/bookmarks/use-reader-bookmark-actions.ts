import { useCallback, useRef, useState } from 'react';
import { useToast } from 'heroui-native/toast';
import { useTranslation } from '@/i18n';
import type { ReaderRuntime, ReaderSnapshot, ReaderRenderFrame, ReaderHitEntry } from '@/reader';
import { hasBookmarkOnRenderedPage, isBookmarkOnPage, type ReaderBookmark } from '../../domain/reader-bookmark';
import type { useReaderBookmarks } from './use-reader-bookmarks';

type ReaderBookmarkActionsOptions = Pick<
  ReturnType<typeof useReaderBookmarks>,
  'bookmarks' | 'addBookmark' | 'removeBookmark'
> & {
  readonly runtime: ReaderRuntime;
  readonly snapshot: ReaderSnapshot;
  readonly currentHitEntries: readonly ReaderHitEntry[];
  readonly chapterTitle: string;
  readonly onPullStart: () => void;
};

export function useReaderBookmarkActions({
  runtime,
  snapshot,
  currentHitEntries,
  chapterTitle,
  bookmarks,
  addBookmark,
  removeBookmark,
  onPullStart,
}: ReaderBookmarkActionsOptions) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const bookmarkPullOrigin = useRef<
    | {
        snapshot: ReaderSnapshot;
        input: Omit<ReaderBookmark, 'id' | 'bookId' | 'createdAt'>;
        bookmarkId?: string;
      }
    | undefined
  >(undefined);
  const bookmarkUpdating = useRef(false);
  const [bookmarkVisualOverride, setBookmarkVisualOverride] = useState<{
    bookId?: string;
    revisionId: number;
    spreadIndex: number;
    renderId?: number;
    bookmarked: boolean;
  }>();
  const currentLocator = snapshot.position?.locator;
  const currentBookmark = currentLocator
    ? bookmarks.find((bookmark) => isBookmarkOnPage(bookmark, currentLocator, currentHitEntries))
    : undefined;
  const resolvePageBookmark = useCallback(
    (pageSnapshot: ReaderSnapshot, pageFrame: ReaderRenderFrame) => {
      if (
        bookmarkVisualOverride &&
        bookmarkVisualOverride.bookId === pageSnapshot.bookId &&
        bookmarkVisualOverride.revisionId === pageSnapshot.revisionId &&
        bookmarkVisualOverride.spreadIndex === pageSnapshot.spreadIndex &&
        bookmarkVisualOverride.renderId === pageSnapshot.renderId
      )
        return bookmarkVisualOverride.bookmarked;
      if (
        currentBookmark &&
        pageSnapshot.revisionId === snapshot.revisionId &&
        pageSnapshot.spreadIndex === snapshot.spreadIndex &&
        pageSnapshot.renderId === snapshot.renderId
      )
        return true;
      return hasBookmarkOnRenderedPage(bookmarks, pageSnapshot, pageFrame);
    },
    [bookmarkVisualOverride, bookmarks, currentBookmark, snapshot],
  );
  const beginBookmarkPull = useCallback(() => {
    bookmarkPullOrigin.current = undefined;
    if (bookmarkUpdating.current) return;
    const snapshot = runtime.getSnapshot();
    const locator = snapshot.position?.locator;
    if (snapshot.phase !== 'ready' || !locator) return;
    const entries = runtime.getCurrentHitMap()?.entries ?? [];
    const bookmarkLocator = {
      ...locator,
      sourceRange: undefined,
      sourcePoint:
        entries.find((entry) => entry.sourcePoint && entry.text.length > 0)?.sourcePoint ??
        locator.sourcePoint ??
        locator.sourceRange?.start,
    };
    bookmarkPullOrigin.current = {
      snapshot,
      input: {
        locator: bookmarkLocator,
        label: snapshot.chapterTitle ?? chapterTitle,
        text: entries
          .map((entry) => entry.text)
          .join('')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180),
      },
      bookmarkId: bookmarks.find((bookmark) => isBookmarkOnPage(bookmark, bookmarkLocator, entries))?.id,
    };
    onPullStart();
  }, [bookmarks, chapterTitle, onPullStart, runtime]);
  const commitBookmarkPull = useCallback(async () => {
    const origin = bookmarkPullOrigin.current;
    bookmarkPullOrigin.current = undefined;
    const latest = runtime.getSnapshot();
    if (
      !origin ||
      bookmarkUpdating.current ||
      latest.phase !== 'ready' ||
      latest.bookId !== origin.snapshot.bookId ||
      latest.revisionId !== origin.snapshot.revisionId ||
      latest.spreadIndex !== origin.snapshot.spreadIndex ||
      latest.renderId !== origin.snapshot.renderId
    )
      return;
    bookmarkUpdating.current = true;
    setBookmarkVisualOverride({
      bookId: origin.snapshot.bookId,
      revisionId: origin.snapshot.revisionId,
      spreadIndex: origin.snapshot.spreadIndex,
      renderId: origin.snapshot.renderId,
      bookmarked: !origin.bookmarkId,
    });
    try {
      if (origin.bookmarkId) {
        await removeBookmark(origin.bookmarkId);
        toast.show({ variant: 'success', label: t('reader.bookmarkRemoved') });
      } else {
        await addBookmark(origin.input);
        toast.show({ variant: 'success', label: t('reader.bookmarkSaved') });
      }
      setBookmarkVisualOverride(undefined);
    } catch {
      setBookmarkVisualOverride(undefined);
      toast.show({
        variant: 'danger',
        label: t(origin.bookmarkId ? 'reader.bookmarkRemoveFailed' : 'reader.bookmarkSaveFailed'),
      });
    } finally {
      bookmarkUpdating.current = false;
    }
  }, [addBookmark, removeBookmark, runtime, t, toast]);
  return { currentBookmark, resolvePageBookmark, beginBookmarkPull, commitBookmarkPull };
}
