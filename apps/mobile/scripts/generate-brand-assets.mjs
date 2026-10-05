import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imagesDirectory = path.join(projectRoot, 'assets', 'images');
const splashSize = 1024;

async function renderWordmark(color) {
  const svg = await readFile(path.join(imagesDirectory, `wordmark-${color}.svg`));
  return sharp(svg, { density: 384 }).trim().png().toBuffer();
}

async function renderBrandMark(color) {
  const mark = sharp(path.join(imagesDirectory, 'brand-mark.png')).trim().resize({ height: 420 });
  if (color === 'black') return mark.png().toBuffer();

  const { data, info } = await mark.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += info.channels) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

for (const color of ['black', 'white']) {
  const wordmark = await renderWordmark(color);
  await sharp(wordmark).toFile(path.join(imagesDirectory, `wordmark-${color}.png`));

  const mark = await renderBrandMark(color);
  const resizedWordmark = await sharp(wordmark).resize({ width: 560 }).png().toBuffer();
  const markInfo = await sharp(mark).metadata();
  const wordmarkInfo = await sharp(resizedWordmark).metadata();

  await sharp({
    create: {
      width: splashSize,
      height: splashSize,
      channels: 4,
      background: '#00000000',
    },
  })
    .composite([
      { input: mark, left: Math.round((splashSize - markInfo.width) / 2), top: 210 },
      {
        input: resizedWordmark,
        left: Math.round((splashSize - wordmarkInfo.width) / 2),
        top: 650,
      },
    ])
    .png()
    .toFile(path.join(imagesDirectory, `splash-${color === 'black' ? 'light' : 'dark'}.png`));
}
