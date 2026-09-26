import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const brandRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(brandRoot, '..');
const geometry = JSON.parse(await readFile(resolve(brandRoot, 'src/geometry.json'), 'utf8'));
const spec = JSON.parse(await readFile(resolve(brandRoot, 'src/spec.json'), 'utf8'));
const generatedFiles = [];

const MASTER_VIEW_BOX = '0 0 1254 1254';
const COMPACT_VIEW_BOX = '148.5 153 948 948';
const svgDirectory = resolve(brandRoot, 'svg');
const pngDirectory = resolve(brandRoot, 'png');

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function svgDocument({
  title,
  description,
  viewBox = MASTER_VIEW_BOX,
  width = 1254,
  height = 1254,
  background = null,
  markColor = spec.brandTeal,
  dotColor = spec.brandBlack,
  dotStrokeColor = spec.brandTeal,
  dotStrokeWidth = spec.dotOutlineWidth,
  embeddedStyle = '',
  extra = '',
}) {
  const backgroundElement = background
    ? `  <rect data-layer="background" width="100%" height="100%" fill="${background}" />\n`
    : '';
  const styleElement = embeddedStyle ? `  <style>${embeddedStyle}</style>\n` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-labelledby="title description">
  <title id="title">${xml(title)}</title>
  <desc id="description">${xml(description)}</desc>
${styleElement}${backgroundElement}  <path data-layer="body" fill="${markColor}" fill-rule="evenodd" d="${geometry.bodyPath}" />
  <path data-layer="start-dot" fill="${dotColor}" stroke="${dotStrokeColor}" stroke-width="${dotStrokeWidth}" stroke-linejoin="round" fill-rule="evenodd" d="${geometry.dotPath}" />
${extra}</svg>
`;
}

async function writeGenerated(path, contents, role) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  generatedFiles.push({ path, role });
}

async function writePng(path, svg, width, height, role) {
  const png = await sharp(Buffer.from(svg), { density: 288 })
    .resize(width, height, { fit: 'fill' })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  await writeGenerated(path, png, role);
}

const title = spec.name;
const description =
  'Flat pixel-traced RC monogram with a black starting dot and teal outline. No gradients, texture, depth, or shadows.';

const masterSvg = svgDocument({ title: `${title} master`, description });
const primarySvg = svgDocument({
  title,
  description,
  background: spec.brandBlack,
});
const transparentSvg = svgDocument({
  title: `${title}, transparent`,
  description: `${description} For placement on Runcast brand black only.`,
});
const compactSvg = svgDocument({
  title: `${title}, compact`,
  description,
  viewBox: COMPACT_VIEW_BOX,
  width: 948,
  height: 948,
});
const microSvg = svgDocument({
  title: `${title}, micro`,
  description: `${description} The dot ring is optically strengthened for 16 to 31 pixel use.`,
  viewBox: COMPACT_VIEW_BOX,
  width: 948,
  height: 948,
  dotStrokeWidth: spec.microDotOutlineWidth,
});
const microPrimarySvg = svgDocument({
  title: `${title}, micro`,
  description: `${description} The dot ring is optically strengthened for 16 to 31 pixel use.`,
  viewBox: COMPACT_VIEW_BOX,
  width: 948,
  height: 948,
  background: spec.brandBlack,
  dotStrokeWidth: spec.microDotOutlineWidth,
});
const knockoutSvg = svgDocument({
  title: `${title}, single-color knockout`,
  description: 'Single-color alpha artwork for system-controlled tinting.',
  viewBox: COMPACT_VIEW_BOX,
  width: 948,
  height: 948,
  markColor: 'currentColor',
  dotColor: 'none',
  dotStrokeColor: 'currentColor',
  dotStrokeWidth: spec.microDotOutlineWidth,
});

await writeGenerated(resolve(svgDirectory, 'runcast-rc-master.svg'), masterSvg, 'canonical-master');
await writeGenerated(resolve(svgDirectory, 'runcast-rc-primary.svg'), primarySvg, 'primary-mark');
await writeGenerated(
  resolve(svgDirectory, 'runcast-rc-transparent.svg'),
  transparentSvg,
  'transparent-mark',
);
await writeGenerated(resolve(svgDirectory, 'runcast-rc-mark.svg'), compactSvg, 'compact-mark');
await writeGenerated(resolve(svgDirectory, 'runcast-rc-micro.svg'), microSvg, 'micro-mark');
await writeGenerated(
  resolve(svgDirectory, 'runcast-rc-knockout.svg'),
  knockoutSvg,
  'single-color-knockout',
);

const fontPath = resolve(
  repositoryRoot,
  'node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2',
);
const embeddedFont = (await readFile(fontPath)).toString('base64');
const fontStyle = `@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:700;src:url(data:font/woff2;base64,${embeddedFont}) format('woff2')}text{font-family:'Space Grotesk',sans-serif;font-weight:700}`;

const horizontalScale = 0.48;
const horizontalMark = `<g transform="translate(18 30) scale(${horizontalScale})"><path fill="${spec.brandTeal}" fill-rule="evenodd" d="${geometry.bodyPath}"/><path fill="${spec.brandBlack}" stroke="${spec.brandTeal}" stroke-width="${spec.dotOutlineWidth}" stroke-linejoin="round" fill-rule="evenodd" d="${geometry.dotPath}"/></g>`;
const horizontalLockup = `<svg xmlns="http://www.w3.org/2000/svg" width="2100" height="660" viewBox="0 0 2100 660" role="img" aria-labelledby="title description">
  <title id="title">Runcast horizontal lockup</title>
  <desc id="description">Forward Terminals RC monogram and Runcast wordmark in Space Grotesk Bold.</desc>
  <style>${fontStyle}</style>
  <rect data-layer="background" width="2100" height="660" fill="${spec.brandBlack}" />
  ${horizontalMark}
  <text data-layer="wordmark" x="650" y="427" font-size="330" letter-spacing="-8" fill="${spec.brandTeal}">Runcast</text>
