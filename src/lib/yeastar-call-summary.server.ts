import { getSharedDatabasePool } from "./database-pool.server";
import { accessToken, cairoDayBounds, parseYeastarCdrPage } from "./yeastar-cdr.server";
import { summarizeYeastarCalls } from "./yeastar-call-summary";
import { normalizePersonName } from "./person-name";
import type { CallsHubEmployeeSummary, CallsHubSummary } from "./calls-hub.server";

const DAY_MS = 86_400_000;
const cairo = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayAt = (at: number) => cairo.format(new Date(at));
const midnight = (day: string) => Date.parse(day + "T00:00:00Z");
const dateKey = (at: number) => new Date(at).toISOString().slice(0, 10);
const clean = (value: unknown) => String(value ?? "").trim();
type Row = Record<string, unknown>;
type Snapshot = { day: string; through: string | Date; employees: CallsHubEmployeeSummary[] };
let schema: Promise<unknown> | null = null;
let rosterCache: { expires: number; value: Map<string, string> } | null = null;
let rosterPending: Promise<Map<string, string>> | null = null;
const inFlight = new Map<string, Promise<Snapshot[]>>();

async function request(path: string, params: Record<string, string>, deadline: AbortSignal) {
  const token = await accessToken();
  if (deadline.aborted) throw Error("Yeastar call totals refresh timed out");
  const base = process.env.YEASTAR_BASE_URL?.replace(/\/+$/, "");
  const url = new URL(`${base}/openapi/v1.0/${path}`);
  for (const [key, value] of Object.entries({ ...params, access_token: token }))
    url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { "User-Agent": "Engosoft-Insights-Hub" },
    signal: AbortSignal.any([deadline, AbortSignal.timeout(20_000)]),
  }).catch(() => {
    throw Error("Yeastar call totals connection unavailable");
  });
  if (!response.ok) throw Error(`Yeastar call totals HTTP ${response.status}`);
  return (await response.json()) as { errcode?: number; total_number?: number; data?: Row[] };
}

async function allPages(
  path: string,
  params: Record<string, string>,
  pageSize: number,
  deadline: AbortSignal,
) {
  const records: Row[] = [];
  const pageSignatures = new Set<string>();
  let expected: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const body = await request(
      path,
      { ...params, page: String(page), page_size: String(pageSize) },
      deadline,
    );
    const { total, records: part } = parseYeastarCdrPage(body);
    if (!Number.isSafeInteger(total) || (expected !== undefined && expected !== total))
      throw Error("Yeastar record count changed during pagination");
    expected = total;
    if (part.length) {
      const signature = JSON.stringify([part.length, part[0], part.at(-1)]);
      if (pageSignatures.has(signature)) throw Error("Yeastar returned a repeated page");
      pageSignatures.add(signature);
    }
    records.push(...part);
    if (records.length === expected) return records;
    if (!part.length || records.length > expected) break;
  }
  throw Error("Yeastar pagination incomplete; totals were not replaced");
}

async function roster(deadline: AbortSignal, requireFresh: boolean) {
  if (rosterCache && rosterCache.expires > Date.now()) return rosterCache.value;
  if (rosterPending) return rosterPending;
  rosterPending = (async () => {
    const pool = getSharedDatabasePool();
    const stored = (
      await pool.query<{ seen: Date; entries: [string, string][] }>(
        "SELECT seen, entries FROM yeastar_call_extension_directory WHERE singleton",
      )
    ).rows[0];
    const expires = stored ? Date.parse(String(stored.seen)) + 5 * 60_000 : 0;
    if (stored && (expires > Date.now() || !requireFresh)) {
      const value = new Map(stored.entries);
      rosterCache = { expires, value };
      return value;
    }
    try {
      const rows = await allPages("extension/list", {}, 100, deadline);
      const value = new Map(
        rows
          .map((r) => [clean(r.number), clean(r.caller_id_name)] as const)
          .filter(([extension, name]) => /^\d+$/.test(extension) && name),
      );
      if (!value.size) throw Error("Yeastar extension directory is empty");
      await pool.query(
        `INSERT INTO yeastar_call_extension_directory (singleton, seen, entries)
         VALUES (true, now(), $1::jsonb)
         ON CONFLICT (singleton) DO UPDATE SET seen=EXCLUDED.seen, entries=EXCLUDED.entries`,
        [JSON.stringify([...value])],
      );
      rosterCache = { expires: Date.now() + 5 * 60_000, value };
      return value;
    } catch (error) {
      if (requireFresh) throw error;
      // A complete historical snapshot contains the employees with activity.
      // Without directory evidence, don't claim zero for inactive employees.
      return new Map<string, string>();
    }
  })().finally(() => {
    rosterPending = null;
  });
  return rosterPending;
}

