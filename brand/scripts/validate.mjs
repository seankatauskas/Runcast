import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const brandRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(brandRoot, '..');
const geometry = JSON.parse(await readFile(resolve(brandRoot, 'src/geometry.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(brandRoot, 'manifest.json'), 'utf8'));
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

const expectedPngDimensions = new Map([
  ['brand/png/platform/ios-app-icon-1024.png', [1024, 1024]],
  ['brand/png/platform/android-adaptive-foreground-1024.png', [1024, 1024]],
  ['brand/png/platform/android-adaptive-background-1024.png', [1024, 1024]],
  ['brand/png/platform/android-monochrome-1024.png', [1024, 1024]],
  ['brand/png/platform/splash-1024.png', [1024, 1024]],
  ['brand/png/platform/notification-96.png', [96, 96]],
  ['apps/mobile/assets/icon.png', [1024, 1024]],
  ['apps/mobile/assets/android-icon-foreground.png', [1024, 1024]],
  ['apps/mobile/assets/android-icon-background.png', [1024, 1024]],
  ['apps/mobile/assets/android-icon-monochrome.png', [1024, 1024]],
  ['apps/mobile/assets/splash-icon.png', [1024, 1024]],
  ['apps/mobile/assets/notification-icon.png', [96, 96]],
  ['apps/mobile/assets/favicon.png', [48, 48]],
]);

for (const size of [16, 32, 48, 192]) {
  expectedPngDimensions.set(`brand/png/web/favicon-${size}.png`, [size, size]);
}
for (const nominal of [16, 24, 32, 48]) {
  for (const scale of [1, 2, 3]) {
    expectedPngDimensions.set(`brand/png/ui/runcast-mark-${nominal}@${scale}x.png`, [
      nominal * scale,
      nominal * scale,
    ]);
  }
}

const transparentPngs = new Set([
  'brand/png/platform/android-adaptive-foreground-1024.png',
  'brand/png/platform/android-monochrome-1024.png',
  'brand/png/platform/splash-1024.png',
  'brand/png/platform/notification-96.png',
  'apps/mobile/assets/android-icon-foreground.png',
  'apps/mobile/assets/android-icon-monochrome.png',
  'apps/mobile/assets/splash-icon.png',
  'apps/mobile/assets/notification-icon.png',
]);

const opaquePngs = new Set([
  'brand/png/platform/ios-app-icon-1024.png',
  'brand/png/platform/android-adaptive-background-1024.png',
  'apps/mobile/assets/icon.png',
  'apps/mobile/assets/android-icon-background.png',
]);

const whiteExceptions = new Set([
  'brand/png/platform/notification-96.png',
  'apps/mobile/assets/notification-icon.png',
]);

for (const file of manifest.files) {
  const path = resolve(repositoryRoot, file.path);
  const data = await readFile(path);
  const hash = createHash('sha256').update(data).digest('hex');
  assert(hash === file.sha256, `${file.path}: hash differs from manifest`);
  assert(data.byteLength === file.bytes, `${file.path}: byte size differs from manifest`);

  if (extname(path) === '.svg') {
    const source = data.toString('utf8');
    assert(
      !/<(?:linearGradient|radialGradient|filter|pattern)\b/i.test(source),
      `${file.path}: forbidden SVG effect`,
    );
    assert(
      !/(?:drop-shadow|box-shadow|mix-blend-mode|url\(#)/i.test(source),
      `${file.path}: forbidden depth, blend, or paint server`,
    );
    assert(
      !/(?:fill|stroke)=["'](?:white|#fff(?:fff)?)["']/i.test(source),
      `${file.path}: forbidden white SVG paint`,
    );
    if (file.role === 'canonical-master') {
      assert(source.includes(`d="${geometry.bodyPath}"`), `${file.path}: body geometry drifted`);
      assert(source.includes(`d="${geometry.dotPath}"`), `${file.path}: dot geometry drifted`);
      assert(
        source.includes('stroke-width="10"'),
        `${file.path}: master dot outline is not 10 units`,
      );
      assert(!source.includes('<rect'), `${file.path}: clean master must be transparent`);
    }
    if (file.role === 'micro-mark') {
      assert(
        source.includes('stroke-width="32"'),
        `${file.path}: micro dot ring is not strengthened`,
      );
    }
    continue;
  }

  if (extname(path) !== '.png') continue;
  const expected = expectedPngDimensions.get(file.path);
  if (expected) {
    const metadata = await sharp(data).metadata();
    assert(
      metadata.width === expected[0] && metadata.height === expected[1],
      `${file.path}: expected ${expected.join('x')}, got ${metadata.width}x${metadata.height}`,
    );
  }

  const { data: pixels, info } = await sharp(data)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let hasTransparent = false;
  let hasVisible = false;
  let hasTeal = false;
  let hasBlack = false;
  let hasWhite = false;
  let notificationPaintIsWhite = true;
  for (let index = 0; index < pixels.length; index += info.channels) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    if (alpha < 255) hasTransparent = true;
    if (alpha === 0) continue;
    hasVisible = true;
    if (red === 103 && green === 213 && blue === 214) hasTeal = true;
    if (red === 5 && green === 7 && blue === 7) hasBlack = true;
    if (red >= 250 && green >= 250 && blue >= 250) hasWhite = true;
    if (red !== 255 || green !== 255 || blue !== 255) notificationPaintIsWhite = false;
  }
  assert(hasVisible, `${file.path}: artwork is empty`);
  if (transparentPngs.has(file.path)) assert(hasTransparent, `${file.path}: expected transparency`);
  if (opaquePngs.has(file.path)) assert(!hasTransparent, `${file.path}: must be opaque`);
  if (whiteExceptions.has(file.path)) {
    assert(notificationPaintIsWhite, `${file.path}: notification paint must be white alpha only`);
  } else {
    assert(!hasWhite, `${file.path}: contains forbidden white pixels`);
  }
  if (
    file.role.includes('icon') &&
    !file.role.includes('monochrome') &&
    !file.role.includes('themed') &&
    !file.role.includes('notification')
  ) {
    assert(hasTeal || file.role.includes('background'), `${file.path}: brand teal is missing`);
  }
  if (file.role.includes('app-icon') || file.role.includes('favicon')) {
    assert(hasBlack, `${file.path}: brand black is missing`);
  }
}

assert(manifest.specification.brandBlack === '#050707', 'Manifest brand black drifted');
assert(manifest.specification.brandTeal === '#67D5D6', 'Manifest brand teal drifted');
assert(manifest.specification.dotOutlineWidth === 10, 'Manifest master outline drifted');
assert(manifest.specification.clearSpace === 77, 'Manifest clear space drifted');
assert(manifest.specification.minimumSize === 32, 'Manifest standard minimum drifted');
assert(manifest.specification.microMinimumSize === 16, 'Manifest micro minimum drifted');

if (errors.length) {
  console.error(`Brand validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${manifest.files.length} generated files with no brand drift.`);
}
