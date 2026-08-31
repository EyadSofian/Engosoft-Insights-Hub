// Shared types (client + server-safe)

export type Platform = "meta" | "snapchat" | "tiktok" | "google";

/** A top-level acquisition filter. Organic has no ad-platform fact rows. */
export type AcquisitionChannel = Platform | "organic";

/** Why an ad account spends. Traffic/unknown accounts poison efficiency metrics. */
export type CampaignObjective = "leads" | "website_conversion" | "traffic" | "unknown";

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
  /** Accounting date used for filtering and trends. Payment Date is the default. */
  dateBasis?: "payment" | "invoice";
  /** Accounting invoice company. Other facts are left untouched when they lack this dimension. */
  company?: string;
  platform?: Platform;
  /** Source-based, non-paid acquisition channel from Odoo. */
  channel?: "organic";
  account?: string;
  campaign?: string;
  /** Stable internal campaign key used by table drill-down. */
  campaignKey?: string;
  adset?: string;
  /** Stable internal ad-set bucket key used by table drill-down. */
  adsetKey?: string;
  ad?: string;
  /** Stable internal ad bucket key used by table drill-down. */
  adKey?: string;
  source?: string;
  course?: string;
  mainCategory?: string;
  salesTeam?: string;
  salesperson?: string;
  /** "all" opts out of the default month-to-date range. */
  range?: "all";
  /** Include traffic/unknown ad accounts in efficiency denominators. */
  includeNonLead?: "1";
  /** CPA denominator: won leads (default) or distinct invoices. */
  cpaBasis?: "won" | "invoices";
  /** Local-currency units per 1 USD. Accounting-only business settings. */
  fxEgp?: string;
  fxSar?: string;
  /** Internal Lost view: marketing cohort by creation date, or operational closures. */
  lostDateBasis?: "creation" | "closed";
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
  /** Explicit reporting course supplied by an authoritative historical mapping. */
  courseHint?: string;
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
  phone: string;
  mobile: string;
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
  /** Always false in reportable CRM; Lost exists only in the archived population. */
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

/**
 * One paid Odoo invoice product line from the Accounting sheet.
 *
 * Paid invoices normally report by Payment Date. Customer credit notes report
 * by their reversal Invoice Date so a later cancellation reduces that month.
 * `movement` identifies the accounting document while every row retains the
 * product/category dimensions required by Accounting.
 */
export interface AccountingRow {
  /** Stable Odoo move-line id when the sync provides one. */
  id: string;
  /** Accounting move / invoice number (for example INVNT/2026/00001). */
  movement: string;
  /** Odoo account.move type. Customer cancellations are `out_refund`. */
  moveType: string;
  /** True for an Odoo customer credit note / RINV reversal. */
  isCreditNote: boolean;
  paymentDate: string;
  invoiceDate: string;
  orderRef: string;
  product: string;
  productCategory: string;
  mainCategory: string;
  productCode: string;
  /** Product quantity on this paid invoice line. */
  quantity: number;
  company: string;
  companyCurrency: string;
  country: string;
  /** Employee registration code from the accounting reference. */
  code: string;
  website: string;
  untaxedTotal: number;
  totalInCurrency: number;
  usdPaid: number;
  /** Historical imports keep the workbook's recognised USD and ignore UI FX overrides. */
  reportingUsdLocked: boolean;
  course: string;
  category: string;
  partner: string;
  salesperson: string;
  teamLeader: string;
  salesTeam: string;
  /** Backward-compatible numeric alias; new code should use `usdPaid`. */
  usdSales: number;
  currency: string;
  event: string;
  eventStage: string;
  month: string;

  /* --- attribution ---------------------------------------------------------
   * Accounting may carry campaign columns directly. For legacy workbooks only,
   * missing dimensions can be filled from the old order-attribution bridge. */
  campaignName: string;
  campaignId: string;
  campaignKey: string;
  adName: string;
  adId: string;
  adset: string;
  adsetOrigin: AdSetOrigin;
  /** Lead source carried over from the linked order's opportunity. */
  source: string;
  sourceKey: string;
  /** True when direct or compatibility attribution was found. */
  orderMatched: boolean;
}

