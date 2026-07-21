// Shared types (client + server-safe)

export type Platform = "meta" | "snapchat";

/** Why an ad account spends. Traffic/unknown accounts poison efficiency metrics. */
export type CampaignObjective = "leads" | "traffic" | "unknown";

/** How an ad-set value was obtained for a CRM/invoice row. */
export type AdSetOrigin =
  /** Ad id matched an ad in the ads tabs — exact, one ad belongs to one ad set. */
  | "exact"
  /** Ad name matched a single ad set — safe. */
  | "derived"
  /** Ad name maps to several ad sets; the modal one was picked. Show a warning. */
  | "ambiguous"
  /** Row carries an ad but nothing in the ads tabs matches it. */
  | "unknown"
  /** Row carries no ad at all. */
  | "none";

export interface GlobalFilters {
  from?: string; // YYYY-MM-DD
  to?: string;
  platform?: Platform;
  account?: string;
  campaign?: string;
  adset?: string;
  ad?: string;
  source?: string;
  course?: string;
  mainCategory?: string;
  salesTeam?: string;
  salesperson?: string;
  /** "all" opts out of the default year-to-date range. */
  range?: "all";
  /** Include traffic/unknown ad accounts in efficiency denominators. */
  includeNonLead?: "1";
  /** CPA denominator: won leads (default) or distinct invoices. */
  cpaBasis?: "won" | "invoices";
}

export type DatePreset = "7d" | "30d" | "month" | "year" | "all";

/* --- normalized rows ------------------------------------------------------ */

/** One ad × day, from either platform. Unsupported metrics stay `null`. */
export interface AdRow {
  platform: Platform;
  date: string;
  account: string;
  accountId: string;
  objective: CampaignObjective;
  campaign: string;
  campaignId: string;
  campaignKey: string;
  adset: string;
  adsetId: string;
  ad: string;
  adId: string;
  spend: number;
  impressions: number;
  clicksAll: number;
  linkClicks: number | null;
  platformLeads: number | null;
  viewCompletions: number | null;
  syncedAt: string;
}

export interface CrmLeadRow {
  id: string;
  createdAt: string;
  closedAt: string;
  /** Days from creation to close. Only meaningful when `closedAt` is set. */
  daysToClose: number | null;
  campaignName: string;
  campaignId: string;
  campaignKey: string;
  adName: string;
  adId: string;
  adset: string;
  adsetOrigin: AdSetOrigin;
  contact: string;
  salesperson: string;
  /** Parent team, e.g. "Operation Team". */
  salesTeam: string;
  /** Sub-team, e.g. "Resale - Operation ( asmaa )". */
  subTeam: string;
  stage: string;
  cleanedStage: string;
  /** Last time the lead moved stage in Odoo; used as a conservative contact-age proxy. */
  lastStageUpdate: string;
  /** Raw Odoo "Calling reply?" value when that custom field is available. */
  callingReply: string;
  isWon: boolean;
  isLost: boolean;
  source: string;
  /** Case-normalized source key. `uchat` and `UChat` collapse to one. */
  sourceKey: string;
  course: string;
  mainCategory: string;
  priority: string;
  /** True when the lead carries a campaign name or id. */
  fromCampaign: boolean;
}

export interface InvoicedRow {
  orderRef: string;
  campaignName: string;
  campaignId: string;
  campaignKey: string;
  adName: string;
  adId: string;
  adset: string;
  adsetOrigin: AdSetOrigin;
  product: string;
  customer: string;
  course: string;
  mainCategory: string;
  salesTeam: string;
  salesperson: string;
  source: string;
  sourceKey: string;
  /** Displayed invoice date — populated on only ~8% of rows in the sheet. */
  invoiceDate: string;
  /**
   * The date this revenue is attributed to for all filtering and trending.
   * Sourced from the `Date` column (100% populated). Using `Invoice Date` alone
   * drops ~92% of revenue.
   */
  revenueDate: string;
  localTotal: number;
  usdSales: number;
}

