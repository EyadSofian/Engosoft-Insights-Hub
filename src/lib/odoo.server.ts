// Live JSON-RPC client for the Engosoft Odoo 17 (Enterprise) instance.
//
// Every other tab in this dashboard reads a Google Sheet that an n8n workflow
// refreshes every 30 minutes. The Products tab talks to Odoo directly instead,
// so a sale shows up here as soon as the order is confirmed rather than up to
// half an hour later.
//
// Auth is an Odoo API key used in place of a password against `common.authenticate`.
// The key is read from the environment and never logged or returned in a response.

export interface OdooConfig {
  url: string;
  db: string;
  login: string;
  apiKey: string;
  /** The companies this dashboard reports on: Egypt, KSA, UAE. */
  companyIds: number[];
  /** Earliest date any Products query will look at. */
  startDate: string;
}

/** Odoo many2one fields arrive as `[id, display_name]`, or `false` when unset. */
export type M2O = [number, string] | false;

const numberList = (raw: string | undefined, fallback: number[]): number[] => {
  const parsed = (raw ?? "")
    .split(/[,\s-]+/)
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);
  return parsed.length ? parsed : fallback;
};

export function odooConfig(): OdooConfig {
  return {
    url: (process.env.ODOO_URL || "https://engosoft.com").replace(/\/+$/, ""),
    db: process.env.ODOO_DB || "EngoSoft",
    login: process.env.ODOO_LOGIN || "",
    apiKey: process.env.ODOO_API_KEY || "",
    // Matches `cids=2-3-4` in the Odoo web URLs the team uses.
    companyIds: numberList(process.env.ODOO_COMPANY_IDS, [2, 3, 4]),
    startDate: process.env.ODOO_START_DATE || "2026-01-01",
  };
}

export function odooConfigured(): boolean {
  const c = odooConfig();
  return Boolean(c.url && c.db && c.login && c.apiKey);
}

/** Raised for a reachable Odoo that refused the call, so routes can say why. */
export class OdooError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "access" | "server" | "network" | "config" = "server",
  ) {
    super(message);
    this.name = "OdooError";
  }
}

let uidCache: { uid: number; login: string; db: string } | null = null;

async function rpc(
  service: string,
  method: string,
  args: unknown[],
  timeoutMs: number,
): Promise<unknown> {
  const cfg = odooConfig();
  const res = await fetch(`${cfg.url}/jsonrpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: Math.floor(Math.random() * 1e9),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new OdooError(`Odoo responded ${res.status}`, "server");

  const body = (await res.json()) as {
    result?: unknown;
    error?: { message?: string; data?: { message?: string; name?: string } };
  };

  if (body.error) {
    const detail = String(body.error.data?.message || body.error.message || "Odoo error").trim();
    const name = String(body.error.data?.name || "");
    const kind = /AccessError|AccessDenied/i.test(name) ? "access" : "server";
    // Odoo's access errors are chatty and multi-line; keep the first sentence.
    throw new OdooError(detail.split("\n")[0].slice(0, 300), kind);
  }
  return body.result;
}

/**
 * Authenticates and caches the uid. Odoo API keys don't expire on their own, so
 * the uid stays valid for the life of the process; it is re-fetched if a call
 * later fails authentication (key rotated, user archived).
 */
async function uid(): Promise<number> {
  const cfg = odooConfig();
  if (!cfg.login || !cfg.apiKey) {
    throw new OdooError(
      "Odoo is not configured. Set ODOO_LOGIN and ODOO_API_KEY in the environment.",
      "config",
    );
  }
  if (uidCache && uidCache.login === cfg.login && uidCache.db === cfg.db) return uidCache.uid;

  const result = await rpc("common", "authenticate", [cfg.db, cfg.login, cfg.apiKey, {}], 30_000);
  if (typeof result !== "number" || !result) {
    throw new OdooError(
      `Odoo rejected the credentials for ${cfg.login} on database ${cfg.db}.`,
      "auth",
    );
  }
  uidCache = { uid: result, login: cfg.login, db: cfg.db };
  return result;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls a model method. Transient network failures are retried; access and auth
 * errors are not, because retrying them only burns time.
 */
export async function odooCall<T>(
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {},
): Promise<T> {
  const cfg = odooConfig();
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const user = await uid();
      return (await rpc(
        "object",
        "execute_kw",
        [cfg.db, user, cfg.apiKey, model, method, args, kwargs],
        120_000,
      )) as T;
    } catch (err) {
      lastError = err;
      if (err instanceof OdooError && (err.kind === "access" || err.kind === "config")) throw err;
      if (err instanceof OdooError && err.kind === "auth") {
        // Force a fresh authenticate once, then give up.
        uidCache = null;
        if (attempt > 0) throw err;
      }
      if (attempt < 2) await wait(800 * (attempt + 1));
    }
  }

  if (lastError instanceof OdooError) throw lastError;
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new OdooError(`Could not reach Odoo at ${cfg.url}: ${reason}`, "network");
}

/** The multi-company context every read runs under. */
export function companyContext(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { allowed_company_ids: odooConfig().companyIds, ...extra };
}

export type Domain = unknown[];

/**
 * `search_read` in pages. Odoo will happily return 100k rows in one response and
 * then time out behind nginx; 2,000-row pages keep each round trip small.
 */
export async function searchRead<T extends { id: number }>(
  model: string,
  domain: Domain,
  fields: string[],
  options: { order?: string; limit?: number; context?: Record<string, unknown> } = {},
): Promise<T[]> {
  const pageSize = 2000;
  const out: T[] = [];
  const hardLimit = options.limit ?? Infinity;

  for (let offset = 0; out.length < hardLimit; offset += pageSize) {
    const take = Math.min(pageSize, hardLimit - out.length);
    const page = await odooCall<T[]>(model, "search_read", [domain, fields], {
      offset,
      limit: take,
      order: options.order ?? "id",
      context: companyContext(options.context),
    });
    out.push(...page);
    if (page.length < take) break;
  }
  return out;
}

export async function searchCount(
  model: string,
  domain: Domain,
  context: Record<string, unknown> = {},
): Promise<number> {
  return odooCall<number>(model, "search_count", [domain], { context: companyContext(context) });
}

export interface ReadGroupRow {
  __count: number;
  [key: string]: unknown;
}

export async function readGroup(
  model: string,
  domain: Domain,
  fields: string[],
  groupBy: string[],
  context: Record<string, unknown> = {},
): Promise<ReadGroupRow[]> {
  return odooCall<ReadGroupRow[]>(model, "read_group", [domain, fields, groupBy], {
    lazy: false,
    context: companyContext(context),
  });
}

/* --- small shared helpers ------------------------------------------------ */

export const m2oId = (v: M2O | undefined | null): number => (Array.isArray(v) ? Number(v[0]) : 0);
export const m2oName = (v: M2O | undefined | null): string =>
  Array.isArray(v) ? String(v[1] ?? "") : "";

/** Health probe used by the Products route to render a precise error. */
export async function odooPing(): Promise<{
  ok: boolean;
  uid?: number;
  version?: string;
  error?: string;
}> {
  try {
    const version = (await rpc("common", "version", [], 20_000)) as { server_version?: string };
    const user = await uid();
    return { ok: true, uid: user, version: version?.server_version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