/** The call ID identifies the conversation; the CDR UID identifies a record/leg.
 * Keep distinct attempts, but count the same PBX call only once per extension. */
export function summarizePbxDays(
  rows: Row[],
  days: string[],
  directory: ReadonlyMap<string, string>,
) {
  const calls = new Map<string, Row[]>(days.map((day) => [day, []]));
  for (const r of rows) {
    const direction = clean(r.call_type).toLowerCase();
    if (direction !== "outbound" && direction !== "inbound") continue;
    const extension = clean(direction === "outbound" ? r.call_from_number : r.call_to_number);
    const listed = directory.get(extension);
    const observed = clean(direction === "outbound" ? r.call_from_name : r.call_to_name);
    // Retain names recorded on retired extensions rather than treating a
    // missing directory entry as no calls. Never attribute external numbers.
    if (!listed && (!/^\d{2,6}$/.test(extension) || !observed)) continue;
    const at = Number(r.timestamp) * 1000;
    const id = clean(r.call_id) || clean(r.uid) || clean(r.new_id) || clean(r.id);
    if (!Number.isFinite(at) || at <= 0 || at > 8.64e15 || !id)
      throw Error("Yeastar call record lacks a usable date or ID");
    calls.get(dayAt(at))?.push({
      call_id: id,
      extension,
      user_name: observed || listed,
      started_at: new Date(at).toISOString(),
      direction,
      disposition: r.disposition,
      talk_sec: r.talk_duration,
      call_duration_sec: r.duration,
    });
  }
  return days.map((day) => ({
    day,
    employees: summarizeYeastarCalls(calls.get(day)!, [], day, day),
  }));
}

function mergeSnapshots(snapshots: Snapshot[], directory: Map<string, string>) {
  const merged = new Map<string, CallsHubEmployeeSummary>();
  for (const { employees } of snapshots) {
    for (const row of employees) {
      const key = row.extension + "\0" + normalizePersonName(row.name);
      const held = merged.get(key);
      if (!held) merged.set(key, { ...row });
      else {
        held.totalCalls += row.totalCalls;
        held.outboundCalls += row.outboundCalls;
        held.inboundCalls += row.inboundCalls;
        held.answeredCalls += row.answeredCalls;
        held.periodCallSeconds += row.periodCallSeconds;
        held.periodTalkSeconds += row.periodTalkSeconds;
        held.averageCallSeconds = held.totalCalls ? held.periodCallSeconds / held.totalCalls : 0;
      }
    }
  }
  const active = new Set([...merged.values()].map((r) => r.extension));
  for (const [extension, name] of directory) {
    if (!active.has(extension))
      merged.set(extension, {
        key: extension,
        extension,
        name,
        totalCalls: 0,
        outboundCalls: 0,
        inboundCalls: 0,
        answeredCalls: 0,
        analyzedCalls: 0,
        averageScore: null,
        needsReview: 0,
        periodCallSeconds: 0,
        periodTalkSeconds: 0,
        averageCallSeconds: 0,
      });
  }
  return [...merged.values()].sort(
    (a, b) => b.totalCalls - a.totalCalls || a.extension.localeCompare(b.extension),
  );
}

