// Server-only Yeastar call reader backed by this application's Railway
// PostgreSQL database. n8n pulls directly from Yeastar and posts raw call rows
// through /api/ingest/dataset; no Google Sheet or Supabase read is involved.

import { readDashboardDataset } from "./dashboard-db.server";

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

export interface SlaSnapshot {
  repMonthly: SlaRepMonthly[];
  salesSummary: SlaSalesSummary[];
  fetchedAt: string;
  source: string;
}

interface MutableMonth extends SlaRepMonthly {}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value: unknown): string => String(value ?? "").trim();

const monthOf = (value: string): string => {
  const matched = value.match(/^(\d{4}-\d{2})/);
  return matched ? `${matched[1]}-01` : "";
};

const blank = (month: string, userId: number, userName: string): MutableMonth => ({
  month,
  user_id: userId,
  user_name: userName,
  team_name: null,
  open_leads: 0,
  new_leads: 0,
  contacted_leads: 0,
  uncontacted_leads: 0,
  avg_first_call_minutes: null,
  won_leads: 0,
  lost_leads: 0,
  outbound_calls: 0,
  answered_calls: 0,
  talk_sec: 0,
  new_pipeline: 0,
  won_revenue: 0,
  contact_pct: null,
  conversion_pct: null,
  answer_pct: null,
});

let dataCache: { value: SlaSnapshot; expiresAt: number } | null = null;
let inFlight: Promise<SlaSnapshot> | null = null;

async function refresh(): Promise<SlaSnapshot> {
  const [calls, extensions] = await Promise.all([
    readDashboardDataset("sla_calls"),
    readDashboardDataset("pbx_extensions"),
  ]);
  if (!calls.configured || !extensions.configured) {
    throw new Error("Railway PostgreSQL is not configured for Yeastar calls.");
  }

  const extensionMap = new Map(
    extensions.rows
      .map((row) => [
        text(row.extension),
        { userId: num(row.user_id), userName: text(row.user_name) },
      ] as const)
      .filter(([extension, person]) => extension && person.userName),
  );
  const monthly = new Map<string, MutableMonth>();

  for (const call of calls.rows) {
    const month = monthOf(text(call.started_at || call["Started At"]));
    const extension = text(call.extension);
    const mapped = extensionMap.get(extension);
    const userName = text(call.user_name) || mapped?.userName || "";
    const userId = num(call.user_id) || mapped?.userId || 0;
    if (!month || !userName) continue;
    const direction = text(call.direction).toLowerCase();
    if (direction && direction !== "outbound") continue;

    const key = `${month}\u0000${userName}`;
    const row = monthly.get(key) ?? blank(month, userId, userName);
    const talkSeconds = num(call.talk_sec);
    const disposition = text(call.disposition).toUpperCase();
    row.outbound_calls += 1;
    row.talk_sec += talkSeconds;
    if (talkSeconds > 0 || disposition === "ANSWERED") row.answered_calls += 1;
    monthly.set(key, row);
  }

  const repMonthly = [...monthly.values()]
    .map((row) => ({
      ...row,
      answer_pct:
        row.outbound_calls > 0 ? (row.answered_calls / row.outbound_calls) * 100 : null,
    }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.user_name.localeCompare(b.user_name));
  const fetchedAt = [calls.syncedAt, extensions.syncedAt].filter(Boolean).sort().at(-1) || "";
  return {
    repMonthly,
    salesSummary: [],
    fetchedAt,
    source: "Railway PostgreSQL · Yeastar",
  };
}

export async function getSlaSnapshot(): Promise<SlaSnapshot> {
  if (dataCache && dataCache.expiresAt > Date.now()) return dataCache.value;
  if (!inFlight) {
    inFlight = refresh()
      .then((value) => {
        dataCache = { value, expiresAt: Date.now() + 60_000 };
        return value;
      })
      .finally(() => (inFlight = null));
  }
  return inFlight;
}