</svg>
`;
const stackedLockup = `<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1680" viewBox="0 0 1254 1680" role="img" aria-labelledby="title description">
  <title id="title">Runcast stacked lockup</title>
  <desc id="description">Forward Terminals RC monogram above the Runcast wordmark in Space Grotesk Bold.</desc>
  <style>${fontStyle}</style>
  <rect data-layer="background" width="1254" height="1680" fill="${spec.brandBlack}" />
  <path fill="${spec.brandTeal}" fill-rule="evenodd" d="${geometry.bodyPath}" />
  <path fill="${spec.brandBlack}" stroke="${spec.brandTeal}" stroke-width="${spec.dotOutlineWidth}" stroke-linejoin="round" fill-rule="evenodd" d="${geometry.dotPath}" />
  <text data-layer="wordmark" x="627" y="1460" text-anchor="middle" font-size="270" letter-spacing="-6" fill="${spec.brandTeal}">Runcast</text>
</svg>
`;
await writeGenerated(
  resolve(svgDirectory, 'runcast-lockup-horizontal.svg'),
  horizontalLockup,
  'horizontal-lockup',
);
await writeGenerated(
  resolve(svgDirectory, 'runcast-lockup-stacked.svg'),
  stackedLockup,
  'stacked-lockup',
);

const platformOutputs = [
  ['png/platform/ios-app-icon-1024.png', primarySvg, 1024, 1024, 'ios-and-general-app-icon'],
  [
    'png/platform/android-adaptive-foreground-1024.png',
    transparentSvg,
    1024,
    1024,
    'android-adaptive-foreground',
  ],
  [
    'png/platform/android-adaptive-background-1024.png',
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${spec.brandBlack}"/></svg>`,
    1024,
    1024,
    'android-adaptive-background',
  ],
  [
    'png/platform/android-monochrome-1024.png',
    knockoutSvg.replaceAll('currentColor', '#000000'),
    1024,
    1024,
    'android-themed-icon',
  ],
  ['png/platform/splash-1024.png', transparentSvg, 1024, 1024, 'transparent-splash-artwork'],
  [
    'png/platform/notification-96.png',
    knockoutSvg.replaceAll('currentColor', '#FFFFFF'),
    96,
    96,
    'android-white-alpha-notification-exception',
  ],
];

