// Server-only: the editable layer over the published quota seed.
//
// The seed in `sales-targets.ts` is the roster and the default. Management edits
// are stored per employee per month in PostgreSQL and applied on top, so a quota
// change takes effect without a commit and survives a redeploy.
//
// Overrides are deltas, never a replacement of the month: a saved row changes
// one employee's number and leaves everyone else on the seed. That way a partial
// save — a dropped request, a half-filled form — cannot silently wipe the quotas
// it did not mention.
import { SALES_TARGETS, type TargetSource } from "./sales-targets.ts";
import {
  applyOverrides,
  overrideKey,
  toOverride,
  type TargetOverride,
} from "./target-overrides.ts";
import {
  databaseConfigured,
  readDashboardDataset,
  writeDashboardDataset,
} from "./dashboard-db.server";

export { applyOverrides, overrideKey, type TargetOverride } from "./target-overrides.ts";

export interface TargetSourceSnapshot {
  source: TargetSource;
  overrides: TargetOverride[];
  /** False when DATABASE_URL is unset — the seed still serves, edits cannot. */
  editable: boolean;
  /** Set when the store could not be read; the seed is served unchanged. */
  error: string;
}

let cache: { at: number; value: TargetSourceSnapshot } | null = null;

export function invalidateTargetCache(): void {
  cache = null;
}

const DATASET = "sales_targets" as const;
/** Short, because an edit must show up on the next page load, not in an hour. */
const TTL_MS = 30_000;

export async function loadTargetSource(force = false): Promise<TargetSourceSnapshot> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;

  if (!databaseConfigured()) {
    const value: TargetSourceSnapshot = {
      source: SALES_TARGETS,
      overrides: [],
      editable: false,
      error: "",
    };
    cache = { at: Date.now(), value };
    return value;
  }

  let overrides: TargetOverride[] = [];
  let error = "";
  try {
    const snapshot = await readDashboardDataset(DATASET);
    overrides = snapshot.rows.map(toOverride).filter((row): row is TargetOverride => row !== null);
  } catch {
    // A store that cannot be read must not blank the quotas. Serve the seed and
    // say so, rather than reporting every employee as untargeted.
    error = "Saved target edits could not be read; showing the published defaults.";
  }

  const value: TargetSourceSnapshot = {
    source: applyOverrides(SALES_TARGETS, overrides),
    overrides,
    editable: true,
    error,
  };
  cache = { at: Date.now(), value };
  return value;
}

export interface TargetEdit {
  employeeId: string;
  target: number | null;
  note?: string;
}

/**
 * Upsert one month's edits. Only the employees named are touched.
 */
export async function saveTargetOverrides(
  month: string,
  edits: TargetEdit[],
  updatedBy: string,
): Promise<{ month: string; saved: number }> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("month must be YYYY-MM");
  if (!databaseConfigured()) throw new Error("DATABASE_URL is not configured");

  const updatedAt = new Date().toISOString();
  const rows = edits.map((edit) => ({
    __meta_key: overrideKey(month, edit.employeeId),
    month,
    employeeId: edit.employeeId,
    // Stored as text so the published-nothing marker survives the round trip:
    // JSON `null` and the number `0` must not collapse into each other.
    target: edit.target === null ? "" : String(edit.target),
    note: edit.note ?? "",
    updatedAt,
    updatedBy,
  }));

  await writeDashboardDataset(DATASET, rows, {
    mode: "upsert",
    syncedAt: updatedAt,
    metadata: { source: "dashboard-target-editor", month, updatedBy },
  });
  invalidateTargetCache();
  return { month, saved: rows.length };
}
