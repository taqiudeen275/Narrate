#!/usr/bin/env node
/**
 * Regenerates the Android launcher icon rasters from the brand SVG.
 *
 *   node scripts/make-android-icons.mjs
 *
 * Writes, into src-tauri/gen/android/app/src/main/res/:
 *
 *   mipmap-<density>/ic_launcher.png            48dp legacy, full mark
 *   mipmap-<density>/ic_launcher_round.png      48dp legacy, full mark
 *   mipmap-<density>/ic_launcher_foreground.png 108dp adaptive foreground
 *
 * The adaptive layer itself (mipmap-anydpi-v26/*.xml + values/colors.xml) is
 * hand-authored; this script only owns the rasters. It checks both are present
 * and warns if they are not.
 *
 * Geometry. An adaptive icon canvas is 108dp but the launcher mask may crop as
 * much as the outer ~25% per side, so only the centre 66dp is guaranteed to
 * survive. The foreground is therefore the mark's *glyph* only (the field rect
 * is stripped from the SVG at runtime) scaled to sit inside that safe circle,
 * with the flat deep green supplied by the <background> layer that the mask
 * crops into whatever shape the launcher uses. Shipping the whole rounded
 * square as the foreground instead would draw a visible inner squircle inside
 * the mask; pass --full-field for that literal variant.
 *
 * Re-running is idempotent: every output is overwritten from the same source.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_SVG = join(ROOT, "assets", "icon", "icon-source.svg");
const RES = join(ROOT, "src-tauri", "gen", "android", "app", "src", "main", "res");
const ANYDPI = join(RES, "mipmap-anydpi-v26");
const COLORS_XML = join(RES, "values", "colors.xml");

/** Adaptive icon canvas is 108dp; legacy launcher icons are 48dp. */
const FOREGROUND_DP = 108;
const LEGACY_DP = 48;

/** Fraction of the adaptive canvas the launcher mask is guaranteed to keep. */
const SAFE_FRACTION = 66 / 108;
/** Extra inset so the glyph keeps a margin against the mask, not just touches it. */
const SAFE_INSET = 0.86;
/** Output pixels per viewBox unit used when rasterising, before downscaling. */
const SUPERSAMPLE = 4;
/** Raster used once to measure the glyph's bounds in viewBox units. */
const MEASURE = 2048;

/** Baseline density factors, matching the mipmap-* folder names already in res/. */
const DENSITIES = [
  ["mipmap-mdpi", 1],
  ["mipmap-hdpi", 1.5],
  ["mipmap-xhdpi", 2],
  ["mipmap-xxhdpi", 3],
  ["mipmap-xxxhdpi", 4],
];

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const TRIM = { background: TRANSPARENT, threshold: 1 };
const RESIZE = { fit: "fill", kernel: "lanczos3" };

const FULL_FIELD = process.argv.includes("--full-field");

function loadSharp() {
  const require = createRequire(import.meta.url);
  try {
    return require("sharp");
  } catch (err) {
    if (err.code !== "MODULE_NOT_FOUND") throw err;
    console.error(
      [
        "",
        "FATAL: 'sharp' is not resolvable from this project, so the icon rasters",
        "cannot be generated. Nothing has been written.",
        "",
        "sharp ships native binaries and must match this platform and Node ABI",
        `(current: ${process.platform}/${process.arch}, node ${process.version}).`,
        "",
        "Install it with:",
        "  npm install --save-dev sharp",
        "",
        "Or run it from a context that already has sharp, e.g. the kokoro-js",
        "install that pulls it in transitively.",
        "",
      ].join("\n")
    );
    process.exit(1);
  }
}

