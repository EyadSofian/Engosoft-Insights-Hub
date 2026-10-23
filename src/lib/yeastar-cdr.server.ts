import { getSharedDatabasePool } from "./database-pool.server.ts";
import type { CallsHubLeadCallAggregate } from "./calls-hub.server";

type Cdr = {
  uid?: string;
  call_id?: string;
  call_type?: string;
  call_to_number?: string;
  call_from_number?: string;
  call_from_name?: string;
  timestamp?: number;
  talk_duration?: number;
  disposition?: string;
};

/** Yeastar omits `data` entirely when a successful search has zero records. */
export function parseYeastarCdrPage(body: {
  errcode?: number;
  total_number?: number;
  data?: Cdr[] | null;
}): { total: number; records: Cdr[] } {
  if (body.errcode !== 0) throw new Error(`Yeastar CDR error ${body.errcode ?? "unknown"}`);
  const total = Number(body.total_number);
  if (!Number.isFinite(total) || total < 0) throw new Error("Yeastar CDR total is invalid");
  if (total === 0 && body.data == null) return { total: 0, records: [] };
  if (!Array.isArray(body.data)) throw new Error("Yeastar CDR data is missing");
  return { total, records: body.data };
}

type DayCall = {
  uid: string;
  day: string;
  startedAt: string;
  phone: string;
  extension: string;
  agentName: string;
  answered: boolean;
};

let token: { value: string; expiresAt: number } | null = null;
let schemaReady: Promise<void> | null = null;

const baseUrl = () => process.env.YEASTAR_BASE_URL?.replace(/\/+$/, "") ?? "";
const configured = () =>
  Boolean(baseUrl() && process.env.YEASTAR_CLIENT_ID && process.env.YEASTAR_CLIENT_SECRET);

function cairoDayBounds(day: string): { start: number; end: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Invalid CDR day");
  const startOf = (date: string) => {
    const midnight = Date.parse(`${date}T00:00:00Z`);
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", timeZoneName: "shortOffset" })
        .formatToParts(new Date(midnight + 12 * 3_600_000))
        .find((part) => part.type === "timeZoneName")?.value ?? "GMT+2";
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    const offset = match
      ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0))
      : 120;
    return Math.floor((midnight - offset * 60_000) / 1000);
  };
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { start: startOf(day), end: startOf(nextDay) - 1 };
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getSharedDatabasePool()
      .query(
        `
        CREATE TABLE IF NOT EXISTS yeastar_cdr (
          uid text PRIMARY KEY,
          call_day date NOT NULL,
          started_at timestamptz NOT NULL,
          remote_phone text NOT NULL,
          agent_extension text NOT NULL DEFAULT '',
          agent_name text NOT NULL DEFAULT '',
          answered boolean NOT NULL DEFAULT false,
          synced_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS yeastar_cdr_day_idx ON yeastar_cdr (call_day);
        CREATE TABLE IF NOT EXISTS yeastar_cdr_coverage (
          call_day date PRIMARY KEY,
          row_count integer NOT NULL,
          synced_at timestamptz NOT NULL DEFAULT now()
        );
      `,
      )
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}

async function accessToken(): Promise<string> {
  if (!configured()) throw new Error("Yeastar API is not configured");
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const response = await fetch(`${baseUrl()}/openapi/v1.0/get_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Engosoft-Insights-Hub" },
    body: JSON.stringify({
      username: process.env.YEASTAR_CLIENT_ID,
      password: process.env.YEASTAR_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Yeastar authentication HTTP ${response.status}`);
  const body = (await response.json()) as {
    errcode?: number;
    access_token?: string;
    access_token_expire_time?: number;
  };
  if (body.errcode !== 0 || !body.access_token) throw new Error("Yeastar authentication failed");
  token = {
    value: body.access_token,
    expiresAt: Date.now() + Math.min(Number(body.access_token_expire_time) || 1800, 1800) * 1000,
  };
  return token.value;
}

