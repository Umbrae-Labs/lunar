import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n';
import type { TabBarItem } from '../../components/navigation/tab-bar';

export type BuiltinReaderPanel = 'toc' | 'marks' | 'progress' | 'appearance' | 'typography';

/** A drawer reachable from the reader's tab bar; built-in and extension panels share this shape. */
export type ReaderPanelDescriptor = TabBarItem;

export function useBuiltinReaderPanels(isReady: boolean): readonly ReaderPanelDescriptor[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        key: 'toc',
        accessibilityLabel: t('reader.openToc'),
        name: 'list',
        isDisabled: !isReady,
      },
      {
        key: 'marks',
        accessibilityLabel: t('reader.openMarks'),
        name: 'bookMarked',
        isDisabled: !isReady,
      },
      {
        key: 'progress',
        accessibilityLabel: t('reader.openProgress'),
        name: 'progress',
        isDisabled: !isReady,
      },
      {
        key: 'appearance',
        accessibilityLabel: t('reader.openAppearance'),
        name: 'sun',
      },
      {
        key: 'typography',
        accessibilityLabel: t('reader.openTypography'),
        name: 'textSize',
      },
    ],
    [isReady, t],
  );
}

export function useReaderPanels(panels: readonly ReaderPanelDescriptor[]) {
  const [requestedPanel, setActivePanel] = useState<string>();
  // A panel whose extension was removed while open must not keep blocking the page.
  const activePanel = panels.some((panel) => panel.key === requestedPanel) ? requestedPanel : undefined;
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControls = useCallback(() => setControlsVisible(false), []);
  const toggleControls = useCallback(() => setControlsVisible((value) => !value), []);
  // A drawer that finishes closing after another one opened must not close the newer drawer.
  const setPanelOpen = useCallback((panel: string, open: boolean) => {
    setActivePanel((current) => (open ? panel : current === panel ? undefined : current));
  }, []);
  /** Opens a registered, enabled panel and reports whether it did. */
  const selectPanel = useCallback(
    (key: string) => {
      const panel = panels.find((item) => item.key === key);
      if (!panel || panel.isDisabled) return false;
      setPanelOpen(key, true);
      return true;
    },
    [panels, setPanelOpen],
  );

  return { activePanel, controlsVisible, hideControls, toggleControls, setPanelOpen, selectPanel, tabItems: panels };
}
