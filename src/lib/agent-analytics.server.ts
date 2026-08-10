import type { GlobalFilters, TeamAgg } from "./types";
import type { FilteredData } from "./metrics.server";
import { accountingReportingDate } from "./accounting-policy";
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
  outboundCalls: number | null;
  answeredCalls: number | null;
  answerRate: number | null;
  contactRate: number | null;
  talkSeconds: number | null;
  avgFirstCallMinutes: number | null;
  slaWon: number;
  slaLost: number;
  decidedConversionRate: number | null;
  operationalSales: number | null;
  operationalUntaxed: number | null;
  operationalDeals: number | null;
  quotations: number | null;
  pipeline: number | null;
  slaMonths: number;
}

export interface AgentAnalyticsResult {
  agents: AgentAnalyticsRow[];
  months: string[];
  selected: {
    from?: string;
    to?: string;
    dateBasis: "payment" | "invoice";
    company: string;
  };
  summary: {
    agents: number;
    paidRevenue: number;
    invoices: number;
    cleanLeads: number;
    won: number;
    lost: number;
    conversionRate: number | null;
    periodClosedWon: number;
    periodClosedLost: number;
    decidedConversionRate: number | null;
    outboundCalls: number | null;
    answeredCalls: number | null;
    answerRate: number | null;
  };
  sla: {
    ok: boolean;
    source: string;
    fetchedAt: string;
    error?: string;
    grain: "month";
    callsThrough: string;
    salesThrough: string;
    callsAvailable: boolean;
    salesAvailable: boolean;
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

function normalizedEquals(left: string | null | undefined, right: string | undefined): boolean {
  if (!right) return true;
  return normalizePersonName(left || "") === normalizePersonName(right);
}

function slaRowIncluded(
  row: { month: string; user_name?: string | null; team_name?: string | null },
  filters: GlobalFilters,
): boolean {
  if (!monthIncluded(row.month, filters)) return false;
  if (!normalizedEquals(row.user_name, filters.salesperson)) return false;
  if (!normalizedEquals(row.team_name, filters.salesTeam)) return false;
  return true;
}

function latestMetricMonth<T extends { month: string }>(
  rows: T[],
  hasMetric: (row: T) => boolean,
): string {
  return rows
    .filter(hasMetric)
    .map((row) => monthKey(row.month))
    .filter(Boolean)
    .sort()
    .at(-1) || "";
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
    if (!invoice.isCreditNote) row.invoiceRefs.add(invoice.movement);
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
    row.outboundCalls = (row.outboundCalls ?? 0) + num(source.outbound_calls);
    row.answeredCalls = (row.answeredCalls ?? 0) + num(source.answered_calls);
    row.talkSeconds = (row.talkSeconds ?? 0) + num(source.talk_sec);
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
    row.operationalSales = (row.operationalSales ?? 0) + num(source.achieved_total);
    row.operationalUntaxed = (row.operationalUntaxed ?? 0) + num(source.achieved_untaxed);
    row.operationalDeals = (row.operationalDeals ?? 0) + num(source.deals_count);
    row.quotations = (row.quotations ?? 0) + num(source.quotations_count);
    row.pipeline = (row.pipeline ?? 0) + num(source.pipeline_value);
    map.set(key, row);
  }
}

function dateIncluded(value: string, filters: GlobalFilters): boolean {
  if (!value) return false;
  if (filters.from && value < filters.from) return false;
  if (filters.to && value > filters.to) return false;
  return true;
}

/**
 * Operational closures are dated by their actual close date. This is separate
 * from marketing cohort conversion, where Won/Lost belongs to the lead's
 * creation month. Mixing the two was why an early month looked artificially
 * weak on the employee page.
 */
function mergeOperationalClosures(
  map: Map<string, MutableAgent>,
  data: FilteredData,
  filters: GlobalFilters,
) {
  const sourceKey = filters.source?.trim().toLocaleLowerCase("en") || "";
  const platformCampaigns = filters.platform
    ? new Set(
        data.snapshot.ads
          .filter((row) => row.platform === filters.platform)
          .map((row) => row.campaignKey),
      )
    : null;
  const commonMatch = (row: {
    campaignName: string;
    campaignKey: string;
    sourceKey: string;
    course: string;
    mainCategory: string;
    salesperson: string;
  }) => {
    if (filters.platform && !platformCampaigns?.has(row.campaignKey)) return false;
    if (filters.campaign && row.campaignName !== filters.campaign) return false;
    if (filters.campaignKey && row.campaignKey !== filters.campaignKey) return false;
    if (sourceKey && row.sourceKey !== sourceKey) return false;
    if (filters.course && row.course !== filters.course) return false;
    if (filters.mainCategory && row.mainCategory !== filters.mainCategory) return false;
    if (!normalizedEquals(row.salesperson, filters.salesperson)) return false;
    return true;
  };

  for (const lead of data.snapshot.crm) {
    if (!lead.isWon || !dateIncluded(lead.closedAt, filters) || !commonMatch(lead)) continue;
    if (
      filters.salesTeam &&
      !normalizedEquals(lead.salesTeam, filters.salesTeam) &&
      !normalizedEquals(lead.subTeam, filters.salesTeam)
    )
      continue;
    const key = normalizePersonName(lead.salesperson);
    if (!key) continue;
    const row = map.get(key) ?? blank(key, lead.salesperson);
    if (lead.salesTeam) row.teams.add(lead.salesTeam);
    row.slaWon += 1;
    map.set(key, row);
  }

  for (const lead of data.snapshot.lost) {
    if (!dateIncluded(lead.closeDate, filters) || !commonMatch(lead)) continue;
    if (filters.salesTeam && !normalizedEquals(lead.salesTeam, filters.salesTeam)) continue;
    const key = normalizePersonName(lead.salesperson);
    if (!key) continue;
    const row = map.get(key) ?? blank(key, lead.salesperson);
    if (lead.salesTeam) row.teams.add(lead.salesTeam);
    row.slaLost += 1;
    map.set(key, row);
  }
}

export async function buildAgentAnalytics(
  data: FilteredData,
  filters: GlobalFilters,
  teams: TeamAgg[],
): Promise<AgentAnalyticsResult> {
  const map = new Map<string, MutableAgent>();
  const availableMonths = new Set<string>();
  const dateBasis = filters.dateBasis === "invoice" ? "invoice" : "payment";
  for (const invoice of data.snapshot.accounting) {
    if (filters.company && invoice.company !== filters.company) continue;
    const date = accountingReportingDate(invoice, dateBasis);
    if (date) availableMonths.add(monthKey(date));
  }
  mergeMainPeople(map, teams);
  mergeInvoiceRefs(map, data);
  mergeOperationalClosures(map, data, filters);

  let slaStatus: AgentAnalyticsResult["sla"] = {
    ok: false,
    source: "Railway PostgreSQL · Yeastar",
    fetchedAt: "",
    grain: "month",
    callsThrough: "",
    salesThrough: "",
    callsAvailable: false,
    salesAvailable: false,
  };
  try {
    const snapshot = await Promise.race([
      getSlaSnapshot(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    if (!snapshot) {
      throw new Error(
        "Yeastar calls are still refreshing in Railway. Odoo accounting and CRM figures remain available.",
      );
    }
    for (const row of snapshot.repMonthly) if (row.month) availableMonths.add(monthKey(row.month));
    for (const row of snapshot.salesSummary)
      if (row.month) availableMonths.add(monthKey(row.month));
    const selectedRep = snapshot.repMonthly.filter((row) => slaRowIncluded(row, filters));
    const selectedSales = snapshot.salesSummary.filter((row) => slaRowIncluded(row, filters));
    const callsThrough = latestMetricMonth(
      snapshot.repMonthly,
      (row) => num(row.outbound_calls) > 0 || num(row.answered_calls) > 0 || num(row.talk_sec) > 0,
    );
    const salesThrough = latestMetricMonth(snapshot.salesSummary, () => true);
    const callsAvailable = selectedRep.some(
      (row) => num(row.outbound_calls) > 0 || num(row.answered_calls) > 0 || num(row.talk_sec) > 0,
    );
    const salesAvailable = selectedSales.length > 0;
    mergeSlaRep(map, selectedRep);
    mergeSlaSales(map, selectedSales);
    slaStatus = {
      ok: true,
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      grain: "month",
      callsThrough,
      salesThrough,
      callsAvailable,
      salesAvailable,
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
        (row.outboundCalls ?? 0) > 0
          ? ((row.answeredCalls ?? 0) / (row.outboundCalls ?? 1)) * 100
          : null;
      row.contactRate =
        row.newLeads > 0 ? (row.contactedLeads / row.newLeads) * 100 : null;
      row.decidedConversionRate =
        row.slaWon + row.slaLost > 0 ? (row.slaWon / (row.slaWon + row.slaLost)) * 100 : null;
      row.avgFirstCallMinutes =
        row.firstCallWeight > 0 ? row.firstCallWeighted / row.firstCallWeight : null;
      row.slaMonths = row.months.size;
      if (!slaStatus.callsAvailable) {
        row.outboundCalls = null;
        row.answeredCalls = null;
        row.talkSeconds = null;
      }
      if (!slaStatus.salesAvailable) {
        row.operationalSales = null;
        row.operationalUntaxed = null;
        row.operationalDeals = null;
        row.quotations = null;
        row.pipeline = null;
      }
      return row;
    })
    .filter(
      (row) =>
        row.paidRevenue !== 0 ||
        row.invoices > 0 ||
        row.cleanLeads > 0 ||
        row.won > 0 ||
        row.lost > 0 ||
        row.newLeads > 0 ||
        row.contactedLeads > 0 ||
        row.slaWon > 0 ||
        row.slaLost > 0 ||
        (row.outboundCalls ?? 0) > 0 ||
        (row.answeredCalls ?? 0) > 0 ||
        (row.operationalSales ?? 0) !== 0 ||
        (row.operationalDeals ?? 0) > 0,
    )
    .sort((a, b) => b.paidRevenue - a.paidRevenue || b.cleanLeads - a.cleanLeads);

  const summary = agents.reduce(
    (acc, row) => {
      acc.paidRevenue += row.paidRevenue;
      acc.invoices += row.invoices;
      acc.cleanLeads += row.cleanLeads;
      acc.won += row.won;
      acc.lost += row.lost;
      acc.periodClosedWon += row.slaWon;
      acc.periodClosedLost += row.slaLost;
      if (row.outboundCalls !== null) acc.outboundCalls = (acc.outboundCalls ?? 0) + row.outboundCalls;
      if (row.answeredCalls !== null) acc.answeredCalls = (acc.answeredCalls ?? 0) + row.answeredCalls;
      return acc;
    },
    {
      agents: agents.length,
      paidRevenue: 0,
      invoices: 0,
      cleanLeads: 0,
      won: 0,
      lost: 0,
      periodClosedWon: 0,
      periodClosedLost: 0,
      conversionRate: null as number | null,
      decidedConversionRate: null as number | null,
      outboundCalls: slaStatus.callsAvailable ? 0 : (null as number | null),
      answeredCalls: slaStatus.callsAvailable ? 0 : (null as number | null),
      answerRate: null as number | null,
    },
  );
  summary.conversionRate =
    summary.cleanLeads > 0 ? (summary.won / summary.cleanLeads) * 100 : null;
  summary.decidedConversionRate =
    summary.periodClosedWon + summary.periodClosedLost > 0
      ? (summary.periodClosedWon / (summary.periodClosedWon + summary.periodClosedLost)) * 100
      : null;
  summary.answerRate =
    (summary.outboundCalls ?? 0) > 0
      ? ((summary.answeredCalls ?? 0) / (summary.outboundCalls ?? 1)) * 100
      : null;

  return {
    agents,
    months: [...availableMonths].filter(Boolean).sort(),
    selected: {
      from: filters.from,
      to: filters.to,
      dateBasis,
      company: filters.company || "",
    },
    summary,
    sla: slaStatus,
  };
}