export function collapseYeastarCdr(day: string, records: Cdr[]): DayCall[] {
  const calls = new Map<string, DayCall>();
  for (const row of records) {
    if (row.call_type?.toLowerCase() !== "outbound") continue;
    const phone = String(row.call_to_number ?? "").replace(/\D/g, "");
    const uid = String(row.uid || row.call_id || "").trim();
    const started = Number(row.timestamp);
    if (!uid || phone.length < 9 || !Number.isFinite(started) || started <= 0) continue;
    const answered = row.disposition === "ANSWERED" || Number(row.talk_duration) > 0;
    const existing = calls.get(uid);
    if (existing) {
      // Yeastar can emit several call legs for one dial attempt. Never count
      // those legs as multiple salesperson attempts.
      existing.answered ||= answered;
      continue;
    }
    calls.set(uid, {
      uid,
      day,
      startedAt: new Date(started * 1000).toISOString(),
      phone,
      extension: String(row.call_from_number ?? ""),
      agentName: String(row.call_from_name ?? ""),
      answered,
    });
  }
  return [...calls.values()];
}

async function fetchDay(day: string): Promise<DayCall[]> {
  const bounds = cairoDayBounds(day);
  const pageSize = 10_000;
  let page = 1;
  let total = 0;
  const records: Cdr[] = [];
  do {
    const url = new URL(`${baseUrl()}/openapi/v1.0/cdr/search`);
    url.searchParams.set("access_token", await accessToken());
    url.searchParams.set("start_time", String(bounds.start));
    url.searchParams.set("end_time", String(bounds.end));
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(pageSize));
    const response = await fetch(url, {
      headers: { "User-Agent": "Engosoft-Insights-Hub" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`Yeastar CDR HTTP ${response.status}`);
    const body = (await response.json()) as {
      errcode?: number;
      total_number?: number;
      data?: Cdr[];
    };
    const parsedPage = parseYeastarCdrPage(body);
    total = parsedPage.total;
    records.push(...parsedPage.records);
    if (parsedPage.records.length === 0 && records.length < total)
      throw new Error("Yeastar CDR pagination stopped early");
    page += 1;
  } while (records.length < total && page <= 100);
  if (records.length < total) throw new Error("Yeastar CDR pagination incomplete");
  return collapseYeastarCdr(day, records);
}

export async function syncYeastarCdrDay(day: string): Promise<number> {
  await ensureSchema();
  const calls = await fetchDay(day);
  const client = await getSharedDatabasePool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`yeastar_cdr:${day}`]);
    // A re-fetch of today can correct an earlier partial day. Older days are
    // immutable in normal operation; this remains safe for manual resyncs.
    await client.query("DELETE FROM yeastar_cdr WHERE call_day = $1::date", [day]);
    for (let offset = 0; offset < calls.length; offset += 500) {
      const batch = calls.slice(offset, offset + 500);
      const params: unknown[] = [];
      const values = batch.map((call, index) => {
        params.push(
          call.uid,
          call.day,
          call.startedAt,
          call.phone,
          call.extension,
          call.agentName,
          call.answered,
        );
        const n = index * 7;
        return `($${n + 1},$${n + 2}::date,$${n + 3}::timestamptz,$${n + 4},$${n + 5},$${n + 6},$${n + 7})`;
      });
      await client.query(
        `INSERT INTO yeastar_cdr
          (uid, call_day, started_at, remote_phone, agent_extension, agent_name, answered)
         VALUES ${values.join(",")}
         ON CONFLICT (uid) DO UPDATE SET
           call_day = EXCLUDED.call_day, started_at = EXCLUDED.started_at,
           remote_phone = EXCLUDED.remote_phone, agent_extension = EXCLUDED.agent_extension,
           agent_name = EXCLUDED.agent_name, answered = EXCLUDED.answered, synced_at = now()`,
        params,
      );
    }
    await client.query(
      `INSERT INTO yeastar_cdr_coverage (call_day, row_count, synced_at)
       VALUES ($1::date, $2, now())
       ON CONFLICT (call_day) DO UPDATE SET row_count = EXCLUDED.row_count,
         synced_at = EXCLUDED.synced_at`,
      [day, calls.length],
    );
    await client.query("COMMIT");
    return calls.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function yeastarCdrCoverage(
  from: string,
  to: string,
): Promise<{
  expectedDays: number;
  coveredDays: number;
  newestSync: string | null;
}> {
  await ensureSchema();
  const result = await getSharedDatabasePool().query<{
    expected_days: number;
    covered_days: number;
    newest_sync: string | null;
  }>(
    `SELECT count(*)::int AS expected_days,
            count(c.call_day)::int AS covered_days,
            max(c.synced_at)::text AS newest_sync
       FROM generate_series($1::date, $2::date, interval '1 day') d(day)
       LEFT JOIN yeastar_cdr_coverage c ON c.call_day = d.day::date`,
    [from, to],
  );
  return {
    expectedDays: Number(result.rows[0]?.expected_days ?? 0),
    coveredDays: Number(result.rows[0]?.covered_days ?? 0),
    newestSync: result.rows[0]?.newest_sync ?? null,
  };
}

