// Keep every server-side feature on one bounded pool. Separate pools per
// module multiplied the app's connection ceiling and let parallel n8n dataset
// writes exhaust PostgreSQL during sync bursts.
import { Pool } from "pg";

const MAX_DATABASE_CONNECTIONS = 12;
const MAX_CONCURRENT_DATASET_WRITES = 3;

let pool: Pool | null = null;
let activeDatasetWrites = 0;
const datasetWriteWaiters: Array<() => void> = [];

export function getSharedDatabasePool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: MAX_DATABASE_CONNECTIONS,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      ssl:
        connectionString.includes(".railway.internal") || process.env.PGSSLMODE === "disable"
          ? false
          : { rejectUnauthorized: false },
    });
    pool.on("error", (error: Error & { code?: string }) => {
      const code = /^[A-Z0-9_]{1,16}$/.test(error.code || "") ? error.code : "UNKNOWN";
      console.error("[database-pool] idle connection lost", { code });
    });
  }

  return pool;
}

/** Bound concurrent snapshot transactions; queued writes wait outside PG. */
export async function withDatasetWritePermit<T>(write: () => Promise<T>): Promise<T> {
  if (activeDatasetWrites < MAX_CONCURRENT_DATASET_WRITES) {
    activeDatasetWrites += 1;
  } else {
    await new Promise<void>((resolve) => datasetWriteWaiters.push(resolve));
  }

  try {
    return await write();
  } finally {
    const next = datasetWriteWaiters.shift();
    if (next) next();
    else activeDatasetWrites -= 1;
  }
}
