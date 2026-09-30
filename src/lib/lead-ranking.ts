import type { AccountingRow, CrmLeadRow, LostRow } from "./types";
import { canonicalCourseValue, UNATTRIBUTED_COURSE } from "./course-taxonomy.ts";
import { accountingReportingDate } from "./accounting-policy.ts";
import { normalizePersonName } from "./person-name.ts";
import { detectVariant } from "./product-taxonomy.ts";

export const LEAD_RANKING_WEIGHTS = { revenue: 50, invoices: 25, conversion: 25 } as const;

export function nextDistributionMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}

export function leadRankingWindow(month: string) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    Number(month.slice(0, 4)) < 2000 ||
    Number(month.slice(0, 4)) > 2100
  ) {
    throw new Error("Month must be YYYY-MM between 2000 and 2100.");
  }
  const [year, value] = month.split("-").map(Number);
  return {
    month,
    from: new Date(Date.UTC(year, value - 7, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, value - 1, 0)).toISOString().slice(0, 10),
  };
}

export interface LeadRankingRow {
  key: string;
  name: string;
  teams: string[];
  revenue: number;
  invoices: number;
  leads: number;
  won: number;
  undatedWon: number;
  missingInvoiceIds: number;
  conversionRate: number | null;
  components: { revenue: number; invoices: number; conversion: number };
  score: number | null;
  rank: number | null;
}

export interface LeadRankingGroup {
  key: string;
  specialization: string;
  course: string | null;
  rows: LeadRankingRow[];
}

export type RankingCrmLead = Pick<
  CrmLeadRow,
  | "id"
  | "salesperson"
  | "salesTeam"
  | "course"
  | "courses"
  | "createdAt"
  | "wonDate"
  | "closedAt"
  | "isWon"
>;
export type RankingLostLead = Pick<
  LostRow,
  "id" | "salesperson" | "salesTeam" | "course" | "courses" | "createdAt"
>;
export type RankingInvoice = Pick<
  AccountingRow,
  | "id"
  | "salesperson"
  | "salesTeam"
  | "course"
  | "product"
  | "company"
  | "usdPaid"
  | "movement"
  | "isCreditNote"
  | "paymentDate"
  | "invoiceDate"
> & { productCategory?: string };
type Lead = RankingCrmLead | RankingLostLead;
type Identity = (name: string) => { key: string; name: string };
interface Bucket {
  row: LeadRankingRow;
  invoiceIds: Set<string>;
  leadIds: Set<string>;
  teams: Set<string>;
}

const productKey = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
const validSpecialization = (value: string) =>
  /[\p{L}\p{N}]/u.test(value) && value !== UNATTRIBUTED_COURSE;
const courseProduct = (sale: RankingInvoice) => {
  const variant = detectVariant(
    sale.product.replace(/^\s*\[\d+\]\s*/, ""),
    sale.productCategory ?? "",
  );
  return sale.product.trim() !== "" && variant !== "discount" && variant !== "fee";
};
const inWindow = (value: string, from: string, to: string) => {
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= from && date <= to;
};

