import type { GlobalFilters, TeamAgg } from "./types";
import type { FilteredData } from "./metrics.server";
import {
  getSlaSnapshot,
  type SlaRepMonthly,
  type SlaSalesSummary,
} from "./sla.server";

export interface AgentAnalyticsRow {
  key: string;
  name: string;
  team: string;
  paidRevenue: number;
  invoices: number;
  cleanLeads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  lostRate: number | null;
  avgCloseDays: number | null;
  closeSample: number;
  openLeads: number;
  newLeads: number;
  contactedLeads: number;
  uncontactedLeads: number;
  outboundCalls: number;
  answeredCalls: number;
  answerRate: number | null;
  contactRate: number | null;
  talkSeconds: number;
  avgFirstCallMinutes: number | null;
  slaWon: number;
  slaLost: number;
  decidedConversionRate: number | null;
  operationalSales: number;
  operationalUntaxed: number;
  operationalDeals: number;
  quotations: number;
  pipeline: number;
  slaMonths: number;
}

export interface AgentAnalyticsResult {
  agents: AgentAnalyticsRow[];
  summary: {
    agents: number;
    paidRevenue: number;
    invoices: number;
    cleanLeads: number;
    won: number;
    lost: number;
    conversionRate: number | null;
    outboundCalls: number;
    answeredCalls: number;
    answerRate: number | null;
  };
  sla: {
    ok: boolean;
    source: string;
    fetchedAt: string;
    error?: string;
    grain: "month";
  };
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizePersonName = (value: string): string =>
  value
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

const monthKey = (value: string): string => value.slice(0, 7);

function monthEnd(month: string): string {
  const [year, rawMonth] = month.split("-").map(Number);
  if (!year || !rawMonth) return `${month}-31`;
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

function monthIncluded(monthValue: string, filters: GlobalFilters): boolean {
  const month = monthKey(monthValue);
  if (!month) return false;
  const start = `${month}-01`;
  const end = monthEnd(month);
  if (filters.from && end < filters.from) return false;
  if (filters.to && start > filters.to) return false;
  return true;
}

interface MutableAgent extends AgentAnalyticsRow {
  teams: Set<string>;
  firstCallWeighted: number;
  firstCallWeight: number;
  invoiceRefs: Set<string>;
  months: Set<string>;
  latestOpenMonth: string;
}

const blank = (key: string, name: string): MutableAgent => ({
  key,
  name,
  team: "—",
  teams: new Set(),
  paidRevenue: 0,
  invoices: 0,
  cleanLeads: 0,
  won: 0,
  lost: 0,
  conversionRate: null,
  lostRate: null,
  avgCloseDays: null,
  closeSample: 0,
  openLeads: 0,
  newLeads: 0,
  contactedLeads: 0,
  uncontactedLeads: 0,
  outboundCalls: 0,
  answeredCalls: 0,
  answerRate: null,
  contactRate: null,
  talkSeconds: 0,
  avgFirstCallMinutes: null,
  slaWon: 0,
  slaLost: 0,
  decidedConversionRate: null,
  operationalSales: 0,
  operationalUntaxed: 0,
  operationalDeals: 0,
  quotations: 0,
  pipeline: 0,
  slaMonths: 0,
  firstCallWeighted: 0,
  firstCallWeight: 0,
  invoiceRefs: new Set(),
  months: new Set(),
  latestOpenMonth: "",
});

function mergeMainPeople(map: Map<string, MutableAgent>, teams: TeamAgg[]) {
  for (const team of teams) {
    for (const person of team.people ?? []) {
      if (!person.name || person.name === "—") continue;
      const key = normalizePersonName(person.name);
      if (!key) continue;
      const row = map.get(key) ?? blank(key, person.name);
      row.teams.add(team.name);
      row.paidRevenue += person.revenue;
      row.cleanLeads += person.crmLeads;
      row.won += person.won;
      row.lost += person.lost;
      row.closeSample += person.closeSample;
      if (person.avgCloseDays !== null)
        row.avgCloseDays =
          ((row.avgCloseDays ?? 0) * Math.max(0, row.closeSample - person.closeSample) +
            person.avgCloseDays * person.closeSample) /
          Math.max(1, row.closeSample);
      map.set(key, row);
    }
  }
}

function mergeInvoiceRefs(map: Map<string, MutableAgent>, data: FilteredData) {
  for (const invoice of data.accounting) {
    if (!invoice.salesperson || !invoice.movement) continue;
    const key = normalizePersonName(invoice.salesperson);
    if (!key) continue;
    const row = map.get(key) ?? blank(key, invoice.salesperson);
    row.invoiceRefs.add(invoice.movement);
    if (invoice.salesTeam) row.teams.add(invoice.salesTeam);
    map.set(key, row);
  }
}

function mergeSlaRep(map: Map<string, MutableAgent>, rows: SlaRepMonthly[]) {
  for (const source of rows) {
    const key = normalizePersonName(source.user_name || "");
    if (!key) continue;
    const row = map.get(key) ?? blank(key, source.user_name);
    const month = monthKey(source.month);
    row.months.add(month);
    if (source.team_name) row.teams.add(source.team_name);
    if (month >= row.latestOpenMonth) {
      row.latestOpenMonth = month;
      row.openLeads = num(source.open_leads);
    }
    row.newLeads += num(source.new_leads);
    row.contactedLeads += num(source.contacted_leads);
    row.uncontactedLeads += num(source.uncontacted_leads);
    row.outboundCalls += num(source.outbound_calls);
    row.answeredCalls += num(source.answered_calls);
    row.talkSeconds += num(source.talk_sec);
    row.slaWon += num(source.won_leads);
    row.slaLost += num(source.lost_leads);
    if (source.avg_first_call_minutes !== null && num(source.contacted_leads) > 0) {
      row.firstCallWeighted += num(source.avg_first_call_minutes) * num(source.contacted_leads);
      row.firstCallWeight += num(source.contacted_leads);
    }
    map.set(key, row);
  }
}

function mergeSlaSales(map: Map<string, MutableAgent>, rows: SlaSalesSummary[]) {
  for (const source of rows) {
    const key = normalizePersonName(source.user_name || "");
    if (!key) continue;
    const row = map.get(key) ?? blank(key, source.user_name || "—");
    if (source.team_name) row.teams.add(source.team_name);
    row.months.add(monthKey(source.month));
    row.operationalSales += num(source.achieved_total);
    row.operationalUntaxed += num(source.achieved_untaxed);
    row.operationalDeals += num(source.deals_count);
    row.quotations += num(source.quotations_count);
    row.pipeline += num(source.pipeline_value);
    map.set(key, row);
  }
}

export async function buildAgentAnalytics(
  data: FilteredData,
  filters: GlobalFilters,
  teams: TeamAgg[],
): Promise<AgentAnalyticsResult> {
  const map = new Map<string, MutableAgent>();
  mergeMainPeople(map, teams);
  mergeInvoiceRefs(map, data);

  let slaStatus: AgentAnalyticsResult["sla"] = {
    ok: false,
    source: "https://sla-engosoft-production.up.railway.app/sales",
    fetchedAt: "",
    grain: "month",
  };
  try {
    const snapshot = await Promise.race([
      getSlaSnapshot(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    if (!snapshot) {
      throw new Error(
        "SLA is still refreshing in the background. Accounting and CRM figures remain available.",
      );
    }
    mergeSlaRep(map, snapshot.repMonthly.filter((row) => monthIncluded(row.month, filters)));
    mergeSlaSales(map, snapshot.salesSummary.filter((row) => monthIncluded(row.month, filters)));
    slaStatus = {
      ok: true,
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      grain: "month",
    };
  } catch (error) {
    slaStatus.error = error instanceof Error ? error.message : String(error);
  }

  const agents = [...map.values()]
    .map((row): AgentAnalyticsRow => {
      row.invoices = row.invoiceRefs.size;
      row.team = [...row.teams].filter(Boolean).join(" · ") || "—";
      row.conversionRate = row.cleanLeads > 0 ? (row.won / row.cleanLeads) * 100 : null;
      row.lostRate = row.cleanLeads > 0 ? (row.lost / row.cleanLeads) * 100 : null;
      row.answerRate =
        row.outboundCalls > 0 ? (row.answeredCalls / row.outboundCalls) * 100 : null;
      row.contactRate =
        row.newLeads > 0 ? (row.contactedLeads / row.newLeads) * 100 : null;
      row.decidedConversionRate =
        row.slaWon + row.slaLost > 0 ? (row.slaWon / (row.slaWon + row.slaLost)) * 100 : null;
      row.avgFirstCallMinutes =
        row.firstCallWeight > 0 ? row.firstCallWeighted / row.firstCallWeight : null;
      row.slaMonths = row.months.size;
      return row;
    })
    .sort((a, b) => b.paidRevenue - a.paidRevenue || b.cleanLeads - a.cleanLeads);

  const summary = agents.reduce(
    (acc, row) => {
      acc.paidRevenue += row.paidRevenue;
      acc.invoices += row.invoices;
      acc.cleanLeads += row.cleanLeads;
      acc.won += row.won;
      acc.lost += row.lost;
      acc.outboundCalls += row.outboundCalls;
      acc.answeredCalls += row.answeredCalls;
      return acc;
    },
    {
      agents: agents.length,
      paidRevenue: 0,
      invoices: 0,
      cleanLeads: 0,
      won: 0,
      lost: 0,
      conversionRate: null as number | null,
      outboundCalls: 0,
      answeredCalls: 0,
      answerRate: null as number | null,
    },
  );
  summary.conversionRate =
    summary.cleanLeads > 0 ? (summary.won / summary.cleanLeads) * 100 : null;
  summary.answerRate =
    summary.outboundCalls > 0 ? (summary.answeredCalls / summary.outboundCalls) * 100 : null;

  return { agents, summary, sla: slaStatus };
}