/** @deprecated Use `AccountingRow`. Kept so downstream integrations can migrate. */
export type SalesRow = AccountingRow;

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
  /** Canonical source after Order-ID reconciliation. Blank legacy values are normalized to Odoo. */
  recordSource: string;
  revenueBasis: string;
  externalSheetPrice: number;
  externalCurrency: string;
  externalSalesSource: string;
  externalPhone: string;
  externalSourceDate: string;
  reconciliationStatus: string;
  /** Null when the currencies are not comparable. */
  priceDifference: number | null;
}

/** A confirmed lost lead from the archived CRM population (`active=false`, probability=0). */
export interface LostRow {
  id: string;
  contact: string;
  phone: string;
  mobile: string;
  campaignName: string;
  campaignId: string;
  campaignKey: string;
  adName: string;
  adId: string;
  adset: string;
  lossReason: string;
  course: string;
  mainCategory: string;
  salesTeam: string;
  salesperson: string;
  source: string;
  sourceKey: string;
  stage: string;
  createdAt: string;
  /** Odoo `date_closed`; used for the separate operational closure movement report. */
  closeDate: string;
}

/* --- aggregates ----------------------------------------------------------- */

/** A metric that can legitimately be "not measurable" renders `null`, never 0. */
export type Maybe = number | null;

export interface Totals {
  /* spend side */
  spend: number;
  spendMeta: number;
  spendSnap: number;
  spendTikTok: number;
  spendGoogle: number;
  /** Diagnostic slice of spend on traffic/unknown-objective accounts; it remains included in efficiency formulas. */
  nonLeadSpend: number;
  /** Spend used in management efficiency formulas. This is the full ad spend. */
  efficiencySpend: number;
  impressions: number;
  clicksAll: number;
  linkClicks: Maybe;
  ctrAll: Maybe;
  ctrLink: Maybe;
  cpm: Maybe;
  cpc: Maybe;
  /** Leads or conversions reported by the selected ad platforms. */
  platformLeads: Maybe;

  /* CRM side */
  /** Non-lost rows on the CRM Leads tab. CRM stage Lost is deliberately excluded. */
  crmLeads: number;
  /** Authoritative archived-lost population from Lost Analysis. */
  archivedLeads: number;
  /** Every lead: non-lost CRM rows + authoritative Lost Analysis rows. */
  totalLeads: number;
  leadsFromCampaign: number;
  leadsOther: number;
  won: number;
  /** Lost total from Lost Analysis only. */
  lost: number;
  /** Always zero: CRM-stage Lost never participates in reporting. */
  lostInCrm: number;
  /** Same authoritative count as `lost`. Kept for API compatibility. */
  lostArchived: number;
  /** @deprecated Authoritative Lost rows are already validated; always zero. */
  archivedWon: number;
  conversionRate: Maybe;
  lostRate: Maybe;
  avgCloseDays: Maybe;
  /** Number of leads the close-time average is computed over. */
  closeSample: number;

