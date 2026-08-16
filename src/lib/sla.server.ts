// Server-only Yeastar call reader backed by this application's Railway
// PostgreSQL database. n8n pulls directly from Yeastar and posts raw call rows
// through /api/ingest/dataset; no Google Sheet or Supabase read is involved.

import { readDashboardDataset } from "./dashboard-db.server";
import { readSalesReport, type SalesReportRow } from "./sales-report.ts";

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

/**
 * Kept as an alias rather than a second copy of the same fields: two identical
 * interfaces, one here and one beside the parser, would drift the first time a
 * column is added to the report.
 */
export type SlaSalesSummary = SalesReportRow;

export interface SlaSnapshot {
  repMonthly: SlaRepMonthly[];
  salesSummary: SlaSalesSummary[];
  /**
   * Whether `salesSummary` has a feed behind it at all — the database is
   * reachable *and* the `sales_summary` dataset has been ingested at least once.
   *
   * The screen has to tell a missing integration apart from a quiet month.
   * Before the dataset existed this was permanently false, and the operational
   * figure still rendered as "unavailable for this period" — which sent readers
   * hunting for a gap in the month rather than a feed nobody had wired up.
   */
  salesSummaryConfigured: boolean;
  fetchedAt: string;
  source: string;
}

interface MutableMonth extends SlaRepMonthly {}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value: unknown): string => String(value ?? "").trim();

const dateOf = (value: string): string => {
  const matched = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return matched?.[1] || "";
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
  const [calls, extensions, sales] = await Promise.all([
    readDashboardDataset("sla_calls"),
    readDashboardDataset("pbx_extensions"),
    readDashboardDataset("sales_summary"),
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
  // Keep the existing `month` field name for the API contract, but aggregate
  // at day grain. The employee screen supports arbitrary date windows; a
  // monthly bucket made Aug 1–5 accidentally include calls from Aug 6 onward.
  const daily = new Map<string, MutableMonth>();

  for (const call of calls.rows) {
    const day = dateOf(text(call.started_at || call["Started At"]));
    const extension = text(call.extension);
    const mapped = extensionMap.get(extension);
    const userName = text(call.user_name) || mapped?.userName || "";
    const userId = num(call.user_id) || mapped?.userId || 0;
    if (!day || !userName) continue;
    const direction = text(call.direction).toLowerCase();
    if (direction && direction !== "outbound") continue;

    const key = `${day}\u0000${userName}`;
    const row = daily.get(key) ?? blank(day, userId, userName);
    const talkSeconds = num(call.talk_sec);
    const disposition = text(call.disposition).toUpperCase();
    row.outbound_calls += 1;
    row.talk_sec += talkSeconds;
    if (talkSeconds > 0 || disposition === "ANSWERED") row.answered_calls += 1;
    daily.set(key, row);
  }

  const repMonthly = [...daily.values()]
    .map((row) => ({
      ...row,
      answer_pct:
        row.outbound_calls > 0 ? (row.answered_calls / row.outbound_calls) * 100 : null,
    }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.user_name.localeCompare(b.user_name));
  const fetchedAt =
    [calls.syncedAt, extensions.syncedAt, sales.syncedAt].filter(Boolean).sort().at(-1) || "";
  return {
    repMonthly,
    salesSummary: readSalesReport(sales.rows),
    // A dataset that has never been posted to is a missing feed, not an empty
    // month — `status` is the only thing that separates the two, since both
    // leave `rows` empty.
    salesSummaryConfigured: sales.configured && sales.status !== "never",
    fetchedAt,
    source: "Railway PostgreSQL · Yeastar · Odoo sales report",
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