export interface SalesRow {
  paymentDate: string;
  invoiceDate: string;
  orderRef: string;
  course: string;
  category: string;
  partner: string;
  salesperson: string;
  teamLeader: string;
  salesTeam: string;
  usdSales: number;
  currency: string;
  eventStage: string;
  month: string;
}

/** One confirmed Odoo website sales-order line (Website = Engosoft, state = sale). */
export interface WebsiteSaleRow {
  id: string;
  writeDate: string;
  orderRef: string;
  orderDate: string;
  website: string;
  status: string;
  customer: string;
  salesperson: string;
  salesTeam: string;
  currency: string;
  product: string;
  productCategory: string;
  course: string;
  mainCategory: string;
  quantity: number;
  untaxedTotal: number;
  localTotal: number;
  usdSales: number;
  opportunityId: string;
  opportunitySource: string;
  invoiceStatus: string;
  paymentDate: string;
}

/** A confirmed lost lead from the archived CRM population (`active=false`, probability=0). */
export interface LostRow {
  id: string;
  contact: string;
  campaignName: string;
  campaignId: string;
  campaignKey: string;
  adName: string;
  adId: string;
  lossReason: string;
  course: string;
  mainCategory: string;
  salesTeam: string;
  salesperson: string;
  source: string;
  sourceKey: string;
  stage: string;
  createdAt: string;
}

/* --- aggregates ----------------------------------------------------------- */

/** A metric that can legitimately be "not measurable" renders `null`, never 0. */
export type Maybe = number | null;

export interface Totals {
  /* spend side */
  spend: number;
  spendMeta: number;
  spendSnap: number;
  /** Spend on traffic/unknown-objective accounts, excluded from efficiency. */
  nonLeadSpend: number;
  /** Spend actually used as the efficiency denominator. */
  efficiencySpend: number;
  impressions: number;
  clicksAll: number;
  linkClicks: Maybe;
  ctrAll: Maybe;
  ctrLink: Maybe;
  cpm: Maybe;
  cpc: Maybe;
  /** Leads reported by the ad platform (Meta form leads or Snapchat native leads). */
  platformLeads: Maybe;

  /* CRM side */
  crmLeads: number;
  leadsFromCampaign: number;
  leadsOther: number;
  won: number;
  lost: number;
  conversionRate: Maybe;
  lostRate: Maybe;
  avgCloseDays: Maybe;
  /** Number of leads the close-time average is computed over. */
  closeSample: number;

  /* money */
  revenue: number;
  /** Revenue traceable to a campaign present in the ads tabs. */
  attributedRevenue: number;
  orders: number;
  avgOrder: Maybe;
  revenuePerLead: Maybe;

  /* efficiency */
  cpl: Maybe;
  /** Spend ÷ platform-reported leads. Distinct from the business CPL. */
  platformCpl: Maybe;
  /** Spend ÷ leads that actually carry a campaign. The honest paid CPL. */
  attributedCpl: Maybe;
  cpa: Maybe;
  cpaWon: Maybe;
  cpaInvoices: Maybe;
  roas: Maybe;
  attributedRoas: Maybe;
  acos: Maybe;
  attributedAcos: Maybe;
}

export type Deltas = Partial<Record<keyof Totals, number>>;

export interface ExecSummary {
  ar: string;
  en: string;
}