/** Reads the viewBox (falling back to width/height) of an SVG string. */
function viewBoxOf(svg) {
  const box = svg.match(/viewBox\s*=\s*"([^"]+)"/);
  if (box) {
    const [, , w, h] = box[1].trim().split(/[\s,]+/).map(Number);
    if (w > 0 && h > 0) return { w, h };
  }
  const w = Number((svg.match(/<svg[^>]*\bwidth="([\d.]+)"/) || [])[1]);
  const h = Number((svg.match(/<svg[^>]*\theight="([\d.]+)"/) || [])[1]);
  if (!(w > 0 && h > 0)) throw new Error("cannot determine SVG dimensions");
  return { w, h };
}

/**
 * Removes the full-bleed background rect so the glyph can be drawn on a
 * transparent canvas. Geometry is untouched; only the field layer is dropped.
 */
function stripFieldRect(svg, vbW, vbH) {
  let removed = 0;
  const out = svg.replace(/<rect\b[^>]*?\/>/g, (tag) => {
    const w = Number((tag.match(/\bwidth="([\d.]+)"/) || [])[1]);
    const h = Number((tag.match(/\bheight="([\d.]+)"/) || [])[1]);
    if (w >= vbW * 0.98 && h >= vbH * 0.98) {
      removed += 1;
      return "";
    }
    return tag;
  });
  return { svg: out, removed };
}

/** Rasterises an SVG string to a PNG buffer at an exact pixel size. */
async function rasterise(sharp, svg, vbW, px) {
  return sharp(Buffer.from(svg, "utf8"), { density: (72 * px) / vbW })
    .png()
    .toBuffer();
}

/** Trims fully-transparent edges, so what remains is exactly the drawn content. */
async function trimmed(sharp, svg, vbW, px) {
  return sharp(Buffer.from(svg, "utf8"), { density: (72 * px) / vbW })
    .png()
    .trim(TRIM)
    .toBuffer();
}

