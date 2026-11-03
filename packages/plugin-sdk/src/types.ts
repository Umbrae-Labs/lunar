import type { ComponentType } from 'react';
import type { IconSpec, PluginComponentSlot } from './manifest.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface Disposable {
  dispose(): void;
}

export type PluginSource = 'official' | 'community' | 'development';

export interface PluginIdentity {
  readonly id: string;
  readonly version: string;
  /** Increases every time the host executes the plugin's entry again. */
  readonly generation: number;
  readonly source: PluginSource;
}

export interface HostInfo {
  readonly sdkVersion: string;
  readonly appVersion: string;
  readonly platform: 'android' | 'ios' | 'web';
  readonly locale: string;
  readonly colorScheme: 'light' | 'dark';
  /** Named capability versions; a missing name means the capability is unavailable. */
  readonly capabilities: Readonly<Record<string, number>>;
}

export interface PluginDefinition {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
  /**
   * Converts stored data when the manifest's `dataVersion` differs from the
   * version the data was written with. Runs before `activate`; when it throws,
   * the host restores the data and keeps the previously installed version.
   */
  migrate?(ctx: MigrationContext): void | Promise<void>;
}

export interface MigrationContext {
  readonly plugin: PluginIdentity;
  /** Data version found in storage. Lower than `to` for updates, higher for downgrades. */
  readonly from: number;
  /** The manifest's `dataVersion`. */
  readonly to: number;
  readonly storage: StorageAPI;
  readonly settings: SettingsAPI;
  readonly log: LogAPI;
}

export interface PluginContext {
  readonly plugin: PluginIdentity;
  readonly host: HostInfo;
  /** Disposables released together with the plugin's registrations. */
  readonly subscriptions: Disposable[];
  readonly commands: CommandsAPI;
  readonly ui: UIAPI;
  readonly reader: ReaderAPI;
  readonly settings: SettingsAPI;
  readonly storage: StorageAPI;
  readonly library: LibraryAPI;
  readonly network: NetworkAPI;
  /** Requires the `credentials` capability. */
  readonly credentials: CredentialsAPI;
  readonly services: HostServicesAPI;
  readonly i18n: I18nAPI;
  readonly log: LogAPI;
}

// Commands

export type CommandSource = 'toolbar' | 'panel' | 'selection' | 'route' | 'plugin';

export interface CommandContext {
  readonly source: CommandSource;
  readonly args?: JsonValue;
  readonly signal: AbortSignal;
}

export type CommandHandler = (context: CommandContext) => void | Promise<void>;

export interface CommandsAPI {
  register(id: string, handler: CommandHandler): Disposable;
  execute(id: string, args?: JsonValue): Promise<void>;
}

// Interface

export interface SlotProps {
  readonly slotId: string;
  /** Present for panels: closes the drawer that hosts the component. */
  readonly close?: () => void;
}

export interface RouteProps {
  readonly pageId: string;
  readonly params: Readonly<Record<string, string>>;
}

export interface ConfirmOptions {
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
}

export type ToastTone = 'default' | 'success' | 'danger';

