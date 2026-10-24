export { default as ReaderScreen } from './screens/reader-screen';
export { FontSheet } from './components/typography/font-sheet';
export type { ReaderReadingState } from './domain/reader-reading-state';
export type { ReaderHighlight } from './domain/reader-highlight';
export {
  findMostRecentlyReadBookId,
  findReaderReadingState,
  saveReaderReadingState,
} from './services/reading-state-service';
export { createReaderHighlight, listReaderHighlights } from './services/highlight-service';
export {
  importReaderFont,
  removeReaderFont,
  type ReaderFontImportFailure,
  type ReaderFontImportResult,
} from './services/reader-font-service';

export { summarizeReadingTime, readingDateKey, type ReadingSession } from './domain/reading-time';

export { useReaderSessionPortContext } from './hooks/session/use-reader-session-port';
export type {
  ReaderSessionBook,
  ReaderSessionPort,
  ReaderSessionState,
  ReaderVisibleText,
} from './domain/reader-session-port';
export type {
  ReaderSessionChapter,
  ReaderSessionEvent,
  ReaderSessionEventOf,
  ReaderSessionEventType,
  ReaderSessionLifecycle,
  ReaderSessionLocation,
} from './domain/reader-session-events';
export type { ReaderSessionEventSource } from './services/reader-session-event-bus';
export type { ReaderInteractionMode } from './domain/reader-interaction';
export type { ReaderPanelDescriptor } from './hooks/controls/use-reader-panels';
export type { ReaderToolbarAction } from './components/navigation/controls';
export type { ReaderSelectionAction } from './components/controls/selection';
export {
  NoReaderExtensions,
  ReaderExtensionProvider,
  type ReaderExtensionContributions,
  type ReaderExtensionDecoration,
  type ReaderExtensionDecorationColor,
  type ReaderExtensionDecorationStyle,
  type ReaderExtensionHost,
  type ReaderExtensionOverlay,
  type ReaderExtensionPanel,
  type ReaderExtensionSelection,
  type ReaderExtensionSessionControls,
} from './extensions/reader-extensions';
