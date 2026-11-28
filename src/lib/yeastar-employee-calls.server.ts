import { accessToken, cairoDayBounds, parseYeastarCdrPage } from "./yeastar-cdr.server";
import { summarizeYeastarCalls } from "./yeastar-call-summary";
import { YEASTAR_EMPLOYEE_IDENTITIES, yeastarEmployeeIdentity } from "./yeastar-employee-identity";
import type { CallsHubLeadCallAggregate } from "./calls-hub.server";

type RawCall = Record<string, unknown>;
const cache = new Map<string, { until: number; data: Awaited<ReturnType<typeof read>> }>();
const pending = new Map<string, ReturnType<typeof read>>();
const cairoDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Convert only external calls on the verified extension. Internal calls and
 * another party's legs never become this employee's attempts or talk time. */
export function normalizeEmployeeCdr(records: RawCall[], extension: string, name: string) {
  return records.flatMap((r) => {
    const direction = String(r.call_type || "").toLowerCase();
    if (!["inbound", "outbound"].includes(direction)) return [];
    const ownNumber = direction === "outbound" ? r.call_from_number : r.call_to_number;
    if (String(ownNumber || "").trim() !== extension) return [];
    const timestamp = Number(r.timestamp);
    const id = String(r.uid || r.call_id || "").trim();
    if (!id || !Number.isFinite(timestamp) || timestamp <= 0) return [];
    return [
      {
        call_id: id,
        extension,
        user_name: name,
        started_at: new Date(timestamp * 1000).toISOString(),
        direction,
        disposition: String(r.disposition || ""),
        talk_sec: Number(r.talk_duration) || 0,
        call_duration_sec: Number(r.duration) || 0,
        remote_normalized: String(
          direction === "outbound" ? r.call_to_number || "" : r.call_from_number || "",
        ).replace(/\D/g, ""),
      },
    ];
  });
}

async function read(from: string, to: string) {
  const base = process.env.YEASTAR_BASE_URL?.replace(/\/+$/, "");
  const token = await accessToken();
  const request = async (path: string, params: Record<string, string>) => {
    const url = new URL(`${base}/openapi/v1.0/${path}`);
    Object.entries({ ...params, access_token: token }).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    );
    const response = await fetch(url, {
      headers: { "User-Agent": "Engosoft-Insights-Hub" },
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`Yeastar employee records HTTP ${response.status}`);
    const body = await response.json();
    if (body.errcode !== 0)
      throw new Error(`Yeastar employee records error ${Number(body.errcode)}`);
    return body;
  };
  // Prevent a reassigned extension from inheriting the previous owner's data.
  const directory: { number: string; caller_id_name: string }[] = [];
  for (let page = 1; page <= 100; page++) {
    const body = await request("extension/list", { page: String(page), page_size: "100" });
    if (!Array.isArray(body.data) || !Number.isFinite(Number(body.total_number)))
      throw Error("Yeastar extension directory is incomplete");
    directory.push(...body.data);
    if (directory.length >= Number(body.total_number)) break;
    if (!body.data.length || page === 100) throw Error("Yeastar extension directory is incomplete");
  }
  const verified = YEASTAR_EMPLOYEE_IDENTITIES.filter((person) =>
    directory.some(
      (row) =>
        String(row.number) === person.extension &&
        yeastarEmployeeIdentity(person.extension, row.caller_id_name)?.email === person.email,
    ),
  );
  if (verified.length !== YEASTAR_EMPLOYEE_IDENTITIES.length)
    throw Error("Yeastar employee extension ownership needs verification");
  const start = cairoDayBounds(from).start,
    end = cairoDayBounds(to).end;
  const rows: ReturnType<typeof normalizeEmployeeCdr> = [];
  for (const person of verified) {
    for (const field of ["call_from", "call_to"]) {
      const records: RawCall[] = [];
      for (let page = 1; page <= 100; page++) {
        const body = await request("cdr/search", {
          start_time: String(start),
          end_time: String(end),
          [field]: person.extension,
          page: String(page),
          page_size: "10000",
        });
        const parsed = parseYeastarCdrPage(body);
        records.push(...parsed.records);
        if (records.length >= parsed.total) break;
        if (!parsed.records.length || page === 100)
          throw Error("Yeastar employee CDR pagination is incomplete");
      }
      rows.push(...normalizeEmployeeCdr(records, person.extension, person.pbxName));
    }
  }
  const distinct = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const day = cairoDay.format(new Date(row.started_at));
    if (day < from || day > to) continue;
    const key = `${row.extension}\0${row.call_id}`;
    const old = distinct.get(key);
    distinct.set(key, {
      ...row,
      talk_sec: Math.max(row.talk_sec, old?.talk_sec || 0),
      call_duration_sec: Math.max(row.call_duration_sec, old?.call_duration_sec || 0),
      disposition:
        row.disposition === "ANSWERED" || old?.disposition === "ANSWERED"
          ? "ANSWERED"
          : row.disposition,
    });
  }
  const calls = [...distinct.values()];
  const grouped = new Map<string, CallsHubLeadCallAggregate>();
  for (const row of calls) {
    if (row.direction !== "outbound" || row.remote_normalized.length < 9) continue;
    const day = cairoDay.format(new Date(row.started_at));
    const key = `${row.extension}\0${row.remote_normalized}\0${day}`;
    const group = grouped.get(key) || {
      phone: row.remote_normalized,
      agentName: row.user_name,
      agentExtension: row.extension,
      callDate: day,
      totalCalls: 0,
      answeredCalls: 0,
      firstCallAt: row.started_at,
      latestCallAt: row.started_at,
      latestCallId: row.call_id,
    };
    group.totalCalls++;
    group.answeredCalls += Number(row.talk_sec > 0 || row.disposition === "ANSWERED");
    if (row.started_at < group.firstCallAt) group.firstCallAt = row.started_at;
    if (row.started_at >= group.latestCallAt) {
      group.latestCallAt = row.started_at;
      group.latestCallId = row.call_id;
    }
    grouped.set(key, group);
  }
  return {
    employees: summarizeYeastarCalls(
      calls,
      verified.map((p) => ({ extension: p.extension, user_name: p.pbxName })),
      from,
      to,
    ),
    leadCalls: [...grouped.values()],
    fetchedAt: new Date().toISOString(),
  };
}

export async function readVerifiedEmployeeCalls(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    throw Error("A valid employee call period is required");
  const key = `${from}:${to}`,
    held = cache.get(key);
  if (held && held.until > Date.now()) return held.data;
  const running = pending.get(key);
  if (running) return running;
  const task = read(from, to)
    .then((data) => {
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(key, { until: Date.now() + 5 * 60000, data });
      return data;
    })
    .finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
