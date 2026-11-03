/**
 * One read-only door onto every analytical surface — all of its sources.
 *
 * WHAT CHANGED AND WHY. The previous gateway did `surface.endpoints[0]!`. Five
 * of the sixteen surfaces are built from more than one endpoint, so five
 * surfaces reported CONNECTED while serving a fraction of the page: campaigns
 * without risk, leads without call coverage, accounting without profitability,
 * media_plan without activity, social_media without organic. The agent then
 * told a manager the dashboard had no such data, with the data on screen.
 *
 * This module resolves the sources that apply to THIS request from the
 * contract — narrowed by view, by operation, and by whether a required argument
 * was supplied — fetches them together, and merges them under explicit
 * namespaces so two payloads carrying `totals` cannot overwrite each other.
 *
 * IT DOES NOT COMPUTE. Every figure comes from the same handler the page calls.
 *
 * IT DOES NOT RETURN THE RAW PAYLOAD. A single one of these endpoints is over a
 * megabyte. What leaves here is a flat summary of quotable scalars, a capped
 * set of allow-listed rows, and the evidence trail — never the source body.
 */

import {
  AGENT_CONTRACT_VERSION,
  AGENT_FORBIDDEN_ENDPOINTS,
  caveatsFor,
  contractById,
  operationsFor,
  sourcesFor,
  type Bilingual,
  type RowProjection,
  type SurfaceContract,
  type SurfaceOperation,
  type SurfaceSource,
} from "./agent-surface-contract";

export type AgentResultStatus =
  | "OK"
  | "PARTIAL"
  | "NOT_APPLICABLE"
  | "INVALID_FILTER"
  | "UNKNOWN_ENTITY"
  | "PERMISSION_DENIED"
  | "UPSTREAM_ERROR";

/** What one source contributed, and whether it worked. */
export interface SourceEvidence {
  /** The contract namespace, not a URL. The agent never sees the endpoint. */
  source: string;
  ok: boolean;
  /** HTTP status, or 0 when the request never completed. */
  httpStatus: number;
  durationMs: number;
  /** Present only on failure. Never a stack trace. */
  reason?: string;
  /** True when the source was skipped because its argument was not supplied. */
  skipped?: boolean;
}

export interface AgentSurfaceRow {
  /** What this row is: "salesperson", "campaign", "course". */
  kind: string;
  /** The human label. Never an internal id. */
  label: string;
  /**
   * A ready-to-read line.
   *
   * Preformatted on purpose: handing a model a bag of objects and asking it to
   * lay them out is what produced JSX fragments and a 6,173-character JSON dump
   * in a user's chat. A line is a line.
   */
  line: string;
  /** The same figures, typed, for a caller that wants to rank or compare. */
  metrics: Record<string, number | string>;
}

export interface AgentSurfaceResult {
  schemaVersion: string;
  status: AgentResultStatus;
  surface: string;
  view: string | null;
  operation: string;
  /** Only the filters this surface declared and the caller actually set. */
  filters: Record<string, string>;
  period: { from: string | null; to: string | null } | null;
  /** "As of" markers the sources published, flattened. */
  freshness: Record<string, string | number>;
  evidence: SourceEvidence[];
  summary: Record<string, number | string>;
  rows: AgentSurfaceRow[];
  coverage: {
    sourcesRequested: number;
    sourcesOk: number;
    /** Namespaces that failed but did not sink the answer. */
    degraded: string[];
    /** True when every source the request needed answered. */
    complete: boolean;
  };
  /** Standing limitations. The reader must be told these every time. */
  caveats: string[];
  /** Present only when the status is not OK/PARTIAL. */
  reason?: string;
}

const EMPTY_RESULT = (
  surface: string,
  operation: string,
  view: string | null,
): AgentSurfaceResult => ({
  schemaVersion: AGENT_CONTRACT_VERSION,
  status: "OK",
  surface,
  view,
  operation,
  filters: {},
  period: null,
  freshness: {},
  evidence: [],
  summary: {},
  rows: [],
  coverage: { sourcesRequested: 0, sourcesOk: 0, degraded: [], complete: true },
  caveats: [],
});

/** Arabic by default — the reader is an ENGOSOFT manager. */
const caveatText = (caveat: Bilingual, lang: "ar" | "en"): string => caveat[lang];

