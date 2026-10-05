import type { ReaderPageAnimationStyle } from '../core/page-turn-types';
import type { ReaderPageTurnEffect } from '../core/page-turn-effect';
import { curlPageTurnEffect } from './curl/strategy';
import { nonePageTurnEffect } from './none/strategy';
import { slidePageTurnEffect } from './slide/strategy';

const PAGE_TURN_EFFECTS: Readonly<Record<ReaderPageAnimationStyle, ReaderPageTurnEffect>> = {
  none: nonePageTurnEffect,
  overlay: nonePageTurnEffect,
  page: curlPageTurnEffect,
  pageCurl: curlPageTurnEffect,
  simulation: curlPageTurnEffect,
  slide: slidePageTurnEffect,
};

export function getReaderPageTurnEffect(style: ReaderPageAnimationStyle): ReaderPageTurnEffect {
  return PAGE_TURN_EFFECTS[style] ?? nonePageTurnEffect;
}
