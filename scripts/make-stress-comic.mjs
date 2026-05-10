#!/usr/bin/env node
/**
 * Generate a synthetic CBZ for stress testing the reader.
 *
 *   node scripts/make-stress-comic.mjs            # 500 pages, 800x1200, default name
 *   node scripts/make-stress-comic.mjs --pages=500 --width=800 --height=1200 --name=stress-500
 *
 * The output goes to apps/server/data/library/<name>.cbz so the next library
 * scan picks it up. Pages are PNGs with a page-number stamped in big text so
 * each frame is visually distinct in the recorder.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import AdmZip from "adm-zip";

function parseArgs() {
  const out = { pages: 500, width: 800, height: 1200, name: "stress-500" };
  for (const arg of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (!m) continue;
    const [, k, v] = m;
    if (k in out) {
      const num = Number(v);
      out[k] = Number.isFinite(num) && k !== "name" ? num : v;
    }
  }
  return out;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, "..");
const target = resolve(repo, "apps/server/data/library");

async function main() {
  const { pages, width, height, name } = parseArgs();
  if (!existsSync(target)) mkdirSync(target, { recursive: true });

  const zip = new AdmZip();
  const padWidth = Math.max(3, String(pages).length);

  const start = Date.now();
  for (let i = 1; i <= pages; i++) {
    const hue = (i * 360) / pages;
    const bg = hslToHex(hue, 60, 18);
    const accent = hslToHex(hue, 80, 70);
    const svg = Buffer.from(`<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${bg}"/>
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="${accent}" stroke-width="6" rx="20"/>
  <text x="${width / 2}" y="${height / 2 - 40}" font-family="sans-serif" font-size="180" font-weight="900" fill="${accent}" text-anchor="middle" dominant-baseline="central">${i}</text>
  <text x="${width / 2}" y="${height / 2 + 90}" font-family="sans-serif" font-size="40" fill="${accent}" text-anchor="middle" opacity="0.7">/ ${pages}</text>
  <text x="40" y="${height - 50}" font-family="monospace" font-size="22" fill="${accent}" opacity="0.55">${name}</text>
  <text x="${width - 40}" y="${height - 50}" font-family="monospace" font-size="22" fill="${accent}" opacity="0.55" text-anchor="end">page ${String(i).padStart(padWidth, "0")}</text>
</svg>`);
    const png = await sharp(svg).png({ compressionLevel: 6 }).toBuffer();
    zip.addFile(`page-${String(i).padStart(padWidth, "0")}.png`, png);
    if (i % 50 === 0) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  rendered ${i}/${pages} (${elapsed}s)`);
    }
  }

  const outPath = resolve(target, `${name}.cbz`);
  zip.writeZip(outPath);
  const sizeMB = ((zip.toBuffer().length / (1024 * 1024)).toFixed(2));
  console.log(`Wrote ${outPath} — ${pages} pages, ${sizeMB} MB`);
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