/** Reads width/height straight out of the IHDR chunk, not off the request. */
function measurePng(file) {
  const head = readFileSync(file).subarray(0, 24);
  const bytes = statSync(file).size;
  if (head.length < 24 || head.readUInt32BE(0) !== 0x89504e47) return { bytes, width: 0, height: 0 };
  if (head.toString("ascii", 12, 16) !== "IHDR") return { bytes, width: 0, height: 0 };
  return { bytes, width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

async function main() {
  const sharp = loadSharp();

  const svgSource = await readFile(SOURCE_SVG, "utf8");
  const { w: vbW, h: vbH } = viewBoxOf(svgSource);
  const field = stripFieldRect(svgSource, vbW, vbH);

  if (!FULL_FIELD && field.removed === 0) {
    console.warn(
      "WARN: no full-bleed <rect> found in the source SVG; falling back to " +
        "drawing the whole mark as the foreground layer."
    );
  }
  const glyphSvg = FULL_FIELD || field.removed === 0 ? svgSource : field.svg;

  // Measure the drawn content once, in viewBox units, then derive the fit.
  const probe = await trimmed(sharp, glyphSvg, vbW, MEASURE);
  const probeMeta = await sharp(probe).metadata();
  if (!probeMeta.width || !probeMeta.height) {
    throw new Error("source SVG rendered to an empty image");
  }
  const glyphW = (probeMeta.width * vbW) / MEASURE;
  const glyphH = (probeMeta.height * vbH) / MEASURE;

  // Largest scale that keeps the content inside the safe zone at any density:
  // the limiting dimension is the glyph's longest side.
  const glyphToSafe = (SAFE_FRACTION * SAFE_INSET) / Math.max(glyphW, glyphH); // viewBox units -> dp
  const glyphDrawW = Math.round(glyphW * glyphToSafe * FOREGROUND_DP);
  const glyphDrawH = Math.round(glyphH * glyphToSafe * FOREGROUND_DP);

  console.log(`source      ${SOURCE_SVG}`);
  console.log(`viewBox     ${vbW}x${vbH}`);
  console.log(
    `foreground  glyph ${glyphW.toFixed(1)}x${glyphH.toFixed(1)} viewBox units` +
      (field.removed && !FULL_FIELD ? ` (field rect stripped)` : ` (full mark)`)
  );
  console.log(
    `safe zone   ${(SAFE_FRACTION * FOREGROUND_DP).toFixed(1)}dp of ` +
      `${FOREGROUND_DP}dp canvas -> glyph drawn at ${glyphDrawW}x${glyphDrawH}dp`
  );
  console.log("");

  const written = [];

  for (const [dir, density] of DENSITIES) {
    const target = join(RES, dir);

    // Legacy: the whole mark, field included, filling the canvas.
    const legacyPx = Math.round(LEGACY_DP * density);
    const legacy = await sharp(await rasterise(sharp, svgSource, vbW, legacyPx * SUPERSAMPLE))
      .resize(legacyPx, legacyPx, RESIZE)
      .png()
      .toBuffer();
    for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
      const file = join(target, name);
      await writeFile(file, legacy);
      written.push({ file, expect: legacyPx });
    }

    // Foreground: glyph only, on transparency, sized to the safe zone.
    const fgPx = Math.round(FOREGROUND_DP * density);
    const pxPerUnit = fgPx * glyphToSafe; // output px per glyph viewBox unit
    const w = Math.max(1, Math.floor(glyphW * pxPerUnit));
    const h = Math.max(1, Math.floor(glyphH * pxPerUnit));
    const glyph = await sharp(
      await trimmed(sharp, glyphSvg, vbW, Math.ceil(Math.max(w, h) * SUPERSAMPLE))
    )
      .resize(w, h, RESIZE)
      .png()
      .toBuffer();
    const fg = await sharp({
      create: { width: fgPx, height: fgPx, channels: 4, background: TRANSPARENT },
    })
      .composite([
        {
          input: glyph,
          left: Math.floor((fgPx - w) / 2),
          top: Math.floor((fgPx - h) / 2),
          blend: "over",
        },
      ])
      .png()
      .toBuffer();
    const fgFile = join(target, "ic_launcher_foreground.png");
    await writeFile(fgFile, fg);
    written.push({ file: fgFile, expect: fgPx });
  }

  const rows = [];
  let bad = 0;
  for (const { file, expect } of written) {
    const rel = file.slice(RES.length + 1);
    const m = measurePng(file);
    const ok = m.width === expect && m.height === expect && m.bytes > 0;
    if (!ok) bad += 1;
    rows.push({
      rel,
      expect: `${expect}x${expect}`,
      actual: m.width ? `${m.width}x${m.height}` : "UNREADABLE",
      bytes: m.bytes,
      ok,
    });
  }

  const wRel = Math.max(...rows.map((r) => r.rel.length));
  const wExp = Math.max(...rows.map((r) => r.expect.length));
  const wAct = Math.max(...rows.map((r) => r.actual.length));
  console.log(
    [
      "path".padEnd(wRel),
      "expected".padEnd(wExp),
      "actual".padEnd(wAct),
      "bytes".padStart(8),
      "result",
    ].join("  ")
  );
  for (const r of rows) {
    console.log(
      [
        r.rel.padEnd(wRel),
        r.expect.padEnd(wExp),
        r.actual.padEnd(wAct),
        String(r.bytes).padStart(8),
        r.ok ? "ok" : "FAIL",
      ].join("  ")
    );
  }

  console.log("");
  const missing = [
    join(ANYDPI, "ic_launcher.xml"),
    join(ANYDPI, "ic_launcher_round.xml"),
  ].filter((f) => !existsSync(f));
  if (missing.length) {
    console.warn(`WARN: adaptive-icon XML missing:\n  ${missing.join("\n  ")}`);
  }
  if (!/name="ic_launcher_background"/.test(await readFile(COLORS_XML, "utf8"))) {
    console.warn(`WARN: ic_launcher_background not declared in ${COLORS_XML}`);
  }
  if (bad > 0) {
    console.error(`FAIL: ${bad} file(s) did not come out at the expected size.`);
    process.exit(1);
  }
  console.log(`OK: wrote ${written.length} files, all at their expected size.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});