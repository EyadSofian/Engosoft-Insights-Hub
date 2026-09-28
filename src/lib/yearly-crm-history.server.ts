import { loadHistoricalCrmYear, type HistoricalCrmDay } from "./crm-odoo.server";
import {
  databaseConfigured,
  readDashboardDataset,
  writeDashboardDataset,
  type DashboardDataset,
} from "./dashboard-db.server";
import { odooConfigured } from "./odoo.server";

const REVISION = "annual-all-crm-cairo-cohort-v2";
const REFRESH_MS = 24 * 60 * 60 * 1000;
const retries = new Map<number, number>();
const pending = new Map<number, Promise<void>>();
const memory = new Map<number, { rows: HistoricalCrmDay[]; syncedAt: string }>();

export interface HistoricalCrmResult {
  year: 2024 | 2025;
  rows: HistoricalCrmDay[];
  status: "ready" | "refreshing" | "unavailable";
  syncedAt: string;
  error: string;
}

function dataset(year: 2024 | 2025): DashboardDataset {
  return `annual_crm_${year}`;
}

function parseRows(rows: Record<string, string>[]): HistoricalCrmDay[] {
  return rows
    .filter((row) => /^20\d\d-\d\d-\d\d$/.test(row.createdAt ?? ""))
    .map((row) => ({
      createdAt: row.createdAt,
      course: row.course ?? "",
      leads: Number(row.leads) || 0,
      won: Number(row.won) || 0,
      lost: Number(row.lost) || 0,
      inventoryLeads: Number(row.inventoryLeads) || 0,
    }));
}

function refresh(year: 2024 | 2025): void {
  if (pending.has(year) || !odooConfigured()) return;
  if ((retries.get(year) ?? 0) > Date.now()) return;
  const task = (async () => {
    try {
      const rows = await loadHistoricalCrmYear(year);
      const syncedAt = new Date().toISOString();
      if (databaseConfigured()) {
        await writeDashboardDataset(
          dataset(year),
          rows.map((row) => ({ ...row, __stable_key: `${row.createdAt}:${row.course}` })),
          { mode: "replace", syncedAt, metadata: { revision: REVISION, year, complete: true } },
        );
      }
      memory.set(year, { rows, syncedAt });
      retries.delete(year);
    } catch (error) {
      console.error("[yearly-crm-history] Odoo refresh failed", {
        year,
        reason: error instanceof Error ? error.message : String(error),
      });
      retries.set(year, Date.now() + 5 * 60_000);
    } finally {
      pending.delete(year);
    }
  })();
  pending.set(year, task);
}

/** Return last-good historical cohorts immediately; refresh Odoo off the request path. */
export async function historicalCrm(year: 2024 | 2025): Promise<HistoricalCrmResult> {
  const cached = databaseConfigured() ? await readDashboardDataset(dataset(year)) : null;
  const storedReady =
    cached?.status === "success" &&
    cached.metadata.revision === REVISION &&
    cached.metadata.complete === true;
  const local = memory.get(year);
  const rows = storedReady ? parseRows(cached.rows) : (local?.rows ?? []);
  const syncedAt = storedReady ? cached.syncedAt : (local?.syncedAt ?? "");
  const ready = storedReady || Boolean(local);
  const stale = !ready || Date.now() - Date.parse(syncedAt) > REFRESH_MS;
  if (stale) refresh(year);
  return {
    year,
    rows,
    status: ready ? "ready" : pending.has(year) ? "refreshing" : "unavailable",
    syncedAt,
    error:
      ready || pending.has(year)
        ? ""
        : odooConfigured()
          ? "Odoo refresh unavailable"
          : "Odoo not configured",
  };
}
