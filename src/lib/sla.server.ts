// Server-only reader for the operational SLA dashboard.
//
// The upstream project intentionally exposes read-only Supabase views through
// a publishable key. Environment variables are preferred. When this dashboard
// is deployed without them, we discover the same public configuration from the
// deployed SLA application's JavaScript bundle and cache it.

export interface SlaRepMonthly {
  month: string;
  user_id: number;
  user_name: string;
  team_name: string | null;
  open_leads: number;
  new_leads: number;
  contacted_leads: number;
  uncontacted_leads: number;
  avg_first_call_minutes: number | null;
  won_leads: number;
  lost_leads: number;
  outbound_calls: number;
  answered_calls: number;
  talk_sec: number;
  new_pipeline: number;
  won_revenue: number;
  contact_pct: number | null;
  conversion_pct: number | null;
  answer_pct: number | null;
}

export interface SlaSalesSummary {
  month: string;
  team_name: string | null;
  user_name: string | null;
  achieved_untaxed: number | null;
  achieved_total: number | null;
  deals_count: number | null;
  quotations_count: number | null;
  pipeline_value: number | null;
  team_target: number | null;
  team_attainment_pct: number | null;
}

interface PublicConfig {
  base: string;
  key: string;
}

export interface SlaSnapshot {
  repMonthly: SlaRepMonthly[];
  salesSummary: SlaSalesSummary[];
  fetchedAt: string;
  source: string;
}

const APP_URL = (process.env.SLA_APP_URL || "https://sla-engosoft-production.up.railway.app")
  .replace(/\/+$/, "");

let configCache: { value: PublicConfig; expiresAt: number } | null = null;
let dataCache: { value: SlaSnapshot; expiresAt: number } | null = null;
let inFlight: Promise<SlaSnapshot> | null = null;

const timeout = (ms: number) => AbortSignal.timeout(ms);

async function discoverPublicConfig(): Promise<PublicConfig> {
  const envBase = (process.env.SLA_SUPABASE_URL || "").replace(/\/+$/, "");
  const envKey = process.env.SLA_SUPABASE_ANON_KEY || "";
  if (envBase && envKey) return { base: envBase, key: envKey };

  if (configCache && configCache.expiresAt > Date.now()) return configCache.value;

  const htmlResponse = await fetch(`${APP_URL}/sales`, { signal: timeout(20_000) });
  if (!htmlResponse.ok) throw new Error(`SLA application responded ${htmlResponse.status}`);
  const html = await htmlResponse.text();
  const scripts = [...html.matchAll(/(?:src|href)=["']([^"']+\.js[^"']*)["']/g)].map(
    (match) => new URL(match[1], APP_URL).href,
  );

  for (const script of scripts) {
    const response = await fetch(script, { signal: timeout(30_000) });
    if (!response.ok) continue;
    const source = await response.text();
    const base = source.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i)?.[0] || "";
    const key = source.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0] || "";
    if (!base || !key) continue;
    const value = { base: base.replace(/\/+$/, ""), key };
    configCache = { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
    return value;
  }

  throw new Error(
    "SLA public connection was not found. Set SLA_SUPABASE_URL and SLA_SUPABASE_ANON_KEY.",
  );
}

async function readView<T>(view: string, order: string): Promise<T[]> {
  const cfg = await discoverPublicConfig();
  const query = new URLSearchParams({ select: "*", order, limit: "10000" });
  const response = await fetch(`${cfg.base}/rest/v1/${view}?${query}`, {
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
    },
    signal: timeout(35_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    throw new Error(`SLA ${view} responded ${response.status}: ${detail}`);
  }
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows)) throw new Error(`SLA ${view} did not return rows`);
  return rows as T[];
}

async function refresh(): Promise<SlaSnapshot> {
  const [repMonthly, salesSummary] = await Promise.all([
    readView<SlaRepMonthly>("sales_rep_monthly", "month.asc,user_name.asc"),
    readView<SlaSalesSummary>("sales_summary", "month.asc,user_name.asc"),
  ]);
  const value = {
    repMonthly,
    salesSummary,
    fetchedAt: new Date().toISOString(),
    source: `${APP_URL}/sales`,
  };
  dataCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
  return value;
}

export async function getSlaSnapshot(): Promise<SlaSnapshot> {
  if (dataCache && dataCache.expiresAt > Date.now()) return dataCache.value;
  if (!inFlight) inFlight = refresh().finally(() => (inFlight = null));
  return inFlight;
}
