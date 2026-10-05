import { describe, expect, it } from 'vitest';

import { resolvePublicationHref } from '../../src/reader/runtime/pagination/rito-native-pagination-backend';

const spine = [
  { href: 'OEBPS/Text/chapter-1.xhtml' },
  { href: 'OEBPS/Text/chapter-2.xhtml' },
  { href: 'OEBPS/Notes/endnotes.xhtml' },
];

describe('reader publication href resolution', () => {
  it('keeps a fragment-only link in the current chapter', () => {
    expect(resolvePublicationHref('OEBPS/Text/chapter-1.xhtml', '#section-2', spine))
      .toBe('OEBPS/Text/chapter-1.xhtml#section-2');
  });

  it('resolves a chapter-relative link against the source directory', () => {
    expect(resolvePublicationHref('OEBPS/Text/chapter-1.xhtml', '../Notes/endnotes.xhtml#note-4', spine))
      .toBe('OEBPS/Notes/endnotes.xhtml#note-4');
  });

  it('preserves an href that already matches the publication spine', () => {
    expect(resolvePublicationHref('OEBPS/Text/chapter-1.xhtml', 'OEBPS/Text/chapter-2.xhtml', spine))
      .toBe('OEBPS/Text/chapter-2.xhtml');
  });

  it('resolves URL encoded hrefs and anchors', () => {
    const unicodeSpine = [{ href: 'OEBPS/Text/第一章.xhtml' }];
    expect(
      resolvePublicationHref(
        'OEBPS/Text/intro.xhtml',
        '%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml#%E6%A0%87%E9%A2%98',
        unicodeSpine,
      ),
    ).toBe('OEBPS/Text/第一章.xhtml#%E6%A0%87%E9%A2%98');
  });

  it('resolves hrefs when TOC has filename only but spine has subfolder path', () => {
    expect(resolvePublicationHref('OEBPS/Text/chapter-1.xhtml', 'chapter-2.xhtml#part1', spine))
      .toBe('OEBPS/Text/chapter-2.xhtml#part1');
  });
});