export interface UIAPI {
  registerSlot(slot: PluginComponentSlot, id: string, component: ComponentType<SlotProps>): Disposable;
  registerRoute(pageId: string, component: ComponentType<RouteProps>): Disposable;
  openPanel(id: string): void;
  closePanel(id?: string): void;
  openRoute(pageId: string, params?: Readonly<Record<string, string>>): void;
  toast(message: string, tone?: ToastTone): void;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

// Reader

export interface BookInfo {
  readonly ref: string;
  readonly title: string;
  readonly author?: string;
  readonly language?: string;
}

export interface ChapterInfo {
  readonly ref: string;
  readonly title?: string;
}

export interface ReaderLocation {
  /** Opaque position reference accepted by `goTo`. */
  readonly locator?: string;
  readonly chapter?: ChapterInfo;
  /** Whole-book progress from 0 to 1. */
  readonly progress: number;
  readonly page?: number;
  readonly totalPages?: number;
}

export type ReaderInteractionMode = 'loading' | 'modal' | 'panel' | 'selecting' | 'turning' | 'idle';

export interface ReaderSessionInfo {
  readonly book: BookInfo;
  readonly phase: 'opening' | 'open';
  readonly location?: ReaderLocation;
  readonly interaction: ReaderInteractionMode;
  readonly hasSelection: boolean;
}

export interface ReaderEvents {
  open: { readonly book: BookInfo };
  ready: { readonly book: BookInfo; readonly location: ReaderLocation };
  locationChange: { readonly book: BookInfo; readonly location: ReaderLocation };
  chapterChange: { readonly book: BookInfo; readonly previous?: ChapterInfo; readonly chapter?: ChapterInfo };
  selectionChange: { readonly book: BookInfo; readonly hasSelection: boolean };
  layoutChange: { readonly book: BookInfo; readonly location: ReaderLocation };
  paginationChange: { readonly book: BookInfo; readonly totalPages?: number; readonly complete: boolean };
  close: { readonly book: BookInfo; readonly location?: ReaderLocation };
}

export type ReaderEventName = keyof ReaderEvents;

export interface TextSegment {
  readonly text: string;
  /** Opaque range reference accepted by decorations. Valid for the current layout. */
  readonly range: string;
  /**
   * Identity of this piece of the book's text, independent of layout: the same
   * text keeps its key across page turns, reflows and sessions. Absent when the
   * host cannot place the text in the book source.
   */
  readonly key?: string;
  readonly chapterRef?: string;
}

export interface SelectionSnapshot {
  readonly selectionRef: string;
  readonly text: string;
  readonly range?: string;
  readonly chapterRef?: string;
  readonly chapterTitle?: string;
  readonly capturedAt: number;
}

export interface SearchHit {
  /** Surrounding text reported by the engine. */
  readonly context: string;
  readonly locator?: string;
  readonly chapterRef?: string;
}

export interface TocItem {
  readonly title: string;
  readonly chapterRef: string;
  readonly children: readonly TocItem[];
}

export type NavigationTarget =
  { readonly locator: string } | { readonly chapterRef: string } | { readonly progress: number };

export interface SearchOptions {
  readonly limit?: number;
  readonly caseSensitive?: boolean;
  readonly signal?: AbortSignal;
}

export interface ReaderSessionAPI {
  current(): ReaderSessionInfo | undefined;
  subscribe(listener: () => void): Disposable;
  getToc(): Promise<readonly TocItem[]>;
  getVisibleText(): Promise<readonly TextSegment[]>;
  /** Requires the `reader.chapterText` capability. */
  getChapterText(chapterRef?: string): Promise<readonly TextSegment[]>;
  readSelection(selectionRef: string): Promise<SelectionSnapshot>;
  search(query: string, options?: SearchOptions): Promise<readonly SearchHit[]>;
  /** Resolves to `false` when the reader's current interaction does not allow navigation. */
  goTo(target: NavigationTarget): Promise<boolean>;
  next(): Promise<boolean>;
  previous(): Promise<boolean>;
}

export type DecorationStyle = 'background' | 'outline' | 'underline' | 'wavy';
export type DecorationColor = 'yellow' | 'pink' | 'purple' | 'blue' | 'green' | 'accent';

export interface Decoration {
  readonly range: string;
  readonly style: DecorationStyle;
  readonly color: DecorationColor;
}

export interface DecorationLayer extends Disposable {
  set(decorations: readonly Decoration[]): void;
  clear(): void;
}

export interface DecorationsAPI {
  create(layerId: string): DecorationLayer;
}

export interface SelectionMenuItem {
  readonly id: string;
  readonly title: string;
  readonly icon?: IconSpec;
  /** Host items can be hidden or reordered; they cannot be replaced. */
  readonly builtin?: boolean;
  readonly onPress?: (selection: SelectionSnapshot) => void;
}

export interface ToolbarItem {
  readonly id: string;
  readonly title: string;
  readonly icon?: IconSpec;
  readonly pluginId: string;
}

export interface ReaderInterceptors {
  selectionMenu(
    items: readonly SelectionMenuItem[],
    context: { readonly book: BookInfo },
  ): readonly SelectionMenuItem[];
  toolbarItems(items: readonly ToolbarItem[], context: { readonly book: BookInfo }): readonly ToolbarItem[];
}

export interface ReaderAPI {
  on<E extends ReaderEventName>(event: E, listener: (payload: ReaderEvents[E]) => void): Disposable;
  intercept<P extends keyof ReaderInterceptors>(point: P, handler: ReaderInterceptors[P]): Disposable;
  readonly session: ReaderSessionAPI;
  readonly decorations: DecorationsAPI;
}

// Settings and storage

export interface SettingsAPI {
  get<T extends JsonValue = JsonValue>(key: string): T;
  set(key: string, value: JsonValue): Promise<void>;
  onChange(key: string, listener: (value: JsonValue) => void): Disposable;
}

/** Writes of one plugin apply in call order, so `update` never loses a concurrent write. */
export interface StorageAPI {
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  /**
   * Reads, transforms and writes a value as one step. The updater must be
   * synchronous; returning `undefined` deletes the key.
   */
  update<T extends JsonValue = JsonValue>(
    key: string,
    updater: (current: T | undefined) => T | undefined,
  ): Promise<T | undefined>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<readonly string[]>;
}

// Network and host services

export interface NetworkRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Binary mode avoids decoding the response into a second, text-sized allocation. */
  readonly responseType?: 'text' | 'bytes';
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /**
   * Id of a credential declared in the manifest. The host adds its header when the URL lies under
   * the address the user confirmed for it, and refuses to follow redirects for the request.
   */
  readonly credential?: string;
}

