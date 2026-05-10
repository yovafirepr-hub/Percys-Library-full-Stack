#!/usr/bin/env node
/**
 * Stress the reader pipeline for a single, large comic (500 pages).
 *
 *   node scripts/stress-reader-500.mjs                       # auto-pick stress-500
 *   node scripts/stress-reader-500.mjs --comic=<id>          # explicit comic
 *   node scripts/stress-reader-500.mjs --concurrency=24      # parallel fetches
 *   node scripts/stress-reader-500.mjs --quality=high
 *
 * What it does:
 *   1. GET /api/library and find the chosen comic (default: any comic with
 *      `pageCount >= 200` so a 500-pager is preferred).
 *   2. Fetch /api/comics/:id/pages/:n in parallel with bounded concurrency,
 *      hitting EVERY page once (sequential 0..N-1) and again in random
 *      order to simulate jumping around.
 *   3. Concurrently hit /thumbs/:n, /covers, and /api/library/summary
 *      to stress the auxiliary pipelines.
 *   4. Report per-stage counts, errors, and p50 / p99 latency.
 */

const TARGET = process.env.STRESS_TARGET || "http://localhost:4000";

function parseArgs() {
  const out = { concurrency: 16, quality: "balanced", comic: null };
  for (const arg of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.+)$/.exec(arg);
    if (!m) continue;
    const [, k, v] = m;
    if (k === "concurrency") out.concurrency = Math.max(1, Number(v));
    else if (k === "quality") out.quality = v;
    else if (k === "comic") out.comic = v;
  }
  return out;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return Math.round(sorted[idx]);
}

async function bounded(items, concurrency, worker) {
  const queue = items.slice();
  const results = { ok: 0, err: 0, latencies: [], statuses: new Map() };
  async function pump() {
    while (queue.length) {
      const item = queue.shift();
      const start = process.hrtime.bigint();
      try {
        const status = await worker(item);
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        results.latencies.push(ms);
        results.statuses.set(status, (results.statuses.get(status) || 0) + 1);
        if (status >= 200 && status < 400) results.ok++;
        else results.err++;
      } catch (e) {
        results.err++;
        results.statuses.set("ERR", (results.statuses.get("ERR") || 0) + 1);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, pump));
  return results;
}

function reportRow(label, results) {
  const total = results.ok + results.err;
  const p50 = pct(results.latencies, 50);
  const p95 = pct(results.latencies, 95);
  const p99 = pct(results.latencies, 99);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    "  " +
      pad(label, 36) +
      pad(total, 8) +
      pad(results.ok, 8) +
      pad(results.err, 8) +
      pad(`${p50}ms`, 9) +
      pad(`${p95}ms`, 9) +
      pad(`${p99}ms`, 9),
  );
}

async function main() {
  const args = parseArgs();
  console.log(`Stress reader (target=${TARGET}, concurrency=${args.concurrency}, quality=${args.quality})`);

  const libRes = await fetch(`${TARGET}/api/library`);
  if (!libRes.ok) throw new Error(`/api/library returned ${libRes.status}`);
  const lib = await libRes.json();
  const items = Array.isArray(lib) ? lib : [];

  let target = null;
  if (args.comic) {
    target = items.find((c) => c.id === args.comic);
    if (!target) throw new Error(`comic id ${args.comic} not found`);
  } else {
    target =
      items.find((c) => c.pageCount >= 200) ||
      items.find((c) => c.pageCount >= 50) ||
      items[0];
  }
  if (!target) throw new Error("no comics in library — run a scan first");

  console.log(`Picked comic: ${target.title} (${target.id}, ${target.pageCount} pages)`);

  const pageOrder = Array.from({ length: target.pageCount }, (_, i) => i);
  const randomOrder = pageOrder.slice().sort(() => Math.random() - 0.5);
  const thumbOrder = pageOrder.filter((i) => i % 3 === 0);

  console.log("");
  console.log(
    "  " +
      "stage".padEnd(36) +
      "total   ok      err     p50      p95      p99",
  );
  console.log(
    "  " + "-".repeat(36) + "-".repeat(48),
  );

  // Page fetch — sequential 0..N-1
  const pagesSeq = await bounded(
    pageOrder,
    args.concurrency,
    async (i) => {
      const r = await fetch(
        `${TARGET}/api/comics/${target.id}/pages/${i}?quality=${args.quality}`,
      );
      // Drain body so the connection can be reused.
      await r.arrayBuffer();
      return r.status;
    },
  );
  reportRow(`pages seq 0..${target.pageCount - 1}`, pagesSeq);

  // Page fetch — random order
  const pagesRand = await bounded(
    randomOrder,
    args.concurrency,
    async (i) => {
      const r = await fetch(
        `${TARGET}/api/comics/${target.id}/pages/${i}?quality=${args.quality}`,
      );
      await r.arrayBuffer();
      return r.status;
    },
  );
  reportRow("pages random shuffle", pagesRand);

  // Thumbnails — every 3rd page
  const thumbs = await bounded(
    thumbOrder,
    args.concurrency,
    async (i) => {
      const r = await fetch(`${TARGET}/api/comics/${target.id}/thumbs/${i}`);
      await r.arrayBuffer();
      return r.status;
    },
  );
  reportRow(`thumbs every 3rd (${thumbOrder.length})`, thumbs);

  // Cover hits in parallel — should be cheap
  const covers = await bounded(
    Array.from({ length: 200 }, () => 0),
    args.concurrency,
    async () => {
      const r = await fetch(`${TARGET}/api/comics/${target.id}/cover`);
      await r.arrayBuffer();
      return r.status;
    },
  );
  reportRow("cover hits ×200", covers);

  // Library summary x 200 (cheap baseline)
  const summary = await bounded(
    Array.from({ length: 200 }, () => 0),
    args.concurrency,
    async () => {
      const r = await fetch(`${TARGET}/api/library/summary`);
      await r.arrayBuffer();
      return r.status;
    },
  );
  reportRow("library summary ×200", summary);

  console.log("");
  const totalErr =
    pagesSeq.err + pagesRand.err + thumbs.err + covers.err + summary.err;
  if (totalErr === 0) {
    console.log("ALL OK — 0 errors across all stages.");
    process.exit(0);
  } else {
    console.log(`FAILURES — ${totalErr} non-2xx responses across stages.`);
    for (const [stage, name] of [
      [pagesSeq, "pages-seq"],
      [pagesRand, "pages-rand"],
      [thumbs, "thumbs"],
      [covers, "covers"],
      [summary, "summary"],
    ]) {
      if (!stage.err) continue;
      const breakdown = [...stage.statuses.entries()]
        .map(([s, n]) => `${s}:${n}`)
        .join(", ");
      console.log(`  ${name}: ${breakdown}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
