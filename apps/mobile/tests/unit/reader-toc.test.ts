import type { RitoTocEntry } from '@umbrae-labs/rito-rn';
import { describe, expect, it } from 'vitest';

import { toReaderToc } from '../../src/reader/rito/rito-toc';

describe('reader table of contents targets', () => {
  it('retains known missing targets without disabling reachable descendants', () => {
    const entry: RitoTocEntry = {
      id: 1,
      label: 'Obsolete cover',
      target: { kind: 'missing', href: 'old-cover.xhtml' },
      children: [
        {
          id: 2,
          label: 'Chapter',
          target: { kind: 'locator', locator: { href: 'chapter.xhtml', anchorId: 'section' } },
          children: [
            { id: 3, label: 'Missing section', target: { kind: 'missing', href: 'gone.xhtml' }, children: [] },
          ],
        },
      ],
    };
    expect(toReaderToc(entry)).toEqual({
      label: 'Obsolete cover',
      href: 'old-cover.xhtml',
      unavailable: true,
      children: [
        {
          label: 'Chapter',
          href: 'chapter.xhtml#section',
          children: [{ label: 'Missing section', href: 'gone.xhtml', unavailable: true, children: [] }],
        },
      ],
    });
  });

  it('does not classify an external target as missing', () => {
    expect(
      toReaderToc({
        id: 1,
        label: 'Website',
        target: { kind: 'external', href: 'https://example.org/' },
        children: [],
      }),
    ).toEqual({ label: 'Website', href: 'https://example.org/', children: [] });
  });

  it('keeps an unlinked group and its reachable chapter', () => {
    expect(
      toReaderToc({
        id: 1,
        label: 'Part One',
        target: { kind: 'missing', href: '' },
        children: [
          { id: 2, label: 'Chapter', target: { kind: 'locator', locator: { href: 'chapter.xhtml' } }, children: [] },
        ],
      }),
    ).toEqual({
      label: 'Part One',
      href: '',
      unavailable: true,
      children: [{ label: 'Chapter', href: 'chapter.xhtml', children: [] }],
    });
  });
});
