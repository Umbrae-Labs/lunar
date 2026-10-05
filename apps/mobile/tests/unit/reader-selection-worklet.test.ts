import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const babelRequire = createRequire(require.resolve('babel-preset-expo'));
const babel = babelRequire('@babel/core');

function transfer(value: any): any {
  if (typeof value === 'function') {
    if (!value.__workletHash) throw new Error('Selection captured a JS-only function');
    const fn = runInThisContext(`(${value.__initData.code})`);
    return fn.bind({ __closure: transfer(value.__closure) });
  }
  if (Array.isArray(value)) return value.map(transfer);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transfer(item)]));
  }
  return value;
}

describe('reader selection UI worklet', () => {
  it('transfers the rectangle merger before a drag invokes it on the UI runtime', () => {
    const filename = resolve('src/reader/interaction/selection-geometry.ts');
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
    const module = { exports: {} as Record<string, any> };
    runInThisContext(`(function(require, module, exports) {${code}\n})`, { filename })(
      babelRequire,
      module,
      module.exports,
    );
    const rects = transfer(module.exports.readerSelectionRects)(
      [
        { entryIndex: 0, length: 6, vertical: false, bounds: { x: 67, y: 480, width: 120, height: 33 } },
        { entryIndex: 1, length: 1, vertical: true, bounds: { x: 187, y: 480, width: 10, height: 33 } },
        { entryIndex: 2, length: 1, vertical: true, bounds: { x: 197, y: 480, width: 20, height: 33 } },
      ],
      { start: { entryIndex: 0, charIndex: 0 }, end: { entryIndex: 2, charIndex: 1 } },
    );
    expect(rects).toEqual([{ x: 67, y: 480, width: 150, height: 33 }]);
  });
});
