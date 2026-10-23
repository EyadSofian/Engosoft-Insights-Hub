const DEFAULT_CALLS_HUB_URL = "https://web-production-c7b78.up.railway.app";
const FETCH_TIMEOUT_MS = 10_000;
const SUMMARY_TTL_MS = 60_000;

export interface CallsHubEmployeeSummary {
  key: string;
  name: string;
  extension: string;
  totalCalls: number;
  answeredCalls: number;
  analyzedCalls: number;
  averageScore: number | null;
  needsReview: number;
  periodCallSeconds: number;
  periodTalkSeconds: number;
  averageCallSeconds: number;
}

export interface CallsHubCall {
  id: string;
  pbxCallId: string;
  agentName: string;
  agentExtension: string;
  customerNumber: string;
  callType: string;
  state: string;
  startedAt: string;
  durationSeconds: number;
  talkSeconds: number;
  disposition: string;
  summary: string;
  intent: string;
  sentiment: string;
  riskLevel: string;
  recordingState: string;
  recordingPlayable: boolean;
  qualityScore: number | null;
  analysisConfidence: number | null;
}

export interface CallsHubSummary {
  ok: boolean;
  source: string;
  fetchedAt: string;
  range: { from: string; to: string };
  employees: CallsHubEmployeeSummary[];
  error?: string;
}

export interface CallsHubEmployeeCalls {
  ok: boolean;
  source: string;
  appUrl: string;
  employee: { key: string; name: string; extension: string };
  range: { from: string; to: string };
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  calls: CallsHubCall[];
}

export interface CallsHubLeadCallAggregate {
  phone: string;
  agentName: string;
  agentExtension: string;
  /** Cairo calendar day. Present on the corrected Calls Hub contract. */
  callDate: string;
  totalCalls: number;
  answeredCalls: number;
  firstCallAt: string;
  latestCallAt: string;
  latestCallId: string;
}

type CacheEntry = { expiresAt: number; value: CallsHubSummary };
const summaryCache = new Map<string, CacheEntry>();
const summaryInFlight = new Map<string, Promise<CallsHubSummary>>();
const leadCallsCache = new Map<string, { expiresAt: number; value: CallsHubLeadCallAggregate[] }>();
const leadCallsInFlight = new Map<string, Promise<CallsHubLeadCallAggregate[]>>();

const safeNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const optionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const safeText = (value: unknown): string => (typeof value === "string" ? value : "");

function baseUrl(): string {
  return (process.env.CALLS_HUB_URL || DEFAULT_CALLS_HUB_URL).replace(/\/+$/, "");
}

