// Shared types (client + server-safe)

export interface GlobalFilters {
  from?: string; // YYYY-MM-DD
  to?: string;
  account?: string;
  campaign?: string;
  source?: string;
  mainCategory?: string;
  salesTeam?: string;
  /** "all" opts out of the default Meta-window range. */
  range?: "all";
}

export type DatePreset = "meta" | "7d" | "30d" | "90d" | "month" | "all";

export interface MetaRow {
  date: string; // ISO
  account: string;
  campaign: string;
  campaignId: string;
  adsetName: string;
  adName: string;
  spend: number;
  impressions: number;
  linkClicks: number;
  clicksAll: number;
  metaLeads: number;
  syncedAt: string;
}

export interface CrmLeadRow {
  createdAt: string;
  campaignName: string;
  campaignId: string;
  adName: string;
  contact: string;
  salesperson: string;
  salesTeam: string;
  stage: string;
  cleanedStage: string;
  source: string;
  cleanedSource: string;
  course: string;
  mainCategory: string;
  priority: string;
  month: string;
  orderTotal: number;
}

export interface InvoicedRow {
  orderRef: string;
  campaignName: string;
  campaignId: string;
  adName: string;
  product: string;
  customer: string;
  course: string;
  mainCategory: string;
  salesTeam: string;
  salesperson: string;
  source: string;
  cleanedSource: string;
  /** Displayed invoice date. Only ~7% of rows have this populated in the sheet. */
  invoiceDate: string;
  /**
   * The date this revenue is attributed to for all filtering/trending.
   * Sourced from the sheet's `Date` column (100% populated) and falls back to
   * `Invoice Date`. Using `Invoice Date` alone drops ~93% of revenue.
   */
  revenueDate: string;
  month: string;
  localTotal: number;
  usdSales: number;
}

export interface SalesRow {
  paymentDate: string;
  invoiceDate: string;
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

export interface LostRow {
  campaignName: string;
  lossReason: string;
  course: string;
  mainCategory: string;
  salesTeam: string;
  cleanedSource: string;
  month: string;
  createdAt: string;
}

export interface CampaignAgg {
  campaign: string;
  campaignId: string;
  spend: number;
  impressions: number;
  clicksAll: number;
  linkClicks: number;
  ctrAll: number;
  ctrLink: number;
  cpm: number;
  cpc: number;
  metaLeads: number;
  crmLeads: number;
  won: number;
  revenue: number;
  cpl: number;
  cac: number;
  roas: number;
  winRate: number;
  topAd?: { name: string; spend: number };
}

/* --- aggregate shapes shared by the server compute layer and the UI ------ */

export interface Totals {
  spend: number;
  impressions: number;
  clicksAll: number;
  linkClicks: number;
  ctrAll: number;
  ctrLink: number;
  cpm: number;
  cpc: number;
  metaLeads: number;
  crmLeads: number;
  won: number;
  winRate: number;
  revenue: number;
  /** Revenue that maps to a Meta campaign — the only revenue ROAS can claim. */
  attributedRevenue: number;
  cpl: number;
  cac: number;
  roas: number;
  /** ROAS computed on attributed revenue only. The honest number. */
  attributedRoas: number;
  orders: number;
  avgOrder: number;
}

export type Deltas = Partial<Record<keyof Totals, number>>;

export interface ExecSummary {
  ar: string;
  en: string;
}

export interface CourseAgg {
  course: string;
  mainCategory: string;
  revenue: number;
  prevRevenue: number;
  revenueDelta: number;
  orders: number;
  avgOrder: number;
  leads: number;
  won: number;
  winRate: number;
  spend: number;
  roas: number;
  cpl: number;
}

export interface AdAgg {
  ad: string;
  spend: number;
  impressions: number;
  clicksAll: number;
  ctrAll: number;
  metaLeads: number;
  cpl: number;
}

export interface AdSetAgg {
  adset: string;
  spend: number;
  impressions: number;
  clicksAll: number;
  ctrAll: number;
  metaLeads: number;
  cpl: number;
  ads: AdAgg[];
}

export interface Grouped {
  label: string;
  value: number;
  count: number;
}