async function refresh(
  days: string[],
  directory: Map<string, string>,
  now: number,
  deadline: AbortSignal,
) {
  const key = days.join(",");
  const pending = inFlight.get(key);
  if (pending) return pending;
  const task = (async () => {
    const start = cairoDayBounds(days[0]).start;
    const end = Math.min(cairoDayBounds(days.at(-1)!).end, Math.floor(now / 1000));
    const rows = await allPages(
      "cdr/search",
      { start_time: String(start), end_time: String(end) },
      5000,
      deadline,
    );
    const through = new Date(end * 1000).toISOString();
    const snapshots = summarizePbxDays(rows, days, directory).map((row) => ({ ...row, through }));
    // Persist aggregate counts only, not caller numbers or raw CDR.
    await getSharedDatabasePool().query(
      `INSERT INTO yeastar_daily_call_totals (day, through, employees)
       SELECT day::date, through::timestamptz, employees
       FROM jsonb_to_recordset($1::jsonb) AS x(day text, through text, employees jsonb)
       ON CONFLICT (day) DO UPDATE SET through = EXCLUDED.through, employees = EXCLUDED.employees
       WHERE yeastar_daily_call_totals.through <= EXCLUDED.through`,
      [JSON.stringify(snapshots)],
    );
    return snapshots;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

export async function readYeastarCallSummary(from: string, to: string): Promise<CallsHubSummary> {
  const start = midnight(from),
    finish = midnight(to);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    !Number.isFinite(start) ||
    !Number.isFinite(finish) ||
    dateKey(start) !== from ||
    dateKey(finish) !== to ||
    start > finish ||
    finish - start > 366 * DAY_MS
  )
    throw Error("Select a valid Yeastar call date range of up to one year");
  const now = Date.now(),
    today = dayAt(now);
  if (from > today) throw Error("Yeastar call totals cannot include future days");
  const days: string[] = [];
  for (let at = start; at <= finish && dateKey(at) <= today; at += DAY_MS) days.push(dateKey(at));
  const pool = getSharedDatabasePool();
  if (!schema)
    schema = pool
      .query(
        `CREATE TABLE IF NOT EXISTS yeastar_daily_call_totals (
           day date PRIMARY KEY, through timestamptz NOT NULL, employees jsonb NOT NULL
         );
         CREATE TABLE IF NOT EXISTS yeastar_call_extension_directory (
           singleton boolean PRIMARY KEY CHECK (singleton), seen timestamptz NOT NULL, entries jsonb NOT NULL
         )`,
      )
      .catch((err) => {
        schema = null;
        throw err;
      });
  await schema;
  const deadline = AbortSignal.timeout(55_000);
  const stored = await pool.query<Snapshot>(
    `SELECT day::text AS day, through, employees
      FROM yeastar_daily_call_totals WHERE day BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  const byDay = new Map(stored.rows.map((row) => [row.day, row]));
  const batches: string[][] = [];
  for (const day of days) {
    const snapshot = byDay.get(day);
    const coveredThrough = snapshot ? new Date(snapshot.through).getTime() : 0;
    const complete =
      day === today
        ? coveredThrough >= now - 5 * 60_000
        : coveredThrough >= cairoDayBounds(day).end * 1000;
    if (complete) continue;
    const batch = batches.at(-1);
    if (batch && batch.length < 7 && midnight(day) - midnight(batch.at(-1)!) === DAY_MS)
      batch.push(day);
    else batches.push([day]);
  }
  const directory = await roster(deadline, batches.length > 0);
  for (let i = 0; i < batches.length; i += 2) {
    const results = await Promise.all(
      batches.slice(i, i + 2).map((batch) => refresh(batch, directory, now, deadline)),
    );
    for (const snapshot of results.flat()) byDay.set(snapshot.day, snapshot);
  }
  const snapshots = days.map((day) => byDay.get(day)!);
  return {
    ok: true,
    source: "Yeastar CDR · inbound + outbound · Cairo",
    fetchedAt: new Date(snapshots.at(-1)!.through).toISOString(),
    range: { from, to: days.at(-1)! },
    recordsAvailable: false,
    employees: mergeSnapshots(snapshots, directory),
  };
}