function requestHeaders(): HeadersInit {
  const headers: HeadersInit = { Accept: "application/json" };
  const secret = process.env.CALLS_HUB_INTERNAL_SECRET?.trim();
  if (secret) headers["x-insights-secret"] = secret;
  return headers;
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url, {
    headers: requestHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Calls Hub returned HTTP ${response.status}`);
  return response.json();
}

/**
 * The old Calls Hub domain can disappear while the Yeastar ingest remains
 * healthy in this app's PostgreSQL. Read that same PBX evidence by phone/day;
 * never turn an unavailable or stale feed into zero calls.
 */
async function readStoredLeadCalls(from: string, to: string): Promise<CallsHubLeadCallAggregate[]> {
  const { getSharedDatabasePool } = await import("./database-pool.server");
  const pool = getSharedDatabasePool();
  const state = await pool.query<{ status: string; synced_at: Date | string }>(
    "SELECT status, synced_at FROM dashboard_sync_state WHERE dataset = 'sla_calls'",
  );
  const sync = state.rows[0];
  const age = Date.now() - Date.parse(String(sync?.synced_at ?? ""));
  if (sync?.status !== "success" || !Number.isFinite(age) || age < 0 || age > 36 * 3_600_000)
    throw new Error("Yeastar call feed is unavailable or stale");

  const result = await pool.query<{
    phone: string;
    agent_name: string;
    agent_extension: string;
    call_day: string;
    total_calls: number;
    answered_calls: number;
    first_call_at: string;
    latest_call_at: string;
    latest_call_id: string;
  }>(
    `SELECT row_data->>'remote_normalized' AS phone,
            COALESCE(row_data->>'user_name', '') AS agent_name,
            COALESCE(row_data->>'extension', '') AS agent_extension,
            ((row_data->>'started_at')::timestamptz AT TIME ZONE 'Africa/Cairo')::date::text AS call_day,
            count(*)::int AS total_calls,
            count(*) FILTER (WHERE COALESCE(NULLIF(row_data->>'talk_sec', '')::numeric, 0) > 0
                  OR upper(COALESCE(row_data->>'disposition', '')) = 'ANSWERED')::int AS answered_calls,
            min(row_data->>'started_at') AS first_call_at,
            max(row_data->>'started_at') AS latest_call_at,
            (array_agg(row_data->>'call_id' ORDER BY row_data->>'started_at' DESC))[1] AS latest_call_id
       FROM dashboard_rows
      WHERE dataset = 'sla_calls'
        AND record_date >= ($1::date - 1)
        AND record_date <= ($2::date + 1)
        AND lower(COALESCE(row_data->>'direction', '')) = 'outbound'
        AND length(COALESCE(row_data->>'remote_normalized', '')) >= 9
        AND ((row_data->>'started_at')::timestamptz AT TIME ZONE 'Africa/Cairo')::date
              BETWEEN $1::date AND $2::date
      GROUP BY 1, 2, 3, 4`,
    [from, to],
  );
  return result.rows.map((row) => ({
    phone: row.phone,
    agentName: row.agent_name,
    agentExtension: row.agent_extension,
    callDate: row.call_day,
    totalCalls: Number(row.total_calls),
    answeredCalls: Number(row.answered_calls),
    firstCallAt: row.first_call_at,
    latestCallAt: row.latest_call_at,
    latestCallId: row.latest_call_id,
  }));
}

function employeeSummary(value: unknown): CallsHubEmployeeSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const extension = safeText(row.extension || row.key).trim();
  const name = safeText(row.name).trim();
  if (!extension || !name) return null;
  return {
    key: safeText(row.key) || extension,
    name,
    extension,
    totalCalls: safeNumber(row.totalCalls),
    answeredCalls: safeNumber(row.answeredCalls),
    analyzedCalls: safeNumber(row.analyzedCalls),
    averageScore: optionalNumber(row.averageScore),
    needsReview: safeNumber(row.needsReview),
    periodCallSeconds: safeNumber(row.periodCallSeconds),
    periodTalkSeconds: safeNumber(row.periodTalkSeconds),
    averageCallSeconds: safeNumber(row.averageCallSeconds),
  };
}

function callRow(value: unknown): CallsHubCall | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = safeText(row.id).trim();
  if (!id) return null;
  return {
    id,
    pbxCallId: safeText(row.pbxCallId),
    agentName: safeText(row.agentName),
    agentExtension: safeText(row.agentExtension),
    customerNumber: safeText(row.customerNumber),
    callType: safeText(row.callType),
    state: safeText(row.state),
    startedAt: safeText(row.startedAt),
    durationSeconds: safeNumber(row.durationSeconds),
    talkSeconds: safeNumber(row.talkSeconds),
    disposition: safeText(row.disposition),
    summary: safeText(row.summary),
    intent: safeText(row.intent),
    sentiment: safeText(row.sentiment),
    riskLevel: safeText(row.riskLevel),
    recordingState: safeText(row.recordingState),
    recordingPlayable: row.recordingPlayable === true,
    qualityScore: optionalNumber(row.analysisScore ?? row.qualityScore),
    analysisConfidence: optionalNumber(row.analysisConfidence),
  };
}

export async function getCallsHubSummary(from: string, to: string): Promise<CallsHubSummary> {
  const cacheKey = `${from}:${to}`;
  const cached = summaryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const running = summaryInFlight.get(cacheKey);
  if (running) return running;

  const request = (async () => {
    const url = new URL("/api/dashboard", `${baseUrl()}/`);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    const body = (await fetchJson(url)) as Record<string, unknown>;
    const rawEmployees = Array.isArray(body.employees) ? body.employees : [];
    const result: CallsHubSummary = {
      ok: true,
      source: "Engosoft Calls Hub · Yeastar",
      fetchedAt: safeText(body.generatedAt) || new Date().toISOString(),
      range: { from, to },
      employees: rawEmployees.map(employeeSummary).filter(Boolean) as CallsHubEmployeeSummary[],
    };
    summaryCache.set(cacheKey, { expiresAt: Date.now() + SUMMARY_TTL_MS, value: result });
    return result;
  })().finally(() => summaryInFlight.delete(cacheKey));
  summaryInFlight.set(cacheKey, request);
  return request;
}

export async function getCallsHubLeadCalls(
  from: string,
  to: string,
): Promise<CallsHubLeadCallAggregate[]> {
  const cacheKey = `${from}:${to}`;
  const cached = leadCallsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const running = leadCallsInFlight.get(cacheKey);
  if (running) return running;

  const request = (async () => {
    const url = new URL("/api/integrations/insights/lead-calls", `${baseUrl()}/`);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    let body: Record<string, unknown>;
    try {
      body = (await fetchJson(url)) as Record<string, unknown>;
    } catch {
      const value = await readStoredLeadCalls(from, to);
      leadCallsCache.set(cacheKey, { expiresAt: Date.now() + SUMMARY_TTL_MS, value });
      return value;
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const value = rows.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const phone = safeText(row.phone);
      if (!phone) return [];
      return [
        {
          phone,
          agentName: safeText(row.agentName),
          agentExtension: safeText(row.agentExtension),
          callDate: safeText(row.callDate),
          totalCalls: safeNumber(row.totalCalls),
          answeredCalls: safeNumber(row.answeredCalls),
          firstCallAt: safeText(row.firstCallAt),
          latestCallAt: safeText(row.latestCallAt),
          latestCallId: safeText(row.latestCallId),
        },
      ];
    });
    leadCallsCache.set(cacheKey, { expiresAt: Date.now() + SUMMARY_TTL_MS, value });
    return value;
  })().finally(() => leadCallsInFlight.delete(cacheKey));
  leadCallsInFlight.set(cacheKey, request);
  return request;
}

export async function getCallsHubEmployeeCalls(input: {
  extension: string;
  from: string;
  to: string;
  page?: number;
  pageSize?: number;
  playableFirst?: boolean;
  reviewFirst?: boolean;
}): Promise<CallsHubEmployeeCalls> {
  if (!/^\d{1,16}$/.test(input.extension)) throw new Error("Invalid employee extension");
  const page = Math.max(1, Math.min(100_000, Math.trunc(input.page || 1)));
  const pageSize = Math.max(1, Math.min(100, Math.trunc(input.pageSize || 25)));
  const url = new URL(
    `/api/employees/${encodeURIComponent(input.extension)}/calls`,
    `${baseUrl()}/`,
  );
  url.searchParams.set("from", input.from);
  url.searchParams.set("to", input.to);
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
  if (input.playableFirst) url.searchParams.set("playable_first", "true");
  if (input.reviewFirst) url.searchParams.set("review_first", "true");
  const body = (await fetchJson(url)) as Record<string, unknown>;
  const employee = (body.employee || {}) as Record<string, unknown>;
  const rawCalls = Array.isArray(body.calls) ? body.calls : [];
  return {
    ok: body.ok === true,
    source: "Engosoft Calls Hub · Yeastar",
    appUrl: baseUrl(),
    employee: {
      key: safeText(employee.key),
      name: safeText(employee.name),
      extension: safeText(employee.extension) || input.extension,
    },
    range: { from: input.from, to: input.to },
    page: safeNumber(body.page) || page,
    pageSize: safeNumber(body.pageSize) || pageSize,
    total: safeNumber(body.total),
    totalPages: safeNumber(body.totalPages),
    hasNext: body.hasNext === true,
    calls: rawCalls.map(callRow).filter(Boolean) as CallsHubCall[],
  };
}

const callIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getCallsHubCallDetail(callId: string): Promise<unknown> {
  if (!callIdPattern.test(callId)) throw new Error("Invalid call id");
  return fetchJson(new URL(`/api/calls/${encodeURIComponent(callId)}`, `${baseUrl()}/`));
}

export async function proxyCallsHubRecording(
  callId: string,
  range: string | null,
): Promise<Response> {
  if (!callIdPattern.test(callId)) {
    return Response.json({ error: "Invalid call id" }, { status: 400 });
  }
  const headers = new Headers(requestHeaders());
  if (range) headers.set("range", range);
  const upstream = await fetch(
    new URL(`/api/calls/${encodeURIComponent(callId)}/recording`, `${baseUrl()}/`),
    { headers, cache: "no-store" },
  );
  const responseHeaders = new Headers();
  for (const name of ["accept-ranges", "content-length", "content-range", "content-type"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("cache-control", "private, max-age=300");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
