import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

dotenv.config();

const root = path.resolve(__dirname, "..");

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy apps/server/.env.example to apps/server/.env and fill in the Postgres connection string.",
  );
}

export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  databaseUrl: process.env.DATABASE_URL,
  libraryPath: resolveLibraryPath(),
  cacheDir: resolveCacheDir(),
  pageMemoryCacheItems: 60,
  thumbWidth: 320,
  coverWidth: 600,
};

function resolveLibraryPath(): string {
  const envPath = process.env.LIBRARY_PATH;
  // Default to scanning from data/ folder where user files are
  let defaultPath = path.resolve(root, "data");
  if (envPath) {
    // If explicitly set, use that path but resolve relative to root
    defaultPath = path.isAbsolute(envPath) ? envPath : path.resolve(root, envPath);
  }
  fs.mkdirSync(defaultPath, { recursive: true });
  console.log(`[config] library path: ${defaultPath}`);
  return defaultPath;
}

function resolveCacheDir(): string {
  const envPath = process.env.CACHE_DIR;
  if (!envPath) {
    const defaultPath = path.resolve(root, "cache");
    fs.mkdirSync(defaultPath, { recursive: true });
    return defaultPath;
  }
  const resolved = path.isAbsolute(envPath) ? envPath : path.resolve(root, envPath);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
