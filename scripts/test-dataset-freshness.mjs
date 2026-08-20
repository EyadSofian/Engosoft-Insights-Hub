import assert from "node:assert/strict";
import {
  STALE_AFTER_MS,
  datasetFreshnessAlerts,
  isHistoricalDataset,
} from "../src/lib/dataset-freshness.ts";
import { INSERT_CHUNK_ROWS, POSTGRES_MAX_BIND_PARAMS } from "../src/lib/dashboard-db.server.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-08-19T23:55:00Z");
const ago = (hours) => new Date(NOW - hours * HOUR).toISOString();
const ok = (dataset, hours) => ({ dataset, status: "success", syncedAt: ago(hours), error: "" });

/* --- the outage this was written for --------------------------------------- */
{
  // Production, read live while the fault was open. Every source but one had
  // synced within three hours; `invoiced` had not succeeded in 14.8 and had
  // failed 26 times in a row, with nothing on screen saying so.
  const alerts = datasetFreshnessAlerts(
    [
      ok("crm", 0.05),
      ok("lost", 0.05),
      ok("accounting", 0.13),
      ok("website_sales", 0.25),
      ok("pbx_extensions", 1.9),
      ok("sla_calls", 1.9),
      ok("meta_ads", 2.7),
      ok("snap_ads", 2.6),
      ok("invoiced", 14.8),
      // Frozen historical imports, 168 hours old by design and always will be.
      ok("accounting_legacy", 167.9),
      ok("ads_legacy", 167.9),
    ],
    NOW,
  );

  assert.deepEqual(
    alerts.map((a) => a.dataset),
    ["invoiced"],
    "only the genuinely stalled source is named",
  );
  assert.equal(alerts[0].kind, "stale");
  assert.equal(Math.floor(alerts[0].ageHours), 14);
  assert.match(alerts[0].message, /no successful sync for 14h/);
  // The wording must not repeat the mistake it exists to fix: the job did run,
  // it just never succeeded.
  assert.match(alerts[0].message, /may be failing/);
}

/* --- ordinary lag is not an outage ----------------------------------------- */
{
  // Ad platforms are routinely hours behind. Warning about those is how a
  // warning becomes noise and stops being read.
  assert.deepEqual(datasetFreshnessAlerts([ok("meta_ads", 2.7), ok("snap_ads", 5.9)], NOW), []);
  assert.equal(datasetFreshnessAlerts([ok("meta_ads", 5.99)], NOW).length, 0);
  assert.equal(datasetFreshnessAlerts([ok("meta_ads", 6.01)], NOW).length, 1);
  assert.equal(STALE_AFTER_MS, 6 * HOUR);
}

/* --- historical snapshots are exempt, permanently -------------------------- */
{
  assert.equal(isHistoricalDataset("accounting_legacy"), true);
  assert.equal(isHistoricalDataset("ads_legacy"), true);
  assert.equal(isHistoricalDataset("accounting"), false);
  assert.equal(isHistoricalDataset("invoiced"), false);
  assert.deepEqual(datasetFreshnessAlerts([ok("ads_legacy", 5_000)], NOW), []);
}

/* --- a recorded failure is reported even when it is recent ----------------- */
{
  const alerts = datasetFreshnessAlerts(
    [{ dataset: "invoiced", status: "failed", syncedAt: ago(0.2), error: "Dataset write failed." }],
    NOW,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "failed");
  assert.match(alerts[0].message, /Dataset write failed/);
}

/* --- never synced is not a fault ------------------------------------------- */
{
  // A deployment that has not connected a source has nothing to report about
  // it, and must not be nagged on every page load.
  assert.deepEqual(
    datasetFreshnessAlerts(
      [{ dataset: "sla_calls", status: "never", syncedAt: "", error: "" }],
      NOW,
    ),
    [],
  );
  // A success with an unreadable timestamp cannot be aged, and is not invented.
  assert.deepEqual(
    datasetFreshnessAlerts([{ dataset: "crm", status: "success", syncedAt: "", error: "" }], NOW),
    [],
  );
}

/* --- the write that caused the outage -------------------------------------- */
// Kept beside the detection rule because they are two halves of one incident:
// this is what made the sync slow enough to be cut off, and the rule above is
// what would have said so.
{
  const PARAMS_PER_ROW = 6;
  // Exceeding the ceiling does not degrade, it fails the entire sync.
  assert.ok(
    INSERT_CHUNK_ROWS * PARAMS_PER_ROW <= POSTGRES_MAX_BIND_PARAMS,
    `${INSERT_CHUNK_ROWS} rows x ${PARAMS_PER_ROW} params exceeds PostgreSQL's ${POSTGRES_MAX_BIND_PARAMS}`,
  );
  // The old value was 500, which cost 14 round trips inside one transaction for
  // the 6,650-row dataset that broke. Two is the point of the change.
  const INVOICED_ROWS = 6_650;
  assert.ok(
    Math.ceil(INVOICED_ROWS / INSERT_CHUNK_ROWS) <= 2,
    "the dataset that broke must not need more than two inserts",
  );
  assert.ok(Math.ceil(INVOICED_ROWS / 500) === 14, "…where the old chunk size needed fourteen");
  // Headroom for growth: the ceiling must still hold at triple the size.
  assert.ok(INSERT_CHUNK_ROWS * PARAMS_PER_ROW * 3 <= POSTGRES_MAX_BIND_PARAMS * 3);
}

console.log("dataset freshness tests passed.");
