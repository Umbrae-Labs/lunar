import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const babelRequire = createRequire(require.resolve('babel-preset-expo'));
const babel = babelRequire('@babel/core');
const commonRoot = dirname(require.resolve('expensify-common'));
const liveRoot = resolve(dirname(require.resolve('@expensify/react-native-live-markdown')), '../../src');
const markdownRoot = resolve('src/components/markdown');

// Compile the installed parser and its dependencies with the app's Babel config.
// Ordinary unit tests mock the native input and never inspect its worklet closure.
function loadParser() {
  const cache = new Map<string, { exports: any }>();
  function load(filename: string): any {
    const cached = cache.get(filename);
    if (cached) return cached.exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = readFileSync(filename, 'utf8');
    const code = babel.transformSync(source, {
      filename,
      caller: { name: 'metro', platform: 'android', isDev: true, supportsStaticESM: false },
    }).code;
    const localRequire = createRequire(filename);
    const loadDependency = (name: string) => {
      if (name === 'react-native') return { Platform: { OS: 'android' } };
      if (name === '@expensify/react-native-live-markdown') {
        return { parseExpensiMark: load(resolve(liveRoot, 'parseExpensiMark.ts')).default };
      }
      const dependency =
        (filename.startsWith(liveRoot) || filename.startsWith(markdownRoot)) && name.startsWith('.')
          ? resolve(dirname(filename), `${name}.ts`)
          : localRequire.resolve(name);
      if (
        dependency.startsWith(commonRoot) ||
        dependency.startsWith(liveRoot) ||
        dependency.startsWith(markdownRoot) ||
        name === 'html-entities'
      ) {
        return load(dependency);
      }
      return localRequire(name);
    };
    runInThisContext(`(function(require, module, exports, __DEV__) {${code}\n})`, { filename })(
      loadDependency,
      module,
      module.exports,
      true,
    );
    return module.exports;
  }
  return load(resolve(markdownRoot, 'live-markdown-parser.ts')).parseLiveMarkdown;
}

// Follow worklet and context-object factories, as Worklets does during transfer.
// Evaluate their generated code so parsing cannot silently use the JS-thread closure.
function transfer(value: any, cache = new Map<any, any>()): any {
  if (value === null || !['object', 'function'].includes(typeof value)) return value;
  if (cache.has(value)) return cache.get(value);
  if (value.__workletContextObjectFactory) {
    const result = transfer(value.__workletContextObjectFactory, cache)();
    cache.set(value, result);
    return result;
  }
  if (typeof value === 'function') {
    if (!value.__workletHash)
      return () => {
        throw new Error('Called a JS-thread function from the parser');
      };
    const compiled = runInThisContext(`(${value.__initData.code})`);
    const context = { __closure: {} };
    const result = compiled.bind(context);
    cache.set(value, result);
    context.__closure = transfer(value.__closure, cache);
    return result;
  }
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (value instanceof Set) return new Set([...value].map((item) => transfer(item, cache)));
  if (value instanceof Map)
    return new Map([...value].map(([key, item]) => [transfer(key, cache), transfer(item, cache)]));
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Cannot copy value of type ${value.constructor?.name}`);
  }
  const result: any = Array.isArray(value) ? [] : {};
  cache.set(value, result);
  for (const [key, item] of Object.entries(value)) result[key] = transfer(item, cache);
  return result;
}

describe('shared Markdown parser worklet', () => {
  let parser: any;
  beforeAll(() => {
    parser = loadParser();
  }, 30_000);

  it('transfers its complete closure without capturing class instances', () => {
    expect(() => transfer(parser)).not.toThrow();
  });

  it('accepts a caller-specific limit and has no reader-note limit by default', () => {
    const parse = transfer(parser);
    expect(parse('*hello*', 5)).toEqual([]);
    expect(parse('*hello*', 10)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'bold', start: 1, length: 5 })]),
    );
    expect(parse(`${'a'.repeat(20_001)}\n## 标题`)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'h1', length: 2 })]),
    );
  });

  it('formats notes using the transferred parser', () => {
    const parse = transfer(parser);
    expect(parse('*想法* _内容_ ~删除~', 20_000)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'bold', start: 1, length: 2 }),
        expect.objectContaining({ type: 'italic', start: 6, length: 2 }),
        expect.objectContaining({ type: 'strikethrough', start: 11, length: 2 }),
      ]),
    );
    expect(parse('[链接](https://example.com)', 20_000)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'link' })]),
    );
    expect(parse('`const x = 1;`', 20_000)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'code', start: 1, length: 12 })]),
    );
    expect(parse('', 20_000)).toEqual([]);
    expect(parse('a'.repeat(20_001), 20_000)).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6])('formats level %i headings at their original text offsets', (level) => {
    const parse = transfer(parser);
    const prefix = `${'#'.repeat(level)} `;
    const before = '😀 前文\n';
    expect(parse(`${before}${prefix}这是什么`)).toEqual(
      expect.arrayContaining([
        { type: 'syntax', start: before.length, length: prefix.length },
        { type: 'h1', start: before.length + prefix.length, length: 4 },
      ]),
    );
  });

  it('retains inline formatting within headings and ignores literal code', () => {
    const parse = transfer(parser);
    expect(parse('## *标题*')).toEqual(
      expect.arrayContaining([
        { type: 'h1', start: 3, length: 4 },
        expect.objectContaining({ type: 'bold', start: 4, length: 2 }),
      ]),
    );
    for (const input of ['```\n## 代码\n```', '`## 代码`', '\\## 转义', '####### 文本', '##没有空格']) {
      expect(parse(input).some((range: { type: string }) => range.type === 'h1')).toBe(false);
    }
  });
});