/** One row of the campaign / ad-set / ad table. Same shape at all three grains. */
export interface PerfRow {
  key: string;
  name: string;
  platforms: Platform[];
  course: string;
  courseInferred: boolean;
  /** Set on ad-set rows whose value came from a backfill. */
  adsetOrigin?: AdSetOrigin;
  objective: CampaignObjective;
  spend: number;
  impressions: number;
  clicksAll: number;
  linkClicks: Maybe;
  ctrAll: Maybe;
  ctrLink: Maybe;
  cpm: Maybe;
  cpc: Maybe;
  platformLeads: Maybe;
  crmLeads: number;
  won: number;
  lost: number;
  conversionRate: Maybe;
  lostRate: Maybe;
  revenue: number;
  revenuePerLead: Maybe;
  cpl: Maybe;
  cpa: Maybe;
  roas: Maybe;
  acos: Maybe;
  avgCloseDays: Maybe;
  closeSample: number;
  /** First and last day this row actually has spend data for. */
  spendDateMin: string;
  spendDateMax: string;
  /**
   * True when a material share of this row's revenue falls outside the days its
   * spend data covers. Snapchat, for example, only exports the last few days,
   * so a campaign that has run since January shows 5 days of cost against 7
   * months of revenue — an ROAS that looks spectacular and means nothing.
   * Rows flagged here are excluded from the best/worst spotlights.
   */
  partialSpend: boolean;
  /** Share of this row's revenue that falls inside its spend window, 0–1. */
  spendCoverage: Maybe;
}

export interface CourseAgg extends PerfRow {
  mainCategory: string;
  orders: number;
  avgOrder: Maybe;
  prevRevenue: number;
  revenueDelta: Maybe;
}

export interface TeamAgg {
  key: string;
  name: string;
  parent?: string;
  crmLeads: number;
  won: number;
  lost: number;
  conversionRate: Maybe;
  lostRate: Maybe;
  revenue: number;
  orders: number;
  avgOrder: Maybe;
  revenuePerLead: Maybe;
  avgCloseDays: Maybe;
  closeSample: number;
  people?: TeamAgg[];
}

export interface Grouped {
  label: string;
  value: number;
  count: number;
  /** Share of the grand total, 0–100. */
  share: number;
}

export interface LostBreakdown {
  byReason: Grouped[];
  byCourse: Grouped[];
  byMonth: Grouped[];
  byTeam: Grouped[];
  bySalesperson: Grouped[];
  bySource: Grouped[];
  byCampaign: Grouped[];
  /** reason × team and reason × course, values are counts. */
  reasonByTeam: Matrix;
  reasonByCourse: Matrix;
  total: number;
  /** CRM rows at stage Lost — a different population from the Lost tab. */
  crmLostCount: number;
}

export interface Matrix {
  rows: string[];
  cols: string[];
  /** cells[rowIndex][colIndex] */
  cells: number[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
}

export interface FunnelStep {
  key: string;
  value: Maybe;
  /** Explains why a step can exceed the one above it. */
  note?: string;
}

export interface DataHealth {
  crmRows: number;
  invoicedRows: number;
  salesRows: number;
  lostRows: number;
  adRows: number;
  /** Ad-set backfill. */
  adsetExact: number;
  adsetDerived: number;
  adsetAmbiguous: number;
  adsetUnknown: number;
  adsetNoAd: number;
  adsetResolutionRate: number;
  /** Share of CRM rows carrying an ad name/id at all. */
  crmAdCoverage: number;
  invoicedAdCoverage: number;
  /** Share of invoice lines and revenue that carry a campaign. */
  revenueCampaignCoverage: number;
  revenueCampaignShare: number;
  attributedRevenueShare: number;
  campaignMatchRate: number;
  /** Leads whose source has no spend tab in the sheet (TikTok, UChat, …). */
  leadsWithoutSpendSource: number;
  unpricedSources: { label: string; count: number }[];
  closeSample: number;
  closeCoverage: number;
  invoicedMissingDate: number;
  crmMissingDate: number;
  salesMissingDate: number;
  negativeRevenueRows: number;
  negativeRevenue: number;
}

export interface YoyPoint {
  key: string;
  current: number;
  previous: number;
  delta: number;
  growth: Maybe;
}

export interface YoyResult {
  available: boolean;
  currentYear: number;
  previousYear: number;
  reason?: string;
  spend: YoyPoint[];
  revenue: YoyPoint[];
  leads: YoyPoint[];
  won: YoyPoint[];
  byCourse: (YoyPoint & { metric: string })[];
  ytd: { metric: string; current: number; previous: number; growth: Maybe }[];
}
