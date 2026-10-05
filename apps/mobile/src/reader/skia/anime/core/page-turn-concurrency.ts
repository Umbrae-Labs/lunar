import type { ReaderAutomaticTurn, ReaderPageTransitionState } from './page-turn-types';

export const AUTOMATIC_PAGE_TURN_START_INTERVAL_MS = 100;
export const AUTOMATIC_PAGE_TURN_MAX_LANES = 10;

export function appendAutomaticPageTurn(
  turns: readonly ReaderAutomaticTurn[],
  turn: ReaderAutomaticTurn,
): readonly ReaderAutomaticTurn[] {
  return [...turns, turn];
}

export function automaticPageTurnPaintOrder(
  turns: readonly ReaderAutomaticTurn[],
  direction: 1 | -1,
): readonly ReaderAutomaticTurn[] {
  return direction > 0 ? [...turns].reverse() : turns;
}

export function automaticPageTurnTransition(turn: ReaderAutomaticTurn): ReaderPageTransitionState {
  return {
    from: turn.from,
    toKey: turn.to.key,
    direction: turn.direction,
  };
}