export interface GatewayRequest {
  surfaceId: string;
  operation: string;
  view: string | null;
  /** Raw query parameters from the caller. Filtered against the contract. */
  params: URLSearchParams;
  /** Absolute origin the dashboard's own endpoints are served from. */
  origin: string;
  lang?: "ar" | "en";
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export async function readSurface(request: GatewayRequest): Promise<AgentSurfaceResult> {
  const { surfaceId, params, origin, lang = "ar" } = request;
  const doFetch = request.fetchImpl ?? fetch;
  const view = request.view?.trim() || null;
  const operation = (request.operation || "summary").trim();

  const contract = contractById(surfaceId);
  if (!contract) {
    return {
      ...EMPTY_RESULT(surfaceId, operation, view),
      status: "UNKNOWN_ENTITY",
      reason: `Unknown surface "${surfaceId}".`,
    };
  }

  if (contract.status === "NOT_APPLICABLE") {
    return {
      ...EMPTY_RESULT(contract.id, operation, view),
      status: "NOT_APPLICABLE",
      reason: contract.note ?? "This surface carries no analytics.",
    };
  }

  if (view && contract.views.length > 0 && !contract.views.some((v) => v.id === view)) {
    return {
      ...EMPTY_RESULT(contract.id, operation, view),
      status: "INVALID_FILTER",
      reason: `"${view}" is not a view of ${contract.id}. Available: ${contract.views
        .map((v) => v.id)
        .join(", ")}.`,
    };
  }

  const allowedOperations = operationsFor(contract, view);
  if (!allowedOperations.includes(operation as SurfaceOperation)) {
    return {
      ...EMPTY_RESULT(contract.id, operation, view),
      status: "INVALID_FILTER",
      reason: `"${operation}" is not available here. Supported: ${allowedOperations.join(", ")}.`,
    };
  }

  /**
   * Only the filters this surface declared.
   *
   * The old gateway forwarded a fixed list to every endpoint, so a `course`
   * filter reached surfaces that do not understand one and a `salesTeam` filter
   * silently did nothing on ads. Forwarding what the contract declares makes
   * the applied filters an honest report of what was applied.
   */
  const forwarded: Record<string, string> = {};
  for (const key of contract.filters) {
    const value = params.get(key);
    if (value) forwarded[key] = value;
  }

  const sources = sourcesFor(contract, {
    view,
    operation: operation as SurfaceOperation,
    args: forwarded,
  });

  if (sources.length === 0) {
    return {
      ...EMPTY_RESULT(contract.id, operation, view),
      status: "INVALID_FILTER",
      filters: forwarded,
      reason: `No data source applies to ${contract.id} for operation "${operation}"${
        view ? ` and view "${view}"` : ""
      }.`,
    };
  }

  /**
   * A required source missing its required argument is a caller error, and must
   * say so rather than being fired off into a guaranteed HTTP 400.
   */
  for (const source of sources) {
    const missing = (source.requiredArgs ?? []).filter((key) => !forwarded[key]);
    if (missing.length > 0 && source.required) {
      return {
        ...EMPTY_RESULT(contract.id, operation, view),
        status: "INVALID_FILTER",
        filters: forwarded,
        reason: `${contract.id} needs ${missing.join(", ")} for this request.`,
      };
    }
  }

  const blocked = sources.find((source) =>
    (AGENT_FORBIDDEN_ENDPOINTS as readonly string[]).includes(source.endpoint),
  );
  if (blocked) {
    return {
      ...EMPTY_RESULT(contract.id, operation, view),
      status: "PERMISSION_DENIED",
      filters: forwarded,
      reason: "This surface is not readable by the agent.",
    };
  }

  const fetched = await Promise.all(
    sources.map((source) => fetchSource(source, forwarded, origin, doFetch)),
  );

  const evidence: SourceEvidence[] = fetched.map((entry) => entry.evidence);
  const degraded = fetched.filter((entry) => !entry.evidence.ok).map((entry) => entry.source.as);
  const failedRequired = fetched.filter((entry) => !entry.evidence.ok && entry.source.required);

  if (failedRequired.length > 0) {
    return {
      ...EMPTY_RESULT(contract.id, operation, view),
      status: "UPSTREAM_ERROR",
      filters: forwarded,
      evidence,
      coverage: {
        sourcesRequested: sources.length,
        sourcesOk: fetched.length - degraded.length,
        degraded,
        complete: false,
      },
      caveats: caveatsFor(contract, view).map((caveat) => caveatText(caveat, lang)),
      reason: `The dashboard source for ${contract.id} could not be read: ${
        failedRequired[0]!.evidence.reason ?? "unknown error"
      }. This is a source failure, not an absence of data.`,
    };
  }

  const ok = fetched.filter((entry) => entry.evidence.ok && entry.payload);

  const summary: Record<string, number | string> = {};
  const rows: AgentSurfaceRow[] = [];
  const freshness: Record<string, string | number> = {};
  const merged: Record<string, unknown> = {};

  for (const entry of ok) {
    const payload = entry.payload!;
    const namespace = entry.source.as === "root" ? "" : entry.source.as;
    // Root claims the top level; every other source gets its own key, so two
    // sources carrying `totals` stay two different figures.
    if (namespace) merged[namespace] = payload;
    else Object.assign(merged, payload);

    collectSummary(summary, payload, entry.source.summaryPaths ?? [], namespace);
    collectFreshness(freshness, payload, contract.freshnessPaths ?? [], namespace);
  }

  // Surface-level summary paths run over the merged object, so a path can span
  // sources when a surface genuinely needs one to.
  collectSummary(summary, merged, contract.summaryPaths ?? [], "");

  for (const projection of contract.rows ?? []) {
    rows.push(...projectRows(merged, projection, contract));
  }

  const complete = degraded.length === 0;

  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    status: complete ? "OK" : "PARTIAL",
    surface: contract.id,
    view,
    operation,
    filters: forwarded,
    period:
      forwarded.from || forwarded.to
        ? { from: forwarded.from ?? null, to: forwarded.to ?? null }
        : null,
    freshness,
    evidence,
    summary,
    rows,
    coverage: {
      sourcesRequested: sources.length,
      sourcesOk: ok.length,
      degraded,
      complete,
    },
    caveats: caveatsFor(contract, view).map((caveat) => caveatText(caveat, lang)),
  };
}

