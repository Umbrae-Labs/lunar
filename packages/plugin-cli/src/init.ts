import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SDK_VERSION, parsePluginManifest } from '@umbrae-labs/lunar-plugin-sdk/manifest';

export interface InitOptions {
  readonly id: string;
  readonly name: string;
}

const sdkRange = `^${SDK_VERSION}`;

export async function initProject(directory: string, options: InitOptions): Promise<readonly string[]> {
  const root = path.resolve(directory);
  if (existsSync(root) && (await readdir(root)).length > 0) throw new Error(`${root} is not empty`);

  const manifest = {
    manifestVersion: 1,
    id: options.id,
    name: '%name%',
    version: '0.1.0',
    sdk: sdkRange,
    trust: 'full',
    main: 'main.js',
    description: '%description%',
    activationEvents: [],
    permissions: [{ name: 'reader.events', reason: '%permission.events%' }],
    contributes: {
      commands: [{ id: 'open-panel', title: '%command.open%', icon: 'sparkles' }],
      slots: {
        'reader.toolbar': [{ id: 'open-button', command: 'open-panel' }],
        'reader.panel': [{ id: 'main', title: '%panel.title%', icon: 'sparkles' }],
      },
      settings: [],
    },
  };
  const parsed = parsePluginManifest(manifest);
  if (!parsed.ok) throw new Error(`Invalid plugin id or name:\n${parsed.issues.join('\n')}`);

  const files: Record<string, string> = {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'package.json': `${JSON.stringify(
      {
        name: options.id,
        private: true,
        version: '0.1.0',
        scripts: {
          build: 'lunar-plugin build',
          dev: 'lunar-plugin dev',
          pack: 'lunar-plugin pack',
          typecheck: 'tsc --noEmit',
        },
        devDependencies: {
          '@umbrae-labs/lunar-plugin-cli': sdkRange,
          '@umbrae-labs/lunar-plugin-sdk': sdkRange,
          '@types/react': '^19.2.0',
          typescript: '^6.0.0',
        },
      },
      null,
      2,
    )}\n`,
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          lib: ['ES2020'],
          module: 'preserve',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`,
    'locales/zh-CN.json': `${JSON.stringify(
      {
        name: options.name,
        description: '一个 Lunar 阅读器插件',
        'permission.events': '了解当前阅读的章节',
        'command.open': `打开${options.name}`,
        'panel.title': options.name,
        'panel.chapter': '当前章节：{{title}}',
        'panel.empty': '打开一本书后显示章节信息',
      },
      null,
      2,
    )}\n`,
    'locales/en.json': `${JSON.stringify(
      {
        name: options.name,
        description: 'A Lunar reader plugin',
        'permission.events': 'Know which chapter is being read',
        'command.open': `Open ${options.name}`,
        'panel.title': options.name,
        'panel.chapter': 'Current chapter: {{title}}',
        'panel.empty': 'Open a book to see its chapter',
      },
      null,
      2,
    )}\n`,
    'src/index.tsx': `import { definePlugin, useReader, useT } from '@umbrae-labs/lunar-plugin-sdk';
import { EmptyState, PanelHeader, Stack, Text } from '@umbrae-labs/lunar-plugin-sdk/ui';

export default definePlugin({
  activate(ctx) {
    ctx.commands.register('open-panel', () => ctx.ui.openPanel('main'));
    ctx.ui.registerSlot('reader.panel', 'main', MainPanel);
    ctx.reader.on('chapterChange', ({ chapter }) => ctx.log.info('chapter', chapter?.title));
  },
});

function MainPanel() {
  const t = useT();
  const chapter = useReader((session) => session?.location?.chapter?.title);
  return (
    <Stack gap="md" padding="md">
      <PanelHeader title={t('panel.title')} />
      {chapter ? <Text>{t('panel.chapter', { title: chapter })}</Text> : <EmptyState title={t('panel.empty')} />}
    </Stack>
  );
}
`,
    '.gitignore': 'node_modules\ndist\n',
  };

  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return Object.keys(files);
}
