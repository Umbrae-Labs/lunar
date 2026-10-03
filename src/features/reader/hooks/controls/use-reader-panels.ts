import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n';

export type ReaderPanel = 'toc' | 'marks' | 'progress' | 'appearance' | 'typography';

export function useReaderPanels(isReady: boolean) {
  const { t } = useTranslation();
  const [activePanel, setActivePanel] = useState<ReaderPanel>();
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControls = useCallback(() => setControlsVisible(false), []);
  const toggleControls = useCallback(() => setControlsVisible((value) => !value), []);
  const setPanelOpen = useCallback((panel: ReaderPanel, open: boolean) => {
    setActivePanel((current) => (open ? panel : current === panel ? undefined : current));
  }, []);
  const tabItems = useMemo(
    () =>
      [
        {
          key: 'toc',
          accessibilityLabel: t('reader.openToc'),
          name: { ios: 'list.bullet', android: 'format_list_bulleted', web: 'list' },
          isDisabled: !isReady,
        },
        {
          key: 'marks',
          accessibilityLabel: t('reader.openMarks'),
          name: { ios: 'bookmark', android: 'bookmarks', web: 'bookmarks' },
          isDisabled: !isReady,
        },
        {
          key: 'progress',
          accessibilityLabel: t('reader.openProgress'),
          name: { ios: 'chart.bar', android: 'timeline', web: 'timeline' },
          isDisabled: !isReady,
        },
        {
          key: 'appearance',
          accessibilityLabel: t('reader.openAppearance'),
          name: { ios: 'sun.max', android: 'brightness_high', web: 'brightness_high' },
        },
        {
          key: 'typography',
          accessibilityLabel: t('reader.openTypography'),
          name: { ios: 'textformat.size', android: 'format_size', web: 'format_size' },
        },
      ] as const,
    [isReady, t],
  );

  return { activePanel, controlsVisible, hideControls, toggleControls, setPanelOpen, tabItems };
}
