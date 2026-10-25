import type { RitoTocEntry } from '@umbrae-labs/rito-rn';

import type { ReaderTocEntry } from '../contracts';

export function toReaderToc(entry: RitoTocEntry): ReaderTocEntry {
  type MutableEntry = { label: string; href: string; unavailable?: boolean; children: MutableEntry[] };
  const target =
    entry.target.kind === 'locator'
      ? `${entry.target.locator.href}${entry.target.locator.anchorId ? `#${entry.target.locator.anchorId}` : ''}`
      : entry.target.href;
  const root: MutableEntry = {
    label: entry.label,
    href: target,
    ...(entry.target.kind === 'missing' ? { unavailable: true } : {}),
    children: [],
  };
  const visited = new Set<RitoTocEntry>([entry]);
  const stack: { source: RitoTocEntry; output: MutableEntry }[] = [{ source: entry, output: root }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    for (let index = current.source.children.length - 1; index >= 0; index -= 1) {
      const child = current.source.children[index];
      if (visited.has(child)) continue;
      visited.add(child);
      const childTarget =
        child.target.kind === 'locator'
          ? `${child.target.locator.href}${child.target.locator.anchorId ? `#${child.target.locator.anchorId}` : ''}`
          : child.target.href;
      const childOutput: MutableEntry = {
        label: child.label,
        href: childTarget,
        ...(child.target.kind === 'missing' ? { unavailable: true } : {}),
        children: [],
      };
      current.output.children.unshift(childOutput);
      stack.push({ source: child, output: childOutput });
    }
  }
  return root;
}