// --- Fetching ----------------------------------------------------------------

async function fetchSource(
  source: SurfaceSource,
  filters: Record<string, string>,
  origin: string,
  doFetch: typeof fetch,
): Promise<{ source: SurfaceSource; payload: Record<string, unknown> | null; evidence: SourceEvidence }> {
  const missing = (source.requiredArgs ?? []).filter((key) => !filters[key]);
  if (missing.length > 0) {
    // Optional-and-unarmed: skipped, and said so. Not an error, not a silent
    // omission — the caller can see the source was never consulted.
    return {
      source,
      payload: null,
      evidence: {
        source: source.as,
        ok: false,
        httpStatus: 0,
        durationMs: 0,
        skipped: true,
        reason: `Not consulted: ${missing.join(", ")} was not supplied.`,
      },
    };
  }

  const target = new URL(source.endpoint, origin);
  for (const [key, value] of Object.entries(filters)) target.searchParams.set(key, value);

  const started = Date.now();
  try {
    const response = await doFetch(target, { headers: { accept: "application/json" } });
    const durationMs = Date.now() - started;
    if (!response.ok) {
      return {
        source,
        payload: null,
        evidence: {
          source: source.as,
          ok: false,
          httpStatus: response.status,
          durationMs,
          reason: `HTTP ${response.status}`,
        },
      };
    }
    const payload = (await response.json()) as Record<string, unknown>;
    return {
      source,
      payload,
      evidence: { source: source.as, ok: true, httpStatus: response.status, durationMs },
    };
  } catch (error) {
    return {
      source,
      payload: null,
      evidence: {
        source: source.as,
        ok: false,
        httpStatus: 0,
        durationMs: Date.now() - started,
        // The message, never the stack.
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// --- Summary -----------------------------------------------------------------

/**
 * The scalar figures a surface leads with, hoisted flat.
 *
 * Live: /website showed "مبيعات الموقع $1,926.57" while Nexus answered with the
 * company-wide $8,210.94. The figure was in the payload the whole time, at
 * `totals.sales` — two levels down beside forty other keys. A model handed a
 * nested object goes looking somewhere else.
 *
 * `namespace` is what stops the second source overwriting the first: two
 * payloads both carrying `revenue` produce `revenue` and `organic.revenue`,
 * never one figure silently standing in for the other.
 */
function collectSummary(
  out: Record<string, number | string>,
  payload: Record<string, unknown>,
  paths: readonly string[],
  namespace: string,
): void {
  const take = (source: unknown, group = "") => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return;
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      let name = key;
      if (name in out) name = group ? `${group}.${key}` : name;
      if (name in out && namespace) name = `${namespace}.${key}`;
      if (name in out && namespace && group) name = `${namespace}.${group}.${key}`;
      if (name in out) continue;
      if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
      else if (typeof value === "string" && value.length > 0 && value.length < 120) {
        out[name] = value;
      }
    }
  };

  take(payload.totals);
  take(payload.summary);
  for (const path of paths) {
    take(readPath(payload, path), path.split(".").at(-1) ?? path);
  }
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "number" && Number.isFinite(value) && !(key in out)) out[key] = value;
  }
}

