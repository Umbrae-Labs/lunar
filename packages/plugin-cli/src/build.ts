import { builtinModules } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { PACKAGE_LIMITS } from '@umbrae-labs/lunar-plugin-sdk/package-format';
import type { PluginProject } from './project.ts';

/** Modules supplied by the Lunar host at run time; never bundled. */
export const HOST_MODULES = ['react', 'react/jsx-runtime', 'react-native', '@umbrae-labs/lunar-plugin-sdk', '@umbrae-labs/lunar-plugin-sdk/ui'];

const FORBIDDEN_PACKAGES: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  {
    pattern: /^@umbrae-labs\/lunar-plugin-sdk\/(manifest|package-format)$/,
    reason: 'is host tooling, not part of the runtime SDK',
  },
  {
    pattern: /^@lunar\/plugin-sdk(\/.*)?$/,
    reason: 'was renamed; import @umbrae-labs/lunar-plugin-sdk instead',
  },
  { pattern: /^(expo|expo-.+|@expo\/.+)$/, reason: 'contains native modules the host does not expose' },
  {
    pattern: /^(react-native-.+|@react-native\/.+|@react-native-.+)$/,
    reason: 'contains native modules the host does not expose',
  },
  {
    pattern: /^(heroui-native|uniwind|@gorhom\/.+)(\/.*)?$/,
    reason: 'is a host implementation detail; use @umbrae-labs/lunar-plugin-sdk/ui',
  },
  { pattern: /^(@shopify\/react-native-skia|@umbrae-labs\/rito-rn)(\/.*)?$/, reason: 'is owned by the reader engine' },
  { pattern: /^react-dom(\/.*)?$/, reason: 'is not available in React Native' },
  { pattern: /^react\/jsx-dev-runtime$/, reason: 'is not provided; build in production JSX mode' },
];

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const WORKLET_DIRECTIVE = /(['"])worklet\1/;
const CLASS_NAME = /\bclassName\s*[=:]/;

export interface BuildResult {
  readonly code: Uint8Array;
  readonly warnings: readonly string[];
}

export class BuildError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Build failed\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'BuildError';
    this.issues = issues;
  }
}

export function createBuildOptions(project: PluginProject): esbuild.BuildOptions {
  return {
    absWorkingDir: project.root,
    entryPoints: [project.entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2020',
    mainFields: ['react-native', 'browser', 'module', 'main'],
    conditions: ['react-native', 'browser'],
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
    jsx: 'automatic',
    jsxDev: false,
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'silent',
    plugins: [lunarRestrictions(project.root)],
  };
}

export async function buildPlugin(project: PluginProject): Promise<BuildResult> {
  let result: esbuild.BuildResult;
  try {
    result = await esbuild.build(createBuildOptions(project));
  } catch (error) {
    throw new BuildError(formatFailure(error));
  }
  return toBuildResult(result);
}

export function toBuildResult(result: esbuild.BuildResult): BuildResult {
  if (result.errors.length > 0) throw new BuildError(result.errors.map(formatMessage));
  const output = result.outputFiles?.[0];
  if (!output) throw new BuildError(['esbuild produced no output']);
  if (output.contents.byteLength > PACKAGE_LIMITS.entryFileBytes) {
    throw new BuildError([
      `main.js is ${output.contents.byteLength} bytes; the limit is ${PACKAGE_LIMITS.entryFileBytes} bytes`,
    ]);
  }
  return { code: output.contents, warnings: result.warnings.map(formatMessage) };
}

function lunarRestrictions(root: string): esbuild.Plugin {
  return {
    name: 'lunar-restrictions',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'dynamic-import') {
          return { errors: [{ text: `Dynamic import("${args.path}") is not supported; import modules statically` }] };
        }
        if (args.path.startsWith('.') || path.isAbsolute(args.path)) return undefined;
        if (HOST_MODULES.includes(args.path)) return { path: args.path, external: true };
        if (NODE_BUILTINS.has(args.path)) {
          return { errors: [{ text: `"${args.path}" is a Node.js built-in module, which Lunar does not provide` }] };
        }
        const forbidden = FORBIDDEN_PACKAGES.find((item) => item.pattern.test(args.path));
        if (forbidden) return { errors: [{ text: `"${args.path}" ${forbidden.reason}` }] };
        return undefined;
      });

      // Only the plugin's own sources are held to the authoring rules;
      // bundled dependencies are checked by the module rules above.
      build.onLoad({ filter: SOURCE_FILE }, async (args) => {
        const relative = path.relative(root, args.path);
        if (relative.startsWith('..') || relative.split(path.sep).includes('node_modules')) return undefined;
        const source = await readFile(args.path, 'utf8');
        const errors: esbuild.PartialMessage[] = [];
        const lines = source.split(/\r?\n/);
        lines.forEach((line, index) => {
          const location = { file: relative, line: index + 1, column: 0, lineText: line };
          if (WORKLET_DIRECTIVE.test(line)) {
            errors.push({
              text: 'Worklets are not supported in SDK 0.1; use @umbrae-labs/lunar-plugin-sdk/ui components',
              location,
            });
          }
          if (CLASS_NAME.test(line)) {
            errors.push({ text: 'className has no effect in plugins; use component props or style', location });
          }
        });
        return errors.length > 0 ? { errors } : undefined;
      });
    },
  };
}

function formatFailure(error: unknown): readonly string[] {
  if (error && typeof error === 'object' && 'errors' in error && Array.isArray(error.errors)) {
    return (error.errors as esbuild.Message[]).map(formatMessage);
  }
  return [error instanceof Error ? error.message : String(error)];
}

function formatMessage(message: esbuild.Message): string {
  const location = message.location
    ? `${message.location.file}:${message.location.line}:${message.location.column}: `
    : '';
  return `${location}${message.text}`;
}
