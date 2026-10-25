/** Compare every Meta account/day to the platform, then certify dashboard coverage. */
import { execFileSync } from "node:child_process";
import pg from "pg";

const PROJECT = "455aeae3-25ff-4dc3-98c8-d1fa3f039052";
const [from, to, flag] = process.argv.slice(2);
const apply = flag === "--apply";
if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "") || from > to) {
  throw new Error("Use FROM TO [--apply].");
}
const vars = JSON.parse(
  execFileSync(
    "railway",
    [
      "variable",
      "list",
      "-p",
      PROJECT,
      "-e",
      "production",
      "-s",
      "Engosoft-Insights-Hub",
      "--json",
    ],
    { encoding: "utf8" },
  ),
);
const token = vars.META_ACCESS_TOKEN;
if (!token || !process.env.DATABASE_PUBLIC_URL)
  throw new Error("Meta token or public DB URL missing.");
const version = vars.META_API_VERSION || "v25.0";
const headers = { Authorization: `Bearer ${token}` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(45000) });
      const body = await response.json();
      if (!response.ok || body.error)
        throw new Error(`Meta HTTP ${response.status}: ${body.error?.message || "unknown"}`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(2000 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function pages(url) {
  const rows = [];
  for (let page = 0; url; page += 1) {
    if (page > 100) throw new Error("Meta pagination exceeded 100 pages.");
    const body = await get(url);
    rows.push(...(body.data || []));
    url = body.paging?.next || "";
  }
  return rows;
}

const accountUrl = new URL(`https://graph.facebook.com/${version}/me/adaccounts`);
accountUrl.searchParams.set("fields", "id,name,currency");
accountUrl.searchParams.set("limit", "500");
const accounts = await pages(accountUrl.toString());
if (!accounts.length) throw new Error("Meta returned zero accounts.");
const client = new pg.Client({ connectionString: process.env.DATABASE_PUBLIC_URL });
await client.connect();
const report = [];
try {
  for (const account of accounts) {
    if (account.currency !== "USD") throw new Error(`${account.name} is not USD.`);
    const url = new URL(`https://graph.facebook.com/${version}/${account.id}/insights`);
    url.searchParams.set("fields", "date_start,spend");
    url.searchParams.set("level", "account");
    url.searchParams.set("time_increment", "1");
    url.searchParams.set("time_range", JSON.stringify({ since: from, until: to }));
    url.searchParams.set("limit", "500");
    const source = await pages(url.toString());
    const expected = new Map(source.map((row) => [row.date_start, Number(row.spend || 0)]));
    const { rows: stored } = await client.query(
      `
      SELECT record_date::text AS date, count(*)::integer AS row_count,
        coalesce(sum((row_data->>'Spend (Cost)')::numeric), 0)::float8 AS spend
      FROM dashboard_rows WHERE dataset = 'meta_ads'
        AND row_data->>'__account_id' = $1
        AND record_date BETWEEN $2::date AND $3::date
      GROUP BY record_date`,
      [account.id, from, to],
    );
    const actual = new Map(stored.map((row) => [row.date, Number(row.spend)]));
    const dates = new Set([...expected.keys(), ...actual.keys()]);
    const mismatches = [...dates]
      .filter((date) => Math.abs((expected.get(date) || 0) - (actual.get(date) || 0)) > 0.05)
      .map((date) => ({ date, expected: expected.get(date) || 0, actual: actual.get(date) || 0 }));
    const result = {
      account: account.name,
      id: account.id,
      from,
      to,
      expected:
        Math.round([...expected.values()].reduce((sum, value) => sum + value, 0) * 100) / 100,
      actual: Math.round([...actual.values()].reduce((sum, value) => sum + value, 0) * 100) / 100,
      rows: stored.reduce((sum, row) => sum + row.row_count, 0),
      mismatches,
    };
    report.push(result);
    console.log(JSON.stringify(result));
  }
  if (report.some((row) => row.mismatches.length))
    throw new Error("Meta daily spend does not reconcile; no coverage certified.");
  if (apply) {
    await client.query("BEGIN");
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
      for (const row of report) {
        await client.query(
          `INSERT INTO ad_delivery_accounts (dataset, account_id, account_name, currency)
          VALUES ('meta_ads', $1, $2, 'USD')
          ON CONFLICT (dataset, account_id) DO UPDATE SET
            account_name = EXCLUDED.account_name, discovered_at = now()`,
          [row.id, row.account],
        );
        await client.query(
          `INSERT INTO ad_delivery_coverage
          (dataset, account_id, from_date, to_date, expected_spend, row_count)
          VALUES ('meta_ads', $1, $2::date, $3::date, $4, $5)
          ON CONFLICT (dataset, account_id, from_date, to_date) DO UPDATE SET
            expected_spend = EXCLUDED.expected_spend, row_count = EXCLUDED.row_count,
            verified_at = now()`,
          [row.id, from, to, row.expected, row.rows],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  console.log(
    JSON.stringify({
      complete: true,
      accounts: report.length,
      spend: Math.round(report.reduce((sum, row) => sum + row.expected, 0) * 100) / 100,
      certified: apply,
    }),
  );
} finally {
  await client.end();
}
