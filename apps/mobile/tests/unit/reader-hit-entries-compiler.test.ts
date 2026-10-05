import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { ReaderHitEntry, ReaderSnapshot } from '../../src/reader/contracts';
import type { ReaderRuntime } from '../../src/reader/runtime/core/reader-runtime';

const require = createRequire(import.meta.url);
const babelRequire = createRequire(require.resolve('babel-preset-expo'));
const babel = babelRequire('@babel/core');

// Exercise the compiler used by Metro: ordinary hook mocks cannot catch a
// runtime getter memoized against a stable runtime object across page turns.
function compileHook() {
  const filename = resolve('src/features/reader/hooks/session/use-reader-hit-entries.ts');
  const code = babel.transformSync(readFileSync(filename, 'utf8'), {
    filename,
    caller: {
      name: 'metro',
      platform: 'android',
      isDev: true,
      supportsStaticESM: false,
      supportsReactCompiler: true,
    },
  }).code;
  expect(code).toContain('react/compiler-runtime');
  const caches: unknown[][] = [];
  let cursor = 0;
  let memo: { deps: readonly unknown[]; value: unknown } | undefined;
  const module = {
    exports: {} as {
      useReaderHitEntries: (
        runtime: ReaderRuntime,
        snapshot: ReaderSnapshot,
        enabled: boolean,
      ) => readonly ReaderHitEntry[];
    },
  };
  const load = (name: string) => {
    if (name === 'react/compiler-runtime')
      return {
        c: (size: number) => (caches[cursor++] ??= Array(size).fill(Symbol.for('react.memo_cache_sentinel'))),
      };
    if (name === 'react')
      return {
        useMemo: (factory: () => unknown, deps: readonly unknown[]) => {
          if (!memo || deps.some((value, index) => !Object.is(value, memo!.deps[index]))) {
            memo = { deps, value: factory() };
          }
          return memo.value;
        },
      };
    return babelRequire(name);
  };
  runInThisContext(`(function(require, module, exports) {${code}\n})`, { filename })(load, module, module.exports);
  return (runtime: ReaderRuntime, snapshot: ReaderSnapshot, enabled = true) => {
    cursor = 0;
    return module.exports.useReaderHitEntries(runtime, snapshot, enabled);
  };
}

describe('compiled reader hit entries', () => {
  it('refreshes drag coordinates across rapid page turns and same-slot render replacements', () => {
    const render = compileHook();
    let snapshot = { phase: 'ready', revisionId: 1, spreadIndex: 0, renderId: 1 } as ReaderSnapshot;
    let entries: readonly ReaderHitEntry[] = [];
    const runtime = {
      getSnapshot: () => snapshot,
      getCurrentHitMap: () => ({ pageIndex: 0, entries }),
    } as unknown as ReaderRuntime;
    for (const [spreadIndex, renderId] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [1, 2],
      [1, 4],
    ]) {
      snapshot = { ...snapshot, spreadIndex, renderId };
      entries = [
        {
          pageIndex: spreadIndex,
          text: `page ${renderId}`,
          bounds: { x: 20, y: renderId * 40, width: 120, height: 24 },
        },
      ];
      expect(render(runtime, snapshot)).toBe(entries);
    }
  });

  it('withholds coordinates while the runtime is ahead of the rendered snapshot', () => {
    const render = compileHook();
    const previous = { phase: 'ready', revisionId: 1, spreadIndex: 1, renderId: 2 } as ReaderSnapshot;
    const current = { ...previous, renderId: 3 };
    const entries = [{ pageIndex: 1, text: 'new page', bounds: { x: 20, y: 40, width: 120, height: 24 } }];
    const runtime = {
      getSnapshot: () => current,
      getCurrentHitMap: () => ({ pageIndex: 1, entries }),
    } as unknown as ReaderRuntime;
    expect(render(runtime, previous)).toEqual([]);
    expect(render(runtime, current)).toBe(entries);
    expect(render(runtime, current, false)).toEqual([]);
  });
});
