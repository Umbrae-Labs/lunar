import type { PluginError, PluginErrorCode } from '@umbrae-labs/lunar-plugin-sdk';

const RetryableCodes = new Set<PluginErrorCode>(['TIMEOUT', 'NO_ACTIVE_SESSION', 'GRANT_EXPIRED']);

/** The error every SDK call rejects with; messages never carry text, keys or request bodies. */
export class LunarPluginError extends Error implements PluginError {
  readonly code: PluginErrorCode;
  readonly retryable: boolean;

  constructor(code: PluginErrorCode, message: string, retryable = RetryableCodes.has(code)) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function pluginErrorMessage(error: unknown): string {
  if (error instanceof LunarPluginError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}
