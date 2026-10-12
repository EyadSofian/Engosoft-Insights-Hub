/** Record only successful, account-complete n8n Snap backfills as date coverage. */
import pg from "pg";

const key = process.env.N8N_API_KEY;
const executionIds = process.argv.slice(2);
if (!key || !process.env.DATABASE_PUBLIC_URL || !executionIds.length) {
  throw new Error("Provide N8N_API_KEY, DATABASE_PUBLIC_URL and successful execution IDs.");
}
const accounts = [
  { id: "ca38be49-409a-4919-8ec1-da6237614309", name: "Engosoft general" },
  { id: "f233d311-bd5b-404d-92df-ac72c1a93383", name: "Engosoft Global Self Service" },
];
const client = new pg.Client({ connectionString: process.env.DATABASE_PUBLIC_URL });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS ad_delivery_accounts (
    dataset text NOT NULL, account_id text NOT NULL, account_name text NOT NULL,
    currency text NOT NULL, discovered_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dataset, account_id))`);
  await client.query(`CREATE TABLE IF NOT EXISTS ad_delivery_coverage (
    dataset text NOT NULL, account_id text NOT NULL, from_date date NOT NULL,
    to_date date NOT NULL, expected_spend numeric NOT NULL, row_count integer NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dataset, account_id, from_date, to_date))`);
  for (const account of accounts) {
    await client.query(
      `INSERT INTO ad_delivery_accounts (dataset, account_id, account_name, currency)
      VALUES ('snap_ads', $1, $2, 'USD')
      ON CONFLICT (dataset, account_id) DO UPDATE SET
        account_name = EXCLUDED.account_name, currency = EXCLUDED.currency,
        discovered_at = now()`,
      [account.id, account.name],
    );
  }
  for (const executionId of executionIds) {
    const response = await fetch(
      `https://n8n.engosoft.com/api/v1/executions/${executionId}?includeData=true`,
      {
        headers: { "X-N8N-API-KEY": key },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) throw new Error(`n8n execution ${executionId}: HTTP ${response.status}`);
    const execution = await response.json();
    const result = execution.data?.resultData?.runData || {};
    const fetched = result["Fetch Snap Ad Daily Insights"]?.at(-1)?.data?.main?.[0]?.[0]?.json;
    const committed = result["Commit Snap Sync State"]?.at(-1)?.data?.main?.[0]?.[0]?.json;
    if (
      execution.status !== "success" ||
      !fetched ||
      !committed?.ok ||
      fetched.accountCount !== accounts.length ||
      fetched.errors?.length ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fetched.since) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fetched.until)
    ) {
      throw new Error(`Execution ${executionId} is not a complete two-account backfill.`);
    }
    for (const account of accounts) {
      const rows = fetched.rows.filter((row) => row.__account_id === account.id);
      const sourceSpend = rows.reduce((sum, row) => sum + Number(row["Spend (Cost)"] || 0), 0);
      const {
        rows: [stored],
      } = await client.query(
        `
        SELECT count(*)::integer AS row_count,
          coalesce(sum((row_data->>'Spend (Cost)')::numeric), 0)::float8 AS spend
        FROM dashboard_rows WHERE dataset = 'snap_ads'
          AND row_data->>'__account_id' = $1
          AND record_date BETWEEN $2::date AND $3::date`,
        [account.id, fetched.since, fetched.until],
      );
      if (stored.row_count !== rows.length || Math.abs(stored.spend - sourceSpend) > 5) {
        throw new Error(
          `Stored Snap facts do not match execution ${executionId} for ${account.name}.`,
        );
      }
      await client.query(
        `INSERT INTO ad_delivery_coverage
        (dataset, account_id, from_date, to_date, expected_spend, row_count)
        VALUES ('snap_ads', $1, $2::date, $3::date, $4, $5)
        ON CONFLICT (dataset, account_id, from_date, to_date) DO UPDATE SET
          expected_spend = EXCLUDED.expected_spend, row_count = EXCLUDED.row_count,
          verified_at = now()`,
        [account.id, fetched.since, fetched.until, stored.spend, stored.row_count],
      );
      console.log(
        JSON.stringify({
          executionId,
          account: account.name,
          from: fetched.since,
          to: fetched.until,
          rows: stored.row_count,
          spend: Math.round(stored.spend * 100) / 100,
        }),
      );
    }
  }
} finally {
  await client.end();
}
