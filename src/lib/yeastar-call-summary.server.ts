import { getSharedDatabasePool } from "./database-pool.server";
import { summarizeYeastarCalls } from "./yeastar-call-summary";
import type { CallsHubSummary } from "./calls-hub.server";

export async function readYeastarCallSummary(from: string, to: string): Promise<CallsHubSummary> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    throw new Error("A valid call reporting date range is required");
  const pool = getSharedDatabasePool();
  // Read facts and heartbeat from one consistent snapshot, not a healthy
  // heartbeat followed by a different partially replaced dataset.
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const states = await client.query<{
      dataset: string;
      status: string;
      synced_at: string | Date;
    }>(
      "SELECT dataset, status, synced_at FROM dashboard_sync_state WHERE dataset IN ('sla_calls', 'pbx_extensions')",
    );
    const sync = states.rows.find((row) => row.dataset === "sla_calls");
    const age = Date.now() - Date.parse(String(sync?.synced_at ?? ""));
    if (sync?.status !== "success" || !Number.isFinite(age) || age < 0 || age > 36 * 3_600_000)
      throw new Error(
        "Yeastar call records are unavailable or stale; call totals cannot be verified",
      );
    const calls = await client.query<Record<string, string>>(
      `SELECT row_data->>'call_id' AS call_id, row_data->>'extension' AS extension,
        row_data->>'user_name' AS user_name, row_data->>'started_at' AS started_at,
        row_data->>'direction' AS direction, row_data->>'disposition' AS disposition,
        row_data->>'talk_sec' AS talk_sec, row_data->>'call_duration_sec' AS call_duration_sec
       FROM dashboard_rows WHERE dataset = 'sla_calls'
        AND record_date BETWEEN ($1::date - 1) AND ($2::date + 1)`,
      [from, to],
    );
    const extensions = await client.query<{ row_data: Record<string, string> }>(
      "SELECT row_data FROM dashboard_rows WHERE dataset = 'pbx_extensions'",
    );
    await client.query("COMMIT");
    return {
      ok: true,
      source: "Yeastar CDR · Railway PostgreSQL (direct)",
      fetchedAt: new Date(sync.synced_at).toISOString(),
      range: { from, to },
      recordsAvailable: false,
      employees: summarizeYeastarCalls(
        calls.rows,
        extensions.rows.map((row) => row.row_data),
        from,
        to,
      ),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
