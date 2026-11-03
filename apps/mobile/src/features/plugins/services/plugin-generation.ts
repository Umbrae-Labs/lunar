import type { ComponentType } from 'react';
import type {
  CommandHandler,
  Disposable,
  PluginContext,
  PluginDefinition,
  ReaderEventName,
  ReaderInterceptors,
} from '@umbrae-labs/lunar-plugin-sdk';
import { LunarPluginError } from '../domain/plugin-error';

type Interceptor = ReaderInterceptors[keyof ReaderInterceptors];

/**
 * Everything one execution of a plugin's entry registered. Registrations stay
 * invisible until activation commits the generation, and all of them end
 * together when the generation is disposed.
 */
export class PluginGeneration {
  committed = false;
  disposed = false;
  definition?: PluginDefinition;
  context?: PluginContext;
  readonly abort = new AbortController();
  readonly commands = new Map<string, CommandHandler>();
  /** Keyed by `${slot}:${id}` or `route:${pageId}`. */
  readonly components = new Map<string, ComponentType<never>>();
  readonly readerListeners = new Map<ReaderEventName, Set<(payload: unknown) => void>>();
  readonly interceptors = {
    selectionMenu: new Set<ReaderInterceptors['selectionMenu']>(),
    toolbarItems: new Set<ReaderInterceptors['toolbarItems']>(),
  };
  /** Over-budget runs per interceptor; persistent offenders are skipped. */
  readonly interceptorOverruns = new Map<Interceptor, number>();
  private readonly cleanups = new Set<() => void>();

  constructor(readonly number: number) {}

  assertLive(): void {
    if (this.disposed) throw new LunarPluginError('GENERATION_ENDED', 'This plugin instance has been stopped');
  }

  /** Records a cleanup that runs on `dispose()` or at the end of the generation, whichever is first. */
  track(cleanup: () => void, onChange?: () => void): Disposable {
    this.assertLive();
    let active = true;
    const run = () => {
      if (!active) return;
      active = false;
      this.cleanups.delete(run);
      cleanup();
      onChange?.();
    };
    this.cleanups.add(run);
    return { dispose: run };
  }

  /** Ends the generation; returns errors from plugin-owned disposables for logging. */
  dispose(): readonly unknown[] {
    if (this.disposed) return [];
    this.disposed = true;
    this.abort.abort();
    const errors: unknown[] = [];
    for (const subscription of this.context?.subscriptions ?? []) {
      try {
        subscription.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const cleanup of [...this.cleanups]) cleanup();
    this.commands.clear();
    this.components.clear();
    this.readerListeners.clear();
    this.interceptors.selectionMenu.clear();
    this.interceptors.toolbarItems.clear();
    return errors;
  }
}
