import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { LineWave, audioPeaks } from '../src/design/Waveform';

const peaks = audioPeaks([Float32Array.from({ length: 24000 }, (_, i) => Math.sin(i * 0.12) * 0.5)]);
assert.equal(peaks.length, 96);
const markup = renderToStaticMarkup(createElement(LineWave, { peaks, progress: 0.4, height: 100 }));
const svg = markup.replace('<svg ', '<svg width="360" height="100" ')
  .replaceAll('var(--accent)', '#1d3b2d').replaceAll('var(--wave-ahead)', '#647e70');
const { data, info } = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const inkColumns = new Set<number>();
for (let y = 15; y < 85; y++) for (let x = 0; x < info.width; x++) {
  const offset = (y * info.width + x) * info.channels;
  if (data[offset] < 170 && data[offset + 1] < 180) inkColumns.add(x);
}
assert.ok(inkColumns.size > 100, `waveform bars must actually paint across the screen, not just the playhead (${inkColumns.size} columns)`);
const bad = audioPeaks([new Float32Array([NaN, Infinity, -Infinity, 0.2, 0.4])], 4);
assert.ok(bad.every(Number.isFinite), 'invalid PCM cannot produce invisible NaN SVG geometry');
console.log(`Waveform raster checks passed: ${inkColumns.size} visible columns at mobile width; finite amplitude geometry.`);
