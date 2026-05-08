import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import crypto from "node:crypto";
import fs from "node:fs";
import { config } from "./config";
import { ensureSettings } from "./db";
import { libraryRouter } from "./routes/library";
import { comicsRouter } from "./routes/comics";
import { settingsRouter } from "./routes/settings";
import { statsRouter } from "./routes/stats";
import { bookmarksRouter } from "./routes/bookmarks";
import { scanLibrary, cleanupUploadOrphans } from "./services/scanner";

const REQUEST_TIMEOUT_MS = 60_000;

async function main() {
  fs.mkdirSync(config.libraryPath, { recursive: true });
  fs.mkdirSync(config.cacheDir, { recursive: true });
  await ensureSettings();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://localhost:*",
    );
    next();
  });

  app.use((req, res, next) => {
    res.setTimeout(REQUEST_TIMEOUT_MS, () => {
      res.status(503).json({ error: "Request timeout" });
    });
    next();
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/library", libraryRouter);
  app.use("/api/comics", comicsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api", statsRouter);
  app.use("/api", bookmarksRouter);

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const timestamp = new Date().toISOString();
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`[percys][${errorId}] route error:`, {
      message: err.message,
      stack: err.stack,
      timestamp,
    });
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error", errorId });
  };
  app.use(errorHandler);

  process.on("uncaughtException", (err) => {
    console.error("[percys] uncaught exception:", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[percys] unhandled rejection:", reason);
  });

  // Warm cache for recently read comics in background
  async function warmCache() {
    try {
      const { prisma } = await import("./db");
      const recent = await prisma.comic.findMany({
        where: { lastReadAt: { not: null } },
        orderBy: { lastReadAt: "desc" },
        take: 10,
        select: { id: true, pageCount: true },
      });
      // Prefetch first page of recent comics for fast initial load
      const { getPage } = await import("./services/pages");
      let warmed = 0;
      for (const comic of recent) {
        if (comic.pageCount > 0) {
          try {
            await getPage(comic.id, 0, { quality: "balanced" });
            warmed++;
          } catch { /* ignore per-comic errors */ }
        }
      }
      if (warmed > 0) {
        console.log(`[percys] warmed cache for ${warmed} recent comic(s)`);
      }
    } catch (err) {
      console.warn("[percys] cache warming failed:", err);
    }
  }

  scanLibrary()
    .then(async () => {
      try {
        const removed = await cleanupUploadOrphans();
        if (removed > 0) {
          console.log(`[percys] cleaned up ${removed} orphaned upload(s)`);
        }
      } catch (err) {
        console.error("Upload orphan cleanup failed:", err);
      }
      // Warm cache after main work is done
      warmCache();
    })
    .catch((err) => console.error("Initial scan failed:", err));

  app.listen(config.port, () => {
    console.log(`[percys] server listening on http://localhost:${config.port}`);
    console.log(`[percys] library: ${config.libraryPath}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