function collectFreshness(
  out: Record<string, string | number>,
  payload: Record<string, unknown>,
  paths: readonly string[],
  namespace: string,
): void {
  const stamp = (key: string, value: unknown) => {
    const name = key in out && namespace ? `${namespace}.${key}` : key;
    if (name in out) return;
    if (typeof value === "string" && value.length > 0 && value.length < 80) out[name] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
  };
  const FRESH_KEYS = /^(asOf|syncedAt|fetchedAt|generatedAt|checkedAt|from|to|today|source|authority)$/i;
  for (const path of paths) {
    const node = readPath(payload, path);
    if (typeof node === "string" || typeof node === "number") {
      stamp(path.split(".").at(-1) ?? path, node);
      continue;
    }
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (FRESH_KEYS.test(key) || /authority$/i.test(key)) stamp(key, value);
    }
  }
}

function readPath(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const segment of path.split(".")) {
    node = node && typeof node === "object" ? (node as Record<string, unknown>)[segment] : undefined;
  }
  return node;
}

// --- Rows --------------------------------------------------------------------

/**
 * Named rows, allow-listed and capped.
 *
 * "Who is behind quota?" and "who should sell CFM?" cannot be answered from
 * totals, and dropping every row meant the agent had to say it could not tell —
 * with a target board on screen in front of the person asking.
 *
 * The field list is an ALLOW-list, which is the safe direction: a column the
 * source adds tomorrow is absent until someone decides it belongs. A deny-list
 * is what rots dangerously, because a new phone-number column would ship by
 * default. Contact details, call recordings, transcripts and identifiers are
 * not in any projection and must not be added.
 */
const FORBIDDEN_ROW_FIELDS = new Set([
  "phone",
  "mobile",
  "email",
  "recordingUrl",
  "transcript",
  "address",
  "nationalId",
  "employeeId",
  "leadPhoneKeys",
  "chatwootAgentId",
]);

/** Enough to say what someone sells; not their whole history. */
const MAX_NESTED_COURSES = 8;