export interface NetworkResponseHead {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

export interface NetworkStreamRequest extends Omit<NetworkRequest, 'responseType'> {
  /** Called once with the status and headers, before any text. */
  readonly onResponse?: (head: NetworkResponseHead) => void;
  /** Receives the UTF-8 decoded body in arrival order. */
  readonly onText: (text: string) => void;
}

export interface NetworkResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** UTF-8 decoded response text; empty when the request uses binary responseType. */
  readonly body: string;
  readonly bytes: Uint8Array;
  json<T = JsonValue>(): T;
}

export interface NetworkAPI {
  request(request: NetworkRequest): Promise<NetworkResponse>;
  /**
   * Delivers the body while it arrives, for server-sent events and similar responses. Resolves
   * when the body ends. `timeoutMs` bounds the wait for each piece of data. Requires the
   * `network.stream` capability.
   */
  stream(request: NetworkStreamRequest): Promise<NetworkResponseHead>;
}

// Credentials

export interface CredentialStatus {
  readonly id: string;
  readonly configured: boolean;
  /** The address the user allowed the key for; the key is only sent to URLs under it. */
  readonly baseUrl?: string;
}

/** Plugins see whether a key is set and where it may go, never the key itself. */
export interface CredentialsAPI {
  get(id: string): CredentialStatus;
  onChange(id: string, listener: (status: CredentialStatus) => void): Disposable;
  /** Opens Lunar's credential sheet; resolves with the status once the user closes it. */
  configure(id: string): Promise<CredentialStatus>;
}

export interface EpubImport {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  /** Import progress from 0 to 1. */
  readonly onProgress?: (progress: number) => void;
}

export interface ImportedLibraryBook {
  readonly id: string;
  readonly title: string;
  readonly author?: string;
  readonly language?: string;
}

export interface LibraryAPI {
  /** Imports one user-requested EPUB into the Lunar library. */
  importEpub(input: EpubImport): Promise<ImportedLibraryBook>;
}

export interface HostServicesAPI {
  readonly clipboard: { setText(text: string): Promise<void> };
}

export interface I18nAPI {
  readonly locale: string;
  t(key: string, params?: Readonly<Record<string, string | number>>): string;
}

export interface LogAPI {
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

// Errors

export type PluginErrorCode =
  | 'PERMISSION_DENIED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'INVALID_ARGUMENT'
  | 'INCOMPATIBLE_SDK'
  | 'MODULE_NOT_FOUND'
  | 'NO_ACTIVE_SESSION'
  | 'ANCHOR_UNAVAILABLE'
  | 'GRANT_EXPIRED'
  | 'QUOTA_EXCEEDED'
  | 'NETWORK_DENIED'
  | 'CREDENTIAL_REQUIRED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'GENERATION_ENDED'
  | 'INTEGRITY_FAILED'
  | 'MIGRATION_FAILED';

export interface PluginError extends Error {
  readonly code: PluginErrorCode;
  readonly retryable: boolean;
}

// Theme

export interface Theme {
  readonly colorScheme: 'light' | 'dark';
  readonly colors: {
    readonly foreground: string;
    readonly background: string;
    readonly surface: string;
    readonly surfaceSecondary: string;
    readonly muted: string;
    readonly accent: string;
    readonly border: string;
    readonly danger: string;
    readonly success: string;
  };
  readonly spacing: Readonly<Record<'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl', number>>;
}

export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;