  /* money */
  /** Primary paid-invoice revenue from Accounting.USD Paid, filtered by Payment Date. */
  revenue: number;
  /** Same primary revenue, exposed explicitly for source transparency. */
  accountingRevenue: number;
  /** Fully invoiced sales-order revenue; secondary/advisory. */
  orderRevenue: number;
  /**
   * Approved revenue traceable to a campaign that actually spent in this window.
   * Comes from paid Accounting lines and their campaign dimensions.
   */
  attributedRevenue: number;
  /** The same measure computed on Full Invoiced Orders. Advisory/cross-check. */
  attributedOrderRevenue: number;
  /** Paid revenue with no direct or compatibility campaign attribution. */
  unmatchedRevenue: number;
  orders: number;
  /** Distinct order references on the advisory Full Invoiced Orders dataset. */
  invoicedOrders: number;
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
  /** Stable parent dimensions keep drill-down scoped when display names repeat. */
  campaignKey: string;
  campaignName: string;
  adsetKey: string;
  adsetName: string;
  adKey: string;
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
  /** Actionable CRM leads still in the pipeline (Won and junk/old-data stages excluded). */
  followUp: number;
  won: number;
  lost: number;
  /** Paid-invoice conversion: distinct Accounting invoices ÷ CRM leads. */
  invoiceConversionRate: Maybe;
  conversionRate: Maybe;
  lostRate: Maybe;
  revenue: number;
  /** Distinct paid accounting invoices attributed to this performance row. */
  invoices: number;
  /** Distinct fully invoiced sales orders attributed to this performance row. */
  salesOrders: number;
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

/**
 * What a currently-spending campaign has returned across its whole history.
 *
 * Spend answers "is this running now"; only the full history answers "has this
 * ever paid for itself", because a deal closes weeks after the click that
 * produced it.
 */
export interface CampaignLifetime {
  spend: number;
  platformLeads: Maybe;
  crmLeads: number;
  won: number;
  invoices: number;
  salesOrders: number;
  revenue: number;
  roas: Maybe;
  /** First and last day this campaign ever recorded spend under the active filters. */
  firstSpendDate: string;
  lastSpendDate: string;
}

export type CampaignDeliveryState = "active" | "paused" | "ended" | "unknown";
export type CampaignStateSource =
  "n8n_live" | "platform_direct" | "google_snapshot" | "daily_proxy";

export interface CampaignPlatformHealth {
  platform: Platform;
  ok: boolean;
  /** Platform switches that are enabled, before schedule/child checks. */
  enabled?: number;
  active: number;
  total: number;
  message: string;
  checkedAt: string;
}

/**
 * The platform's current operational truth, kept separate from historical ad
 * rows so a status snapshot can never inflate spend or move reporting dates.
 */
export interface CampaignOperationalState {
  platform: Platform;
  accountId: string;
  account: string;
  accountTimezone: string;
  campaignId: string;
  campaignKey: string;
  name: string;
  configuredStatus: string;
  effectiveStatus: string;
  servingStatus: string;
  statusReason: string;
  startTime: string;
  stopTime: string;
  updatedTime: string;
  activeAdsets: number;
  activeAds: number;
  spend24h: number;
  impressions24h: number;
  clicks24h: number;
  platformLeads24h: number | null;
  deliveryState: CampaignDeliveryState;
  checkedAt: string;
  source: CampaignStateSource;
}

/** Business result attributed to a currently eligible campaign inside the selected date filter. */
export interface CampaignPeriodSummary {
  spend: number;
  /** Reportable CRM rows only; archived Lost rows are deliberately excluded. */
  crmLeads: number;
  /** Authoritative archived Lost rows attributed to this campaign in the selected period. */
  lostArchived: number;
  won: number;
  invoices: number;
  salesOrders: number;
  revenue: number;
  roas: Maybe;
}

export interface CampaignActivity {
  /** Broadest window retained for older summary UI. */
  window: { from: string; to: string } | null;
  /** Dates contributing to the optional recent spend/lead context. */
  platformWindows: Partial<Record<Platform, { from: string; to: string }>>;
  /** Official platform status is the only source of truth for Active/Paused. */
  definition: "official_status";
  /** Where the freshest official operational state came from. */
  source: CampaignStateSource;
  generatedAt: string;
  platformHealth: CampaignPlatformHealth[];
  /** Current official state for every active campaign returned by the platforms. */
  delivery: Record<string, CampaignOperationalState>;
  /** Selected-period numbers, kept separate from whole-history outcomes. */
  period: Record<string, CampaignPeriodSummary>;
  rows: PerfRow[];
  best: PerfRow | null;
  worst: PerfRow | null;
  /** Material recent spend that produced no lead at all — leads arrive same day. */
  zeroResult: PerfRow[];
  /**
   * Material recent spend from a campaign that has never produced a Won, a paid
   * invoice, or a fully invoiced sales order across its whole history.
   *
   * Outcomes are deliberately not read from the 24-hour spend window. Sales
   * cycles here run for weeks, so a short window reported every healthy
   * campaign as failing — including the account's best performers.
   */
  atRisk: PerfRow[];
  /** Whole-history outcome for each campaign referenced above, keyed by PerfRow.key. */
  lifetime: Record<string, CampaignLifetime>;
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
  /** Always zero: active CRM stage text is never a Lost source. */
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
  /** Authoritative CRM source used for this snapshot. */
  crmAuthority: "google-sheet" | "odoo-direct" | "postgres-last-good" | "google-sheet-fallback";
  /** Archived Lost is fail-closed and falls back only to its PostgreSQL last-good copy. */
  lostAuthority: "odoo-direct" | "postgres-last-good" | "unavailable";
  /** Marketing Lost cohorts are filtered by Odoo lead creation date. */
  lostDateBasis: "creation_date" | "unavailable";
  /** Paid invoice-line source, with PostgreSQL retaining the last good Odoo read. */
  accountingAuthority:
    "odoo-direct" | "postgres-live" | "postgres-last-good" | "google-sheet-fallback";
  /**
   * Non-sensitive direct-Odoo diagnostics. PostgreSQL is the preferred audit
   * baseline; a partial or differently re-rated direct read cannot replace it.
   */
  accountingDirect: {
    attempted: boolean;
    accepted: boolean;
    reportCandidates: number;
    acceptedRows: number;
    acceptedMoves: number;
    missingPaymentDate: number;
    missingCurrencyRate: number;
    revenue: number;
    referenceRows: number;
    referenceMoves: number;
    referenceRevenue: number;
    rowRatio: number;
    moveRatio: number;
    revenueDelta: number;
    revenueTolerance: number;
    unresolvedFields: string[];
    error: string;
  };
  /** Direct-Odoo population guards, exposed so excluded rows are auditable. */
  crmExclusions: {
    candidates: number;
    accepted: number;
    unassigned: number;
    technicalIdentity: number;
    nonInternalUser: number;
    noEmployee: number;
    excludedStage: number;
    wrongType: number;
    missingLostReason: number;
  };
  /** The same audit counters for the authoritative archived-Lost population. */
  lostExclusions: {
    candidates: number;
    accepted: number;
    unassigned: number;
    technicalIdentity: number;
    nonInternalUser: number;
    noEmployee: number;
    excludedStage: number;
    wrongType: number;
    missingLostReason: number;
  };
  crmRows: number;
  invoicedRows: number;
  /** Rows received from the selected Accounting/Sales source before guards. */
  accountingSourceRows: number;
  /** @deprecated Credit notes are now included as negative reversal-month rows. */
  accountingRefundRowsExcluded: number;
  /** Customer credit-note product rows included in net revenue. */
  accountingCreditNoteRowsIncluded: number;
  /** Repeated invoice-product rows removed by stable id or full fingerprint. */
  accountingDuplicateRowsExcluded: number;
  accountingRows: number;
  /** @deprecated Compatibility alias for `accountingRows`. */
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
  accountingAdCoverage: number;
  /** @deprecated Compatibility alias for `accountingAdCoverage`. */
  invoicedAdCoverage: number;
  /** Share of invoice lines and revenue that carry a campaign. */
  revenueCampaignCoverage: number;
  revenueCampaignShare: number;
  attributedRevenueShare: number;
  campaignMatchRate: number;
  /** Leads whose source currently has no matching spend feed (UChat, referrals, …). */
  leadsWithoutSpendSource: number;
  unpricedSources: { label: string; count: number }[];
  /**
   * Ad platforms that produced CRM leads but have no connected spend feed.
   * Their cost is missing from every denominator, so CPL/CPA/ROAS/ACOS all read
   * better than reality until the tab exists. This must be loud, not implicit.
   */
  platformsWithoutSpendTab: { platform: string; leads: number }[];
  /**
   * Rows dropped from the lead population by the stage guard, per stage. A
   * non-empty `lost` entry means the upstream sync is shipping CRM rows that
   * belong to Lost Analysis — the dashboard is correct, the sheet is not.
   */
  excludedStages: { stage: string; rows: number }[];
  /** Share of paid revenue that found its sales order in Full Invoiced Orders. */
  salesOrderMatchRate: number;
  /** Share of paid revenue that reached a campaign through that join. */
  salesCampaignShare: number;
  closeSample: number;
  closeCoverage: number;
  invoicedMissingDate: number;
  crmMissingDate: number;
  accountingMissingDate: number;
  /** @deprecated Compatibility alias for `accountingMissingDate`. */
  salesMissingDate: number;
  /** Legitimate negative discount/adjustment product lines inside customer invoices. */
  negativeRevenueRows: number;
  /** Signed USD value of those discount/adjustment lines; credit notes are excluded earlier. */
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
  /** Availability is source-specific: historical accounting/ads can be compared even when CRM history is absent. */
  metricAvailability: Record<"spend" | "revenue" | "leads" | "won", boolean>;
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