/** All benchmarks use the whole peer group; UI search never changes a score. */
export function buildLeadRankings(input: {
  month: string;
  crm: RankingCrmLead[];
  lost: RankingLostLead[];
  accounting: RankingInvoice[];
  conversionAvailable?: boolean;
  identity?: Identity;
}) {
  const window = leadRankingWindow(input.month);
  const identity: Identity =
    input.identity ?? ((name) => ({ key: normalizePersonName(name), name: name.trim() }));
  const groups = new Map<
    string,
    { specialization: string; course: string | null; people: Map<string, Bucket> }
  >();
  const diagnostics = {
    unassignedLeads: 0,
    unclassifiedLeads: 0,
    unassignedRevenue: 0,
    unclassifiedRevenue: 0,
    missingInvoiceIds: 0,
    missingLeadIds: 0,
    unmatchedCourseLeads: 0,
  };
  // Exact product labels only. Courses is a comma-separated display field, so
  // match full catalogue labels at list boundaries instead of splitting names
  // containing commas or guessing that a specialty-level lead chose a product.
  const products = new Map<string, Map<string, string>>();
  for (const sale of input.accounting) {
    const spec = canonicalCourseValue(sale.course);
    if (!validSpecialization(spec) || !courseProduct(sale)) continue;
    const catalogue = products.get(spec) ?? new Map<string, string>();
    catalogue.set(productKey(sale.product), sale.product.trim());
    products.set(spec, catalogue);
  }
  const at = (
    spec: string,
    course: string | null,
    person: { key: string; name: string },
    team: string,
  ) => {
    const key = JSON.stringify([spec, course === null ? null : productKey(course)]);
    let group = groups.get(key);
    if (!group) {
      group = { specialization: spec, course, people: new Map() };
      groups.set(key, group);
    }
    let bucket = group.people.get(person.key);
    if (!bucket) {
      bucket = {
        row: {
          key: person.key,
          name: person.name,
          teams: [],
          revenue: 0,
          invoices: 0,
          leads: 0,
          won: 0,
          undatedWon: 0,
          missingInvoiceIds: 0,
          conversionRate: null,
          components: { revenue: 0, invoices: 0, conversion: 0 },
          score: null,
          rank: null,
        },
        invoiceIds: new Set(),
        leadIds: new Set(),
        teams: new Set(),
      };
      group.people.set(person.key, bucket);
    }
    if (team) bucket.teams.add(team);
    return bucket;
  };
  const addLead = (bucket: Bucket, lead: Lead) => {
    if (bucket.leadIds.has(lead.id)) return;
    bucket.leadIds.add(lead.id);
    bucket.row.leads++;
    if ("isWon" in lead && lead.isWon) {
      const wonDate = lead.wonDate || lead.closedAt;
      if (!wonDate) bucket.row.undatedWon++;
      else if (inWindow(wonDate, window.from, window.to)) bucket.row.won++;
    }
  };
  // Canonical Lost wins if a stale source also carries the same CRM id.
  const seen = new Set<string>();
  for (const lead of [...input.lost, ...input.crm]) {
    if (!inWindow(lead.createdAt, window.from, window.to)) continue;
    if (!lead.id) {
      diagnostics.missingLeadIds++;
      continue;
    }
    if (seen.has(lead.id)) continue;
    seen.add(lead.id);
    const person = identity(lead.salesperson);
    const spec = canonicalCourseValue(lead.course);
    if (!person.key || lead.salesperson.trim() === "—") {
      diagnostics.unassignedLeads++;
      continue;
    }
    if (!validSpecialization(spec)) {
      diagnostics.unclassifiedLeads++;
      continue;
    }
    addLead(at(spec, null, person, lead.salesTeam), lead);
    const list = productKey(lead.courses);
    let matches = 0;
    for (const [key, label] of products.get(spec) ?? []) {
      if (list === key || `, ${list}, `.includes(`, ${key}, `)) {
        addLead(at(spec, label, person, lead.salesTeam), lead);
        matches++;
      }
    }
    if (!matches) diagnostics.unmatchedCourseLeads++;
  }
  const seenLines = new Set<string>();
  for (const sale of input.accounting) {
    if (!inWindow(accountingReportingDate(sale, "payment"), window.from, window.to)) continue;
    if (sale.id && seenLines.has(sale.id)) continue;
    if (sale.id) seenLines.add(sale.id);
    const person = identity(sale.salesperson);
    const spec = canonicalCourseValue(sale.course);
    if (!person.key || sale.salesperson.trim() === "—") {
      diagnostics.unassignedRevenue += sale.usdPaid;
      continue;
    }
    if (!validSpecialization(spec)) {
      diagnostics.unclassifiedRevenue += sale.usdPaid;
      continue;
    }
    if (!sale.isCreditNote && !sale.movement) diagnostics.missingInvoiceIds++;
    for (const course of [
      null,
      ...(courseProduct(sale) ? [products.get(spec)!.get(productKey(sale.product))!] : []),
    ]) {
      const bucket = at(spec, course, person, sale.salesTeam);
      bucket.row.revenue += Number.isFinite(sale.usdPaid) ? sale.usdPaid : 0;
      if (!sale.isCreditNote && !sale.movement) bucket.row.missingInvoiceIds++;
      if (!sale.isCreditNote && sale.movement)
        bucket.invoiceIds.add(JSON.stringify([sale.company, sale.movement]));
    }
  }
  const rankings: LeadRankingGroup[] = [];
  for (const [key, group] of groups) {
    const rows = [...group.people.values()].map((bucket) => {
      const row = bucket.row;
      row.invoices = bucket.invoiceIds.size;
      row.teams = [...bucket.teams].sort();
      row.conversionRate =
        input.conversionAvailable !== false &&
        diagnostics.missingLeadIds === 0 &&
        row.leads > 0 &&
        row.undatedWon === 0
          ? (row.won / row.leads) * 100
          : null;
      return row;
    });
    const maxima = {
      revenue: Math.max(0, ...rows.map((r) => r.revenue)),
      invoices: Math.max(0, ...rows.map((r) => r.invoices)),
      conversion: Math.max(0, ...rows.map((r) => r.conversionRate ?? 0)),
    };
    for (const row of rows) {
      row.components = {
        revenue: maxima.revenue > 0 ? (Math.max(0, row.revenue) / maxima.revenue) * 50 : 0,
        invoices: maxima.invoices > 0 ? (row.invoices / maxima.invoices) * 25 : 0,
        conversion:
          maxima.conversion > 0 ? ((row.conversionRate ?? 0) / maxima.conversion) * 25 : 0,
      };
      row.score =
        row.conversionRate === null || row.missingInvoiceIds > 0 || diagnostics.missingLeadIds > 0
          ? null
          : row.components.revenue + row.components.invoices + row.components.conversion;
    }
    rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
    let rank = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].score === null) continue;
      if (i === 0 || Math.abs(rows[i].score! - rows[i - 1].score!) > 1e-9) rank = i + 1;
      rows[i].rank = rank;
    }
    rankings.push({ key, specialization: group.specialization, course: group.course, rows });
  }
  rankings.sort(
    (a, b) =>
      a.specialization.localeCompare(b.specialization) ||
      (a.course ?? "").localeCompare(b.course ?? ""),
  );
  const expectedMonths = Array.from({ length: 6 }, (_, index) => {
    const from = new Date(`${window.from}T00:00:00Z`);
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + index, 1))
      .toISOString()
      .slice(0, 7);
  });
  const leadMonths = new Set(
    [...input.crm, ...input.lost]
      .filter((lead) => inWindow(lead.createdAt, window.from, window.to))
      .map((lead) => lead.createdAt.slice(0, 7)),
  );
  const invoiceMonths = new Set(
    input.accounting
      .map((row) => accountingReportingDate(row, "payment"))
      .filter((date) => inWindow(date, window.from, window.to))
      .map((date) => date.slice(0, 7)),
  );
  const coverage = {
    expectedMonths,
    monthsWithoutLeads: expectedMonths.filter((month) => !leadMonths.has(month)),
    monthsWithoutInvoices: expectedMonths.filter((month) => !invoiceMonths.has(month)),
  };
  return { window, weights: LEAD_RANKING_WEIGHTS, groups: rankings, diagnostics, coverage };
}

export type LeadRankingResult = ReturnType<typeof buildLeadRankings>;
