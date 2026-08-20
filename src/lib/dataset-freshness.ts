/**
 * Which stored datasets are no longer being kept up to date.
 *
 * The dashboard reported every source's age in a tooltip and said nothing about
 * any of them. On 2026-08-19 the Full Invoiced Orders sync began failing every
 * thirty minutes; `dashboard_sync_state` recorded only successes, so it kept
 * reading `success` with an eleven-hour-old timestamp while twenty-six runs
 * failed in a row. The screen showed "last updated 12:05" — accurate, and
 * completely silent about the fact that 12:05 was the last time it had worked.
 *
 * Recording the failure is not enough on its own: the request that failed was
 * cut off mid-flight, so the server never reached a `catch` and there was no
 * error to record. Age is the signal that survives every failure mode — a
 * failing job, a disabled schedule, an upstream that is simply gone.
 *
 * Pure so the thresholds can be tested against real timings; the caller reads
 * the clock.
 */

export interface StoredDatasetState {
  dataset: string;
  status: "success" | "failed" | "never";
  /** ISO timestamp of the last *successful* sync. Empty when never synced. */
  syncedAt: string;
  error: string;
}

/**
 * How old a dataset may get before it is called out.
 *
 * Generous on purpose. The ad platforms sync a few times a day and are normally
 * hours old, so a tight bound would cry wolf every afternoon and teach everyone
 * to ignore the warning — which is the state this is trying to fix, not repeat.
 * Fourteen hours of silence is a real outage; three is a Tuesday.
 */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Datasets that are historical by design and never sync again.
 *
 * The `_legacy` snapshots are frozen imports kept for year-on-year comparison.
 * They are permanently months old and always will be; warning about them would
 * make the warning meaningless.
 */
export const isHistoricalDataset = (dataset: string): boolean => dataset.endsWith("_legacy");

export interface FreshnessAlert {
  dataset: string;
  kind: "failed" | "stale";
  /** Hours since the last successful sync. `null` when it has never synced. */
  ageHours: number | null;
  message: string;
}

export function datasetFreshnessAlerts(
  rows: readonly StoredDatasetState[],
  now: number,
): FreshnessAlert[] {
  const alerts: FreshnessAlert[] = [];

  for (const row of rows) {
    if (isHistoricalDataset(row.dataset)) continue;
    // A dataset that has never synced is not yet a fault: a deployment that has
    // not connected a source has nothing to report about it.
    if (row.status === "never") continue;

    const parsed = Date.parse(row.syncedAt);
    const ageMs = Number.isFinite(parsed) ? now - parsed : null;
    const ageHours = ageMs === null ? null : ageMs / 3_600_000;

    if (row.status === "failed") {
      alerts.push({
        dataset: row.dataset,
        kind: "failed",
        ageHours,
        message: `${row.dataset}: last sync failed${row.error ? ` — ${row.error}` : ""}.`,
      });
      continue;
    }

    if (ageMs !== null && ageMs > STALE_AFTER_MS) {
      alerts.push({
        dataset: row.dataset,
        kind: "stale",
        ageHours,
        // Says "last succeeded", not "last updated". The distinction is the
        // whole point: the job may have run twenty-six times since.
        message: `${row.dataset}: no successful sync for ${Math.floor(ageHours ?? 0)}h — the job may be failing.`,
      });
    }
  }

  return alerts;
}