for (const [path, svg, width, height, role] of platformOutputs) {
  await writePng(resolve(brandRoot, path), svg, width, height, role);
}

for (const size of [16, 32, 48, 192]) {
  await writePng(
    resolve(pngDirectory, `web/favicon-${size}.png`),
    microPrimarySvg,
    size,
    size,
    `web-favicon-${size}`,
  );
}

for (const nominalSize of [16, 24, 32, 48]) {
  const sourceSvg = nominalSize < spec.minimumSize ? microSvg : compactSvg;
  for (const scale of [1, 2, 3]) {
    const pixels = nominalSize * scale;
    await writePng(
      resolve(pngDirectory, `ui/runcast-mark-${nominalSize}@${scale}x.png`),
      sourceSvg,
      pixels,
      pixels,
      `ui-mark-${nominalSize}-at-${scale}x`,
    );
  }
}

const mobileAssets = [
  ['apps/mobile/assets/icon.png', 'png/platform/ios-app-icon-1024.png', 'mobile-app-icon'],
  [
    'apps/mobile/assets/android-icon-foreground.png',
    'png/platform/android-adaptive-foreground-1024.png',
    'mobile-android-foreground',
  ],
  [
    'apps/mobile/assets/android-icon-background.png',
    'png/platform/android-adaptive-background-1024.png',
    'mobile-android-background',
  ],
  [
    'apps/mobile/assets/android-icon-monochrome.png',
    'png/platform/android-monochrome-1024.png',
    'mobile-android-monochrome',
  ],
  ['apps/mobile/assets/splash-icon.png', 'png/platform/splash-1024.png', 'mobile-splash'],
  [
    'apps/mobile/assets/notification-icon.png',
    'png/platform/notification-96.png',
    'mobile-notification-icon',
  ],
  ['apps/mobile/assets/favicon.png', 'png/web/favicon-48.png', 'mobile-web-favicon'],
];

for (const [target, source, role] of mobileAssets) {
  await writeGenerated(
    resolve(repositoryRoot, target),
    await readFile(resolve(brandRoot, source)),
    role,
  );
}

await writeGenerated(
  resolve(repositoryRoot, 'apps/web/public/favicon.svg'),
  microPrimarySvg,
  'vite-favicon',
);
await writeGenerated(
  resolve(repositoryRoot, 'apps/web/public/runcast-mark.svg'),
  compactSvg,
  'vite-header-mark',
);

const geometryModule = `/** Generated by brand/scripts/generate.mjs. Do not edit. */
export const RuncastGeometry = {
  viewBox: '0 0 1254 1254',
  compactViewBox: '148.5 153 948 948',
  bodyPath: ${JSON.stringify(geometry.bodyPath)},
  dotPath: ${JSON.stringify(geometry.dotPath)},
} as const;

export const RuncastBrand = {
  black: '${spec.brandBlack}',
  teal: '${spec.brandTeal}',
  dotOutlineWidth: ${spec.dotOutlineWidth},
  microDotOutlineWidth: ${spec.microDotOutlineWidth},
} as const;
`;
await writeGenerated(
  resolve(repositoryRoot, 'apps/mobile/src/design/runcastGeometry.ts'),
  geometryModule,
  'mobile-vector-source',
);

const files = [];
for (const { path, role } of generatedFiles) {
  const data = await readFile(path);
  files.push({
    path: relative(repositoryRoot, path),
    role,
    bytes: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
}
files.sort((left, right) => left.path.localeCompare(right.path));

const manifest = {
  schemaVersion: 1,
  generator: 'brand/scripts/generate.mjs',
  source: {
    geometry: 'brand/src/geometry.json',
    specification: 'brand/src/spec.json',
    geometrySha256: createHash('sha256')
      .update(await readFile(resolve(brandRoot, 'src/geometry.json')))
      .digest('hex'),
    specificationSha256: createHash('sha256')
      .update(await readFile(resolve(brandRoot, 'src/spec.json')))
      .digest('hex'),
  },
  specification: spec,
  files,
};

await writeFile(resolve(brandRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${files.length} deterministic brand outputs.`);
