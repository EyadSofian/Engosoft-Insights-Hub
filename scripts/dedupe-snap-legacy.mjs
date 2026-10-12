/** Archive legacy Snapchat facts only after every one has a modern ad/day replacement. */
import pg from "pg";

const apply = process.argv.includes("--apply");
const client = new pg.Client({ connectionString: process.env.DATABASE_PUBLIC_URL });
await client.connect();
try {
  const {
    rows: [audit],
  } = await client.query(`
    WITH legacy AS (
      SELECT stable_key, row_data->>'التاريخ' AS d,
        row_data->>'__account_id' AS account_id,
        row_data->>'__ad_id' AS ad_id,
        (row_data->>'Spend (Cost)')::numeric AS spend
      FROM dashboard_rows WHERE dataset = 'snap_ads' AND record_date IS NULL
    ), current_rows AS (
      SELECT row_data->>'Date' AS d,
        row_data->>'__account_id' AS account_id,
        row_data->>'__ad_id' AS ad_id,
        (row_data->>'Spend (Cost)')::numeric AS spend
      FROM dashboard_rows WHERE dataset = 'snap_ads' AND record_date IS NOT NULL
    )
    SELECT count(*)::integer AS legacy_rows,
      count(c.d)::integer AS matched_rows,
      round(sum(l.spend), 2) AS legacy_spend,
      round(sum(c.spend), 2) AS replacement_spend,
      max(abs(l.spend - c.spend)) AS max_row_delta
    FROM legacy l LEFT JOIN current_rows c USING (d, account_id, ad_id)`);
  console.log(JSON.stringify({ audit, apply }));
  if (!apply) process.exit(0);
  if (!audit.legacy_rows || audit.legacy_rows !== audit.matched_rows) {
    throw new Error("Not all legacy Snapchat facts have modern replacements; no rows deleted.");
  }
  await client.query("BEGIN");
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS dashboard_rows_archive_20261012_snap_legacy
      (LIKE dashboard_rows INCLUDING ALL)`);
    const archived = await client.query(`
      INSERT INTO dashboard_rows_archive_20261012_snap_legacy
      SELECT * FROM dashboard_rows
      WHERE dataset = 'snap_ads' AND record_date IS NULL
      ON CONFLICT (dataset, stable_key) DO NOTHING`);
    const {
      rows: [archiveCount],
    } = await client.query(`
      SELECT count(*)::integer AS count FROM dashboard_rows_archive_20261012_snap_legacy`);
    if (archiveCount.count < audit.legacy_rows) {
      throw new Error("Archive verification failed; no rows deleted.");
    }
    const deleted = await client.query(`
      DELETE FROM dashboard_rows WHERE dataset = 'snap_ads' AND record_date IS NULL`);
    if (deleted.rowCount !== audit.legacy_rows) {
      throw new Error("Live row count changed during archive; rolling back.");
    }
    await client.query(`UPDATE dashboard_sync_state SET row_count =
      (SELECT count(*) FROM dashboard_rows WHERE dataset = 'snap_ads')
      WHERE dataset = 'snap_ads'`);
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        archived: archiveCount.count,
        newlyArchived: archived.rowCount,
        removedFromLive: deleted.rowCount,
        recoverable: true,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
} finally {
  await client.end();
}
