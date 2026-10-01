/**
 * Web icons, derived from the brand mark.
 *
 * Run with: node scripts/make-web-icons.mjs
 *
 * One source of truth: assets/icon/icon-source.svg. Every raster the browser
 * asks for is generated from it here, so revising the mark is one edit to the
 * SVG and one re-run — not five hand-touched PNGs drifting apart. Nothing else
 * in the repo rasterises the mark, which is why this is a script and not a
 * committed binary set that only looks reproducible.
 *
 * Idempotent: rewrites its outputs in place and the result is byte-identical
 * on every run, so re-running after an unrelated change is a no-op.
 *
 * Requires `sharp`. It is not a declared dependency — it resolves transitively
 * through kokoro-js — so the script checks for it and says what to do rather
 * than throwing a bare MODULE_NOT_FOUND.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = path.join(root, 'assets', 'icon', 'icon-source.svg');
const OUT_DIR = path.join(root, 'public');

/** The source SVG's own coordinate system. */
const CANVAS = 512;

/**
 * Maskable launchers crop hard — square, circle, squircle, and OEM silhouettes
 * — and the spec's safe zone is a circle of 80% of the icon. The source mark is
 * drawn edge to edge with rounded corners, which is precisely what a circular
 * mask removes, so the maskable variant drops the corner radius to make the
 * field full-bleed and pulls the trace in to 62% to sit inside the safe circle.
 */
const MASKABLE_SCALE = 0.62;

/**
 * Render this many times the target, capped. librsvg rasterises the vectors
 * cleanly at any size, so one pass at 1x would be legal — but resampling a
 * supersample is what keeps the 22-unit trace from breaking into a dotted line
 * at 32px, where the stroke is under a pixel and a half wide.
 */
const SUPERSAMPLE = 4;
const MAX_RENDER = 1024;

const TARGETS = [
  { file: 'favicon-32.png', size: 32, maskable: false },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

/* -------------------------------------------------------------------------- */

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error(
    'sharp did not resolve. It is not a declared dependency; it is only present\n' +
    'transitively through kokoro-js.\n\n' +
    'Add it explicitly rather than relying on that:\n\n' +
    '  npm install --save-dev sharp\n',
  );
  process.exit(1);
}

/**
 * The maskable variant, derived from the same source text rather than a second
 * hand-written SVG: same gradient defs, same path data, same playhead. Only two
 * things change — the field loses its corner radius, and the artwork is scaled
 * about the canvas centre. Two SVGs to keep in sync is exactly the failure this
 * script exists to prevent, so the edits are made structurally and the
 * structure is asserted rather than assumed.
 */
function maskableMarkup(svg) {
  const field = /<rect width="512" height="512" rx="112"[^>]*\/>/;
  const found = svg.match(field);
  if (!found) {
    throw new Error(
      'icon-source.svg: the rounded field rect was not found, so its corner ' +
        'radius cannot be removed for the maskable build. Update the pattern ' +
        'in make-web-icons.mjs to match the current source.',
    );
  }
  const end = svg.lastIndexOf('</svg>');
  if (end <= found.index) {
    throw new Error('icon-source.svg: expected </svg> after the field rect.');
  }

  const artwork = svg.slice(found.index + found[0].length, end).trim();
  const half = CANVAS / 2;
  const wrap =
    `<g transform="translate(${half} ${half}) scale(${MASKABLE_SCALE}) ` +
    `translate(${-half} ${-half})">`;

  return [
    svg.slice(0, found.index),
    '<rect width="512" height="512" fill="url(#field)"/>',
    `  ${wrap}`,
    artwork.replace(/^/gm, '  '),
    '  </g>',
    svg.slice(end),
  ].join('\n');
}

async function render(markup, size) {
  const density = (72 * Math.min(size * SUPERSAMPLE, MAX_RENDER)) / CANVAS;
  return sharp(Buffer.from(markup, 'utf8'), { density })
    .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, effort: 10, palette: false })
    .toBuffer();
}

/**
 * Dimensions read out of the file's IHDR chunk rather than echoed back from the
 * size we asked for. A resize that silently clamps, or a buffer that is not the
 * PNG we think it is, has to fail here instead of shipping as a wrong favicon.
 */
function pngHeader(buf) {
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('output is not a PNG');
  }
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') {
    throw new Error('output has no IHDR chunk');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function renderTable(rows) {
  const columns = [
    ['file', 'file', (r) => r.file],
    ['px', 'asked', (r) => `${r.size}x${r.size}`],
    ['IHDR', 'IHDR', (r) => `${r.width}x${r.height}`],
    ['bytes', 'bytes', (r) => r.bytes.toLocaleString('en-US')],
  ];
  const widths = columns.map(([head, , get]) =>
    Math.max(head.length, ...rows.map((r) => get(r).length)),
  );
  const line = (cells) => '  ' + cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [
    line(columns.map(([head]) => head)),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map((r) => line(columns.map(([, , get]) => get(r)))),
  ].join('\n');
}

/* -------------------------------------------------------------------------- */

const svg = await readFile(SOURCE, 'utf8');
const maskable = maskableMarkup(svg);

await mkdir(OUT_DIR, { recursive: true });

const rows = [];
for (const target of TARGETS) {
  const markup = target.maskable ? maskable : svg;
  const png = await render(markup, target.size);
  const { width, height } = pngHeader(png);

  if (width !== target.size || height !== target.size) {
    throw new Error(
      `${target.file}: asked sharp for ${target.size}x${target.size}, the file ` +
        `is ${width}x${height}`,
    );
  }

  const dest = path.join(OUT_DIR, target.file);
  await writeFile(dest, png);
  rows.push({ ...target, width, height, bytes: png.length });
}

console.log(`Narrate web icons — source ${path.relative(root, SOURCE).replace(/\\/g, '/')}`);
console.log(`maskable variant: full-bleed field, artwork at ${Math.round(MASKABLE_SCALE * 100)}% about the centre\n`);
console.log(renderTable(rows));
console.log(`\n${rows.length} file(s) written to ${path.relative(root, OUT_DIR).replace(/\\/g, '/')}/`);