function projectRows(
  merged: Record<string, unknown>,
  projection: RowProjection,
  contract: SurfaceContract,
): AgentSurfaceRow[] {
  const list = readPath(merged, projection.collection);
  if (!Array.isArray(list) || list.length === 0) return [];

  return list.slice(0, projection.limit).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const metrics: Record<string, number | string> = {};

    const put = (name: string, value: unknown) => {
      if (FORBIDDEN_ROW_FIELDS.has(name)) return;
      if (typeof value === "number" && Number.isFinite(value)) metrics[name] = value;
      else if (typeof value === "string" && value.length > 0 && value.length < 120) {
        metrics[name] = value;
      }
    };

    let courses: Array<Record<string, unknown>> = [];
    let people: string[] = [];

    for (const field of projection.fields) {
      const value = row[field];
      if (value === null || value === undefined) continue;

      /**
       * `target`, `performanceScore` and `courseProfile` are objects, and a flat
       * scan skipped all three — so the agent saw a person's revenue and had no
       * idea what they were supposed to hit.
       */
      if (field === "target" && typeof value === "object" && !Array.isArray(value)) {
        const quota = value as Record<string, unknown>;
        put("target", quota.target);
        put("achievementPaid", quota.achievementPaid);
        put("teamLeader", quota.teamLeader);
        put("branch", quota.branch);
        continue;
      }
      if (field === "courses" && Array.isArray(value)) {
        courses = value.slice(0, MAX_NESTED_COURSES) as Array<Record<string, unknown>>;
        continue;
      }
      /**
       * `teams[].people` — the field name the agent guessed wrong. It looked for
       * `teams[].salespeople`, found nothing and reported insufficient data with
       * the evidence in hand. Only the count and the names travel; the nested
       * rows are reachable through the `agents` projection, which is the one
       * that carries the course evidence.
       */
      if (field === "people" && Array.isArray(value)) {
        people = value
          .map((person) =>
            person && typeof person === "object"
              ? String(
                  (person as Record<string, unknown>).displayName ??
                    (person as Record<string, unknown>).name ??
                    "",
                )
              : "",
          )
          .filter(Boolean);
        put("peopleCount", people.length);
        continue;
      }
      if (field === "actual" && typeof value === "object" && !Array.isArray(value)) {
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
          put(`actual.${key}`, inner);
        }
        continue;
      }
      if (field === "owners" && Array.isArray(value)) {
        const owners = value.filter((o) => typeof o === "string").join("، ");
        if (owners) put("owners", owners);
        continue;
      }
      put(field, value);
    }

    const label = String(
      metrics.displayName ?? metrics.name ?? metrics.label ?? metrics.team ?? metrics.key ?? "",
    ).trim();
    if (!label) return [];

    return [
      {
        kind: projection.kind,
        label,
        line: renderLine(label, metrics, courses, people, contract),
        metrics,
      },
    ];
  });
}

const money = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`
    : "—";

const pct = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";

/**
 * One row, already written as a sentence.
 *
 * The model receives lines, not objects. Returning the raw collection so it
 * could lay them out itself is what produced a 6,173-character JSON dump in a
 * user's chat and, separately, JSX the sandbox could not run.
 */
function renderLine(
  label: string,
  metrics: Record<string, number | string>,
  courses: Array<Record<string, unknown>>,
  people: string[],
  contract: SurfaceContract,
): string {
  const parts: string[] = [];
  const has = (key: string) => key in metrics;

  if (has("target")) parts.push(`تارجت ${money(metrics.target)}`);
  if (has("spend")) parts.push(`إنفاق ${money(metrics.spend)}`);
  if (has("paidRevenue")) parts.push(`محقق ${money(metrics.paidRevenue)}`);
  else if (has("revenue")) parts.push(`إيراد ${money(metrics.revenue)}`);
  if (has("achievementPaid")) parts.push(`نسبة تحقيق ${pct(metrics.achievementPaid)}`);
  if (typeof metrics.target === "number" && typeof metrics.paidRevenue === "number") {
    parts.push(`متبقي ${money(metrics.target - metrics.paidRevenue)}`);
  }
  if (has("cleanLeads")) parts.push(`${metrics.cleanLeads} ليد`);
  else if (has("crmLeads")) parts.push(`${metrics.crmLeads} ليد`);
  else if (has("leads")) parts.push(`${metrics.leads} ليد`);
  if (has("won")) parts.push(`${metrics.won} صفقة`);
  if (has("roas")) parts.push(`ROAS ${typeof metrics.roas === "number" ? metrics.roas.toFixed(2) : "—"}x`);
  if (has("cpl")) parts.push(`CPL ${money(metrics.cpl)}`);
  if (has("conversionRate")) parts.push(`تحويل ${pct(metrics.conversionRate)}`);
  if (has("targetLeads")) parts.push(`تارجت ليدز ${metrics.targetLeads}`);
  if (has("targetCpl")) parts.push(`تارجت CPL ${money(metrics.targetCpl)}`);
  if (has("peopleCount")) parts.push(`${metrics.peopleCount} موظف`);
  if (has("owners")) parts.push(`مسؤول: ${metrics.owners}`);

  if (courses.length > 0) {
    const sold = courses
      .slice(0, 3)
      .map((course) => {
        const thin = course.sampleStatus === "insufficient" ? " (عينة صغيرة)" : "";
        return `${String(course.label ?? "—")} ${money(course.paidRevenue)}${thin}`;
      })
      .join("، ");
    if (sold) parts.push(`بيبيع: ${sold}`);
  }

  void contract;
  return `${label} — ${parts.join("، ") || "مفيش أرقام مسجلة"}`;
}
