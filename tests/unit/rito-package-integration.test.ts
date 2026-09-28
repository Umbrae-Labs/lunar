import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-nitro-modules', () => ({ NitroModules: { createHybridObject: () => null } }));

import { decodeRitoReaderPrimitiveList } from '@umbrae-labs/rito-rn';
import { toReaderDisplayList } from '../../src/reader/rito/rito-display-list';

describe('published Rito package integration', () => {
  it('converts the public primitive contract into a Lunar display list', () => {
    const hex = readFileSync(new URL('../fixtures/rito-2-primitive-list.hex', import.meta.url), 'utf8').trim();
    const bytes = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
    const list = decodeRitoReaderPrimitiveList(bytes);
    expect(list.formatVersion).toBe(2);
    expect(toReaderDisplayList(list, 360, 640).resolvedPrimitives?.commandCount).toBe(13);
  });
});
