import { PrismaClient } from "@prisma/client";
import { config } from "./config";

/**
 * Single Prisma client used across the server. Log level is derived from
 * the global config so production sessions stay quiet while development
 * surfaces query timing on demand.
 */
export const prisma = new PrismaClient({
  log: config.logLevel === "debug"
    ? ["query", "info", "warn", "error"]
    : config.logLevel === "info"
      ? ["warn", "error"]
      : config.logLevel === "warn"
        ? ["warn", "error"]
        : config.logLevel === "error"
          ? ["error"]
          : [],
});

// Per-process memo of owners we've already proven exist, so repeat
// requests don't pay for a DB round-trip just to confirm a row that's
// already there. The set is cleared by `disconnectDatabase` so tests
// that disconnect/reconnect see a clean slate.
const ensuredOwners = new Set<string>();

/**
 * Idempotently make sure a Settings row exists for the given owner.
 *
 * Uses `createMany({ skipDuplicates: true })` so concurrent first-touch
 * requests for the same owner can't deadlock on the `(ownerId)`
 * unique-constraint race that `findUnique` + `create` had under load
 * (the stress harness reproduced 60+ failures/second this way). After
 * the first successful call we short-circuit on subsequent ones to
 * keep the read path single-query.
 */
export async function ensureSettings(ownerId = "default") {
  if (ensuredOwners.has(ownerId)) return;
  await prisma.settings.createMany({
    data: [{ ownerId }],
    skipDuplicates: true,
  });
  ensuredOwners.add(ownerId);
}

export async function disconnectDatabase() {
  ensuredOwners.clear();
  await prisma.$disconnect();
}

/** Light health probe used by `/api/health/ready`. Returns true if the
 *  database accepts a trivial round-trip query within the timeout. */
export async function pingDatabase(timeoutMs = 1500): Promise<boolean> {
  return Promise.race([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}
