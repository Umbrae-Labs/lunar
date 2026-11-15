const NATIVE_INTERACTIVE_TURN_ID_PREFIX = 'lunar-interactive:';

export interface NativeInteractivePageTurnIdentity {
  readonly gestureToken: number;
  /** 0 for a pair stocked at idle, before any runtime turn was prepared for it. */
  readonly preparedTurnId: number;
}

/** The composer id of a stocked pair; turns taken from it extend it with `#turn:<n>`. */
export function nativeInteractivePageTurnStockId(
  gestureToken: number,
  preparedTurnId: number,
  paintRevision?: number,
): string {
  return `${NATIVE_INTERACTIVE_TURN_ID_PREFIX}${gestureToken}:${preparedTurnId}${paintRevision === undefined ? '' : `:paint:${paintRevision}`}`;
}

export function readerInteractivePageTurnIdentity(value: string): NativeInteractivePageTurnIdentity | undefined {
  const match = /^lunar-interactive:(\d+):(\d+)(?::paint:\d+)?(?:#turn:\d+(?::rapid)?)?$/.exec(value);
  if (!match) return undefined;
  const gestureToken = Number(match[1]);
  const preparedTurnId = Number(match[2]);
  if (
    !Number.isSafeInteger(gestureToken) ||
    gestureToken <= 0 ||
    !Number.isSafeInteger(preparedTurnId) ||
    preparedTurnId < 0
  ) {
    return undefined;
  }
  return { gestureToken, preparedTurnId };
}