const recentSyncs = new Map<string, Promise<void>>();

export async function refreshRecentYeastarCdr(day: string): Promise<void> {
  if (!configured()) throw new Error("Yeastar API is not configured");
  const previous = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const key = `${previous}:${day}`;
  const existing = recentSyncs.get(key);
  if (existing) return existing;
  const task = (async () => {
    const yesterday = await yeastarCdrCoverage(previous, previous);
    if (
      !yesterday.coveredDays ||
      Date.parse(yesterday.newestSync ?? "") < Date.parse(`${day}T00:00:00Z`)
    )
      await syncYeastarCdrDay(previous);
    const today = await yeastarCdrCoverage(day, day);
    const age = Date.now() - Date.parse(today.newestSync ?? "");
    if (today.coveredDays && Number.isFinite(age) && age >= 0 && age < 20 * 60_000) return;
    await syncYeastarCdrDay(day);
  })();
  recentSyncs.set(key, task);
  try {
    await task;
  } finally {
    recentSyncs.delete(key);
  }
}

export async function readVerifiedYeastarLeadCalls(
  from: string,
  to: string,
): Promise<CallsHubLeadCallAggregate[]> {
  const coverage = await yeastarCdrCoverage(from, to);
  if (!coverage.expectedDays || coverage.coveredDays !== coverage.expectedDays)
    throw new Error(`Yeastar CDR coverage ${coverage.coveredDays}/${coverage.expectedDays} days`);
  const result = await getSharedDatabasePool().query<{
    phone: string;
    agent_name: string;
    agent_extension: string;
    call_day: string;
    total_calls: number;
    answered_calls: number;
    first_call_at: Date | string;
    latest_call_at: Date | string;
    latest_call_id: string;
  }>(
    `SELECT remote_phone AS phone, agent_name, agent_extension, call_day::text,
            count(*)::int AS total_calls,
            count(*) FILTER (WHERE answered)::int AS answered_calls,
            min(started_at) AS first_call_at,
            max(started_at) AS latest_call_at,
            (array_agg(uid ORDER BY started_at DESC))[1] AS latest_call_id
       FROM yeastar_cdr
      WHERE call_day BETWEEN $1::date AND $2::date
      GROUP BY remote_phone, agent_name, agent_extension, call_day`,
    [from, to],
  );
  return result.rows.map((row) => ({
    phone: row.phone,
    agentName: row.agent_name,
    agentExtension: row.agent_extension,
    callDate: row.call_day,
    totalCalls: Number(row.total_calls),
    answeredCalls: Number(row.answered_calls),
    firstCallAt: new Date(row.first_call_at).toISOString(),
    latestCallAt: new Date(row.latest_call_at).toISOString(),
    latestCallId: row.latest_call_id,
  }));
}
