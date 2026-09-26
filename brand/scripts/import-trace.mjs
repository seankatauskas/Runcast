import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const brandRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tracedMaster = resolve(brandRoot, 'src/runcast-rc-vector-master.svg');
const output = resolve(brandRoot, 'src/geometry.json');

const source = await readFile(tracedMaster, 'utf8');

function pathData(id) {
  const match = source.match(new RegExp(`<path id="${id}"[^>]* d="([^"]+)"`));
  if (!match) throw new Error(`Could not find ${id} in ${tracedMaster}`);
  return match[1];
}

const geometry = {
  source: 'Forward Terminals trace of 02-forward-terminals.png',
  masterViewBox: [0, 0, 1254, 1254],
  bodyBounds: [225.5, 347.5, 1019.5, 891.5],
  dotBounds: [243.5, 797.5, 320.5, 874.5],
  bodyPath: pathData('rc-body-path'),
  dotPath: pathData('rc-dot-path'),
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(geometry, null, 2)}\n`);
console.log(`Imported traced geometry into ${output}`);
