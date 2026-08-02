import { normalizeName, normalizeSource } from "./sheet-cache.server";
import { archivedCrmLeads, computeTotals, div, type FilteredData } from "./metrics.server";
import type { CrmLeadRow, GlobalFilters, Platform } from "./types";

export interface SalesAttributionRow {
  key: string;
  name: string;
  leads: number;
  interested: number;
  quotations: number;
  won: number;
  lost: number;
  salesOrders: number;
  invoices: number;
  revenue: number;
  leadToWonRate: number | null;
  leadToInvoiceRate: number | null;
}

export interface SalesCampaignRow extends SalesAttributionRow {
  platforms: Platform[];
  spend: number;
  roas: number | null;
}

interface MutableBucket {
  key: string;
  name: string;
  platforms: Set<Platform>;
  leads: number;
  interested: number;
  quotations: number;
  won: number;
  lost: number;
  salesOrders: Set<string>;
  invoices: Set<string>;
  revenue: number;
  spend: number;
}

const UNKNOWN_KEY = "__unattributed__";

const stageKey = (value: string): string =>
  normalizeName(value)
    .replace(/[_–—/\\().?:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * CRM stores the current stage rather than a complete stage-transition history.
 * These predicates therefore count a lead at a stage or a clearly later stage,
 * producing a useful snapshot without pretending we have event history.
 */
function reachedInterest(row: CrmLeadRow): boolean {
  const stage = stageKey(row.cleanedStage || row.stage);
  return (
    row.isWon ||
    stage === "interested" ||
    stage === "save interest" ||
    stage === "quotation" ||
    stage === "technical proposal"
  );
}

function reachedQuotation(row: CrmLeadRow): boolean {
  const stage = stageKey(row.cleanedStage || row.stage);
  return row.isWon || stage === "quotation" || stage === "technical proposal";
}

function blankBucket(key: string, name: string): MutableBucket {
  return {
    key,
    name,
    platforms: new Set(),
    leads: 0,
    interested: 0,
    quotations: 0,
    won: 0,
    lost: 0,
    salesOrders: new Set(),
    invoices: new Set(),
    revenue: 0,
    spend: 0,
  };
}

function at(map: Map<string, MutableBucket>, key: string, name: string): MutableBucket {
  const safeKey = key || UNKNOWN_KEY;
  let bucket = map.get(safeKey);
  if (!bucket) {
    bucket = blankBucket(safeKey, name || "—");
    map.set(safeKey, bucket);
  } else if ((bucket.name === "—" || !bucket.name) && name) {
    bucket.name = name;
  }
  return bucket;
}

function finalizeSource(bucket: MutableBucket): SalesAttributionRow {
  return {
    key: bucket.key,
    name: bucket.name,
    leads: bucket.leads,
    interested: bucket.interested,
    quotations: bucket.quotations,
    won: bucket.won,
    lost: bucket.lost,
    salesOrders: bucket.salesOrders.size,
    invoices: bucket.invoices.size,
    revenue: bucket.revenue,
    leadToWonRate: (() => {
      const rate = div(bucket.won, bucket.leads);
      return rate === null ? null : rate * 100;
    })(),
    leadToInvoiceRate: (() => {
      const rate = div(bucket.invoices.size, bucket.leads);
      return rate === null ? null : rate * 100;
    })(),
  };
}

function sourceIdentity(
  sourceKey: string,
  source: string,
  labels: Map<string, string>,
): { key: string; name: string } {
  const key = sourceKey || normalizeSource(source) || UNKNOWN_KEY;
  return { key, name: labels.get(key) || source || "—" };
}

function campaignIdentity(
  campaignKey: string,
  campaignName: string,
): { key: string; name: string } {
  const key = campaignKey || normalizeName(campaignName) || UNKNOWN_KEY;
  return { key, name: campaignName || "—" };
}

function recordLead(bucket: MutableBucket, row: CrmLeadRow) {
  bucket.leads += 1;
  if (reachedInterest(row)) bucket.interested += 1;
  if (reachedQuotation(row)) bucket.quotations += 1;
  if (row.isWon) bucket.won += 1;
}

function bestByRevenue<T extends SalesAttributionRow>(rows: T[]): T | null {
  const attributed = rows.filter(
    (row) => row.key !== UNKNOWN_KEY && (row.revenue > 0 || row.invoices > 0),
  );
  const eligible = attributed.length
    ? attributed
    : rows.filter((row) => row.key !== UNKNOWN_KEY && row.won > 0);
  return (
    eligible.sort((a, b) => b.revenue - a.revenue || b.invoices - a.invoices || b.won - a.won)[0] ??
    null
  );
}

function bestByConversion<T extends SalesAttributionRow>(rows: T[]): T | null {
  return (
    rows
      .filter((row) => row.key !== UNKNOWN_KEY && row.leads >= 20 && row.leadToWonRate !== null)
      .sort(
        (a, b) =>
          (b.leadToWonRate ?? 0) - (a.leadToWonRate ?? 0) || b.won - a.won || b.leads - a.leads,
      )[0] ?? null
  );
}

export function buildSalesFunnel(data: FilteredData, filters: GlobalFilters) {
  const totals = computeTotals(data);
  const labels = data.snapshot.sourceLabels;
  const sourceBuckets = new Map<string, MutableBucket>();
  const campaignBuckets = new Map<string, MutableBucket>();

  for (const ad of data.ads) {
    const identity = campaignIdentity(ad.campaignKey, ad.campaign);
    const bucket = at(campaignBuckets, identity.key, identity.name);
    bucket.platforms.add(ad.platform);
    bucket.spend += ad.spend;
  }

  for (const lead of data.crm) {
    const source = sourceIdentity(lead.sourceKey, lead.source, labels);
    recordLead(at(sourceBuckets, source.key, source.name), lead);

    const campaign = campaignIdentity(lead.campaignKey, lead.campaignName);
    recordLead(at(campaignBuckets, campaign.key, campaign.name), lead);
  }

  for (const lead of archivedCrmLeads(data)) {
    const source = sourceIdentity(lead.sourceKey, lead.source, labels);
    const sourceBucket = at(sourceBuckets, source.key, source.name);
    sourceBucket.leads += 1;
    if (stageKey(lead.stage) !== "won") sourceBucket.lost += 1;

    const campaign = campaignIdentity(lead.campaignKey, lead.campaignName);
    const campaignBucket = at(campaignBuckets, campaign.key, campaign.name);
    campaignBucket.leads += 1;
    if (stageKey(lead.stage) !== "won") campaignBucket.lost += 1;
  }

  for (const order of data.invoiced) {
    if (!order.orderRef) continue;
    const source = sourceIdentity(order.sourceKey, order.source, labels);
    at(sourceBuckets, source.key, source.name).salesOrders.add(order.orderRef);

    const campaign = campaignIdentity(order.campaignKey, order.campaignName);
    at(campaignBuckets, campaign.key, campaign.name).salesOrders.add(order.orderRef);
  }

  for (const invoice of data.accounting) {
    const source = sourceIdentity(invoice.sourceKey, invoice.source, labels);
    const sourceBucket = at(sourceBuckets, source.key, source.name);
    sourceBucket.revenue += invoice.usdPaid;
    if (invoice.movement && !invoice.isCreditNote) sourceBucket.invoices.add(invoice.movement);

    const campaign = campaignIdentity(invoice.campaignKey, invoice.campaignName);
    const campaignBucket = at(campaignBuckets, campaign.key, campaign.name);
    campaignBucket.revenue += invoice.usdPaid;
    if (invoice.movement && !invoice.isCreditNote) campaignBucket.invoices.add(invoice.movement);
  }

  const interested = data.crm.filter(reachedInterest).length;
  const quotations = data.crm.filter(reachedQuotation).length;
  const sources = [...sourceBuckets.values()]
    .map(finalizeSource)
    .sort(
      (a, b) =>
        b.revenue - a.revenue || b.invoices - a.invoices || b.won - a.won || b.leads - a.leads,
    );
  const campaigns: SalesCampaignRow[] = [...campaignBuckets.values()]
    .map((bucket) => ({
      ...finalizeSource(bucket),
      platforms: [...bucket.platforms].sort(),
      spend: bucket.spend,
      roas: div(bucket.revenue, bucket.spend),
    }))
    .sort(
      (a, b) =>
        b.revenue - a.revenue || b.invoices - a.invoices || b.won - a.won || b.spend - a.spend,
    );

  return {
    funnel: {
      leads: totals.totalLeads,
      interested,
      quotations,
      won: totals.won,
      salesOrders: totals.invoicedOrders,
      invoices: totals.orders,
    },
    totals: {
      revenue: totals.revenue,
      averageInvoice: totals.avgOrder,
      attributedRevenue: totals.attributedRevenue,
      unmatchedRevenue: totals.unmatchedRevenue,
    },
    sources,
    campaigns,
    insights: {
      bestSellingSource: bestByRevenue(sources),
      bestConvertingSource: bestByConversion(sources),
      bestSellingCampaign: bestByRevenue(campaigns),
      bestConvertingCampaign: bestByConversion(campaigns),
    },
    definitions: {
      stageBasis: "current_stage_or_clearly_later",
      salesOrderBasis: "distinct_full_invoiced_order_ref",
      invoiceBasis: "distinct_paid_accounting_movement",
      revenueBasis: "paid_accounting_usd",
      dateBasis: filters.dateBasis === "invoice" ? "invoice" : "payment",
    },
  };
}
