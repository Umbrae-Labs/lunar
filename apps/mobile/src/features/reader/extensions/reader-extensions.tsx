import { createContext, useContext, useSyncExternalStore, type PropsWithChildren, type ReactNode } from 'react';

import type { IconSource } from '@/components/ui/icon';
import type { ReaderSourceRange, ReaderTextSelectionRange } from '@/reader';
import type { ReaderSelectionAction } from '../components/controls/selection';
import type { ReaderToolbarAction } from '../components/navigation/controls';
import type { ReaderHighlightColor } from '../domain/reader-highlight';
import type { ReaderSessionPort } from '../domain/reader-session-port';
import type { ReaderPanelDescriptor } from '../hooks/controls/use-reader-panels';

// Extension points the reader screen offers to other features. The reader
// only renders what a host provides; it never knows who the host is.

export interface ReaderExtensionPanel extends ReaderPanelDescriptor {
  readonly title: string;
  readonly renderContent: (props: { readonly close: () => void }) => ReactNode;
}

export interface ReaderExtensionOverlay {
  readonly key: string;
  /** Interactive overlays receive touches; the others let every touch through to the page. */
  readonly interactive: boolean;
  readonly render: () => ReactNode;
}

/** An entry of the reader's floating button. The reader places and moves the button itself. */
export interface ReaderExtensionFloatingAction {
  readonly key: string;
  readonly accessibilityLabel: string;
  readonly name: IconSource;
  /** A short mark such as a count. */
  readonly badge?: string;
  readonly onPress: () => void;
}

/** The reader's controls as the screen currently shows them. */
export interface ReaderExtensionChrome {
  readonly controlsVisible: boolean;
  /** Space the system bars and visible reader controls cover at each edge. */
  readonly insets: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
}

export type ReaderExtensionDecorationStyle = 'background' | 'outline' | 'underline' | 'wavy';
export type ReaderExtensionDecorationColor = ReaderHighlightColor | 'accent';

/** A mark painted on the page text through the reader's overlay sources. */
export interface ReaderExtensionDecoration {
  readonly key: string;
  readonly href?: string;
  /** Painted frame the page-local range was measured on. */
  readonly frameKey?: string;
  readonly revisionId?: number;
  readonly range?: ReaderTextSelectionRange;
  readonly sourceRange?: ReaderSourceRange;
  readonly text: string;
  readonly style: ReaderExtensionDecorationStyle;
  readonly color: ReaderExtensionDecorationColor;
}

/** The selection as captured when an extension action is pressed. */
export interface ReaderExtensionSelection {
  readonly text: string;
  readonly href?: string;
  readonly chapterTitle?: string;
  readonly range: ReaderTextSelectionRange;
  readonly sourceRange?: ReaderSourceRange;
  readonly revisionId: number;
  readonly frameKey?: string;
}

export interface ReaderExtensionContributions {
  readonly panels: readonly ReaderExtensionPanel[];
  readonly toolbarActions: readonly ReaderToolbarAction[];
  readonly overlays: readonly ReaderExtensionOverlay[];
  readonly floatingActions: readonly ReaderExtensionFloatingAction[];
  readonly decorations: readonly ReaderExtensionDecoration[];
}

export interface ReaderExtensionSessionControls {
  openPanel(key: string): boolean;
  closePanel(key?: string): void;
}

export interface ReaderExtensionHost {
  subscribe(listener: () => void): () => void;
  /** Returns the same object until a contribution changes. */
  getContributions(): ReaderExtensionContributions;
  /** Lets extensions add, hide or reorder selection actions; built-in actions cannot be replaced. */
  resolveSelectionActions(
    builtin: readonly ReaderSelectionAction[],
    selection: ReaderExtensionSelection,
  ): readonly ReaderSelectionAction[];
  attachSession(port: ReaderSessionPort, controls: ReaderExtensionSessionControls): () => void;
  /** The reader screen reports its controls so extensions can keep clear of them; `undefined` on leave. */
  setChrome(chrome: ReaderExtensionChrome | undefined): void;
}

const EmptyContributions: ReaderExtensionContributions = {
  panels: [],
  toolbarActions: [],
  overlays: [],
  floatingActions: [],
  decorations: [],
};

export const NoReaderExtensions: ReaderExtensionHost = {
  subscribe: () => () => undefined,
  getContributions: () => EmptyContributions,
  resolveSelectionActions: (builtin) => builtin,
  attachSession: () => () => undefined,
  setChrome: () => undefined,
};

const ReaderExtensionContext = createContext<ReaderExtensionHost>(NoReaderExtensions);

export function ReaderExtensionProvider({ host, children }: PropsWithChildren<{ readonly host: ReaderExtensionHost }>) {
  return <ReaderExtensionContext.Provider value={host}>{children}</ReaderExtensionContext.Provider>;
}

export function useReaderExtensions() {
  const host = useContext(ReaderExtensionContext);
  const contributions = useSyncExternalStore(host.subscribe, host.getContributions, host.getContributions);
  return { host, contributions };
}
