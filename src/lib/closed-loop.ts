/**
 * Closed-loop marketing → sales identity rules.
 *
 * Marketing owns acquisition identity (which campaign, ad set, ad and creative
 * produced an acquisition, proven by provider IDs). The CRM owns lifecycle
 * (interest, quotation, won, lost) and Odoo sales own orders, invoices and paid
 * revenue. This module joins them without ever using a name as an identity and
 * without guessing: every link records how it was made and how strong it is.
 *
 * Everything here is pure so the rules are tested once and the server only
 * loads rows.
 */

export type AttributionConfidence = "exact" | "declared" | "inferred" | "unknown";
export type MatchConfidence = "exact" | "strong" | "inferred";
export type MatchMethod =
  /** The acquisition's provider lead ID equals the CRM record's Facebook Lead ID. */
  | "provider_lead_id"
  /** The CRM record is the lead that carries the provider lead ID itself. */
  | "crm_carried_provider_lead_id"
  /** Existing Chatwoot projector relation: equal normalized phone key (last 9 digits). */
  | "chatwoot_phone_key";

/* --- Meta hierarchy ------------------------------------------------------ */

export interface MetaAdEntity {
  adId: string;
  adName: string;
  accountId: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  creativeId: string;
  creativeName: string;
}

export interface MetaHierarchy {
  accountId: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  creativeId: string;
  creativeName: string;
  /** True only when the ad ID was found in the synced Meta catalog. */
  resolved: boolean;
}

const clean = (value: unknown): string => (value == null ? "" : String(value).trim());

/**
 * The canonical Account → Campaign → Ad Set → Ad → Creative chain for an ad ID.
 * The synced Meta catalog is the authority; a record's own campaign text is
 * never used to fill a level the catalog does not prove.
 */
export function resolveMetaHierarchy(
  adId: string,
  catalog: ReadonlyMap<string, MetaAdEntity>,
): MetaHierarchy {
  const id = clean(adId);
  const entity = id ? catalog.get(id) : undefined;
  if (!entity) {
    return {
      accountId: "",
      campaignId: "",
      campaignName: "",
      adsetId: "",
      adsetName: "",
      adId: id,
      adName: "",
      creativeId: "",
      creativeName: "",
      resolved: false,
    };
  }
  return {
    accountId: entity.accountId,
    campaignId: entity.campaignId,
    campaignName: entity.campaignId ? entity.campaignName : "",
    adsetId: entity.adsetId,
    adsetName: entity.adsetId ? entity.adsetName : "",
    adId: entity.adId,
    adName: entity.adName,
    creativeId: entity.creativeId,
    creativeName: entity.creativeId ? entity.creativeName : "",
    resolved: true,
  };
}

/**
 * Confidence for a lead that carries Meta identifiers. Exact needs a provider
 * lead ID and an ad ID that the Meta catalog resolves; an ID the catalog cannot
 * resolve was declared by whoever wrote it; nothing at all is unknown.
 */
export function metaLeadConfidence(input: {
  providerLeadId: string;
  adId: string;
  campaignId: string;
  resolved: boolean;
}): AttributionConfidence {
  if (clean(input.providerLeadId) && clean(input.adId) && input.resolved) return "exact";
  if (clean(input.adId) || clean(input.campaignId)) return "declared";
  return "unknown";
}

/* --- Assets --------------------------------------------------------------- */

export interface CreativeMedia {
  creativeId: string;
  adId: string;
  videoId: string;
  imageHash: string;
  imageUrl: string;
  thumbnailUrl: string;
  /** Extra assets from `asset_feed_spec`, when the sync stored them. */
  feedAssets?: { type: "video" | "image"; id: string; url?: string; thumbnailUrl?: string }[];
}

export interface CreativeAsset {
  creativeId: string;
  adId: string;
  /** Media assets carry a provider ID; text assets are flexible-creative copy variations. */
  assetType: "video" | "image" | "title" | "body" | "link_url";
  /** Provider asset identity: a Meta video ID or image hash, or `text:<hash>` for copy. */
  assetId: string;
  videoId: string;
  imageHash: string;
  assetUrl: string;
  thumbnailUrl: string;
  /**
   * "reporting" for a video or image: Meta attributes a lead to an ad and its
   * creative, not to one asset inside it, so an asset inherits its creative's
   * results as reporting context and is never an exact attribution grain.
   * "metadata" for copy variations: no per-asset result exists at all.
   */
  attributionLevel: "reporting" | "metadata";
  assetText?: string;
}

export function creativeAssets(media: CreativeMedia): CreativeAsset[] {
  const assets = new Map<string, CreativeAsset>();
  const add = (type: "video" | "image", id: string, url: string, thumbnail: string) => {
    const assetId = clean(id);
    // Without a provider ID there is no asset identity to report on.
    if (!assetId) return;
    const key = `${type}:${assetId}`;
    if (assets.has(key)) return;
    assets.set(key, {
      creativeId: media.creativeId,
      adId: media.adId,
      assetType: type,
      assetId,
      videoId: type === "video" ? assetId : "",
      imageHash: type === "image" ? assetId : "",
      assetUrl: clean(url),
      thumbnailUrl: clean(thumbnail),
      attributionLevel: "reporting",
    });
  };
  add("video", media.videoId, "", media.thumbnailUrl);
  add("image", media.imageHash, media.imageUrl, media.thumbnailUrl);
  for (const asset of media.feedAssets ?? [])
    add(asset.type, asset.id, asset.url ?? "", asset.thumbnailUrl ?? "");
  return [...assets.values()];
}

/* --- CRM outcomes ----------------------------------------------------------- */

export interface CrmRecord {
  id: string;
  recordType: string;
  businessStatus: string;
  stageKey: string;
  openStatus: string;
  priority: string;
  createdAt: string;
  facebookLeadId: string;
  adId: string;
  campaignId: string;
}

export interface SaleOrderLink {
  orderId: string;
  orderName: string;
  opportunityId: string;
  state: string;
}

export interface PaidInvoiceLine {
  orderName: string;
  movement: string;
  usdPaid: number;
  paymentDate: string;
}

export interface CrmOutcome {
  crmLeadId: string;
  interested: boolean;
  qualified: boolean;
  quotation: boolean;
  won: boolean;
  lost: boolean;
  saleOrderIds: string[];
  invoiceCount: number;
  revenuePaidUsd: number;
  firstInvoiceAt: string;
}

const LATER_THAN_OPEN = new Set(["quotation", "won"]);

/**
 * Lifecycle from stable CRM fields, never from translated stage names:
 * - interested: Odoo Open Status "Interested", or a stage past Open
 * - qualified: CRM priority Intermediate or Hot, or a stage past Open
 * - quotation: Quotation Sent or Won stage, or a confirmed sales order exists
 * - won / lost: the CRM contract's business status
 * A lost record keeps the progress it made before it was lost.
 */
export function crmOutcome(
  record: CrmRecord,
  orders: readonly SaleOrderLink[],
  invoices: readonly PaidInvoiceLine[],
): CrmOutcome {
  const stage = clean(record.stageKey);
  const pastOpen = LATER_THAN_OPEN.has(stage);
  const priority = clean(record.priority).toLowerCase();
  const own = orders.filter((order) => order.opportunityId === record.id);
  const orderNames = new Set(own.map((order) => order.orderName));
  const paid = invoices.filter((line) => orderNames.has(line.orderName));
  const movements = new Set(paid.map((line) => line.movement).filter(Boolean));
  const firstInvoiceAt = paid
    .map((line) => line.paymentDate)
    .filter(Boolean)
    .sort()[0];
  return {
    crmLeadId: record.id,
    interested: pastOpen || clean(record.openStatus).toLowerCase() === "interested",
    qualified: pastOpen || priority === "hot" || priority === "intermediate",
    quotation: pastOpen || own.length > 0,
    won: record.businessStatus === "won",
    lost: record.businessStatus === "lost",
    saleOrderIds: own.map((order) => order.orderId),
    invoiceCount: movements.size,
    revenuePaidUsd: Math.round(paid.reduce((sum, line) => sum + line.usdPaid, 0) * 100) / 100,
    firstInvoiceAt: firstInvoiceAt ?? "",
  };
}

/* --- Acquisition → CRM links ------------------------------------------------ */

export interface AcquisitionIdentity {
  acquisitionEventId: string;
  entityType: string;
  providerLeadId: string;
  chatwootConversationId: string;
  chatwootContactId: string;
  landingSubmissionId: string;
  /** CRM IDs the Chatwoot projector already related to this conversation. */
  chatwootCrmLeadIds: string[];
  /** When the acquisition happened, as Cairo wall-clock `YYYY-MM-DD HH:MM[:SS]`. */
  occurredAt?: string;
}

/**
 * An inferred (phone) link may only reach the CRM record that followed the
 * acquisition: created from one day before it to this many days after. A record
 * created long before is a returning customer's history, not this acquisition's
 * outcome.
 */
export const INFERRED_LINK_WINDOW_DAYS = 30;

function dayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(value));
  return match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000
    : null;
}

export function withinInferredWindow(acquisitionAt: string, crmCreatedAt: string): boolean {
  const acquired = dayNumber(acquisitionAt);
  const created = dayNumber(crmCreatedAt);
  if (acquired === null || created === null) return false;
  return created >= acquired - 1 && created <= acquired + INFERRED_LINK_WINDOW_DAYS;
}

export interface AcquisitionCrmLink {
  acquisitionEventId: string;
  crmLeadId: string;
  crmOpportunityId: string;
  chatwootConversationId: string;
  chatwootContactId: string;
  providerLeadId: string;
  landingSubmissionId: string;
  matchMethod: MatchMethod;
  matchConfidence: MatchConfidence;
  /** One acquisition counts once: exactly one primary link per acquisition. */
  isPrimary: boolean;
}

/**
 * Links acquisitions to CRM records using the strongest evidence available and
 * nothing weaker than an existing deterministic relation. There is no name,
 * email-domain or partial-phone logic here; a conversation is linked only to CRM
 * IDs the Chatwoot projector already stored. When several CRM records match,
 * the primary link is the record that went furthest (won, then opportunity),
 * then the oldest, so an acquisition is never counted twice.
 */
export function linkAcquisitionsToCrm(
  acquisitions: readonly AcquisitionIdentity[],
  crm: readonly CrmRecord[],
): AcquisitionCrmLink[] {
  const byId = new Map(crm.map((record) => [record.id, record]));
  const byProviderLead = new Map<string, CrmRecord[]>();
  for (const record of crm) {
    const leadId = clean(record.facebookLeadId);
    if (!leadId) continue;
    const list = byProviderLead.get(leadId) ?? [];
    list.push(record);
    byProviderLead.set(leadId, list);
  }

  const links: AcquisitionCrmLink[] = [];
  for (const acquisition of acquisitions) {
    const candidates: { record: CrmRecord; method: MatchMethod; confidence: MatchConfidence }[] =
      [];
    const providerLeadId = clean(acquisition.providerLeadId);
    if (providerLeadId) {
      for (const record of byProviderLead.get(providerLeadId) ?? []) {
        candidates.push({
          record,
          method:
            acquisition.entityType === "meta_lead" &&
            acquisition.acquisitionEventId === `meta_lead:${providerLeadId}`
              ? "crm_carried_provider_lead_id"
              : "provider_lead_id",
          confidence: "exact",
        });
      }
    }
    if (!candidates.length) {
      for (const id of acquisition.chatwootCrmLeadIds) {
        const record = byId.get(clean(id));
        if (record && withinInferredWindow(clean(acquisition.occurredAt), record.createdAt))
          candidates.push({ record, method: "chatwoot_phone_key", confidence: "inferred" });
      }
    }
    const seen = new Set<string>();
    const unique = candidates.filter(({ record }) =>
      seen.has(record.id) ? false : (seen.add(record.id), true),
    );
    const primary = [...unique].sort(compareForPrimary)[0]?.record.id;
    for (const { record, method, confidence } of unique) {
      links.push({
        acquisitionEventId: acquisition.acquisitionEventId,
        crmLeadId: record.id,
        crmOpportunityId: record.recordType === "opportunity" ? record.id : "",
        chatwootConversationId: acquisition.chatwootConversationId,
        chatwootContactId: acquisition.chatwootContactId,
        providerLeadId,
        landingSubmissionId: acquisition.landingSubmissionId,
        matchMethod: method,
        matchConfidence: confidence,
        isPrimary: record.id === primary,
      });
    }
  }
  return links;
}

function compareForPrimary(
  a: { record: CrmRecord; confidence: MatchConfidence },
  b: { record: CrmRecord; confidence: MatchConfidence },
): number {
  const rank = (item: { record: CrmRecord; confidence: MatchConfidence }) =>
    (item.confidence === "exact" ? 0 : 4) +
    (item.record.businessStatus === "won" ? 0 : item.record.recordType === "opportunity" ? 1 : 2);
  return (
    rank(a) - rank(b) ||
    clean(a.record.createdAt).localeCompare(clean(b.record.createdAt)) ||
    a.record.id.localeCompare(b.record.id)
  );
}

/* --- Rollups ---------------------------------------------------------------- */

export const CLOSED_LOOP_GRAINS = ["campaign", "adset", "ad", "creative"] as const;
export type ClosedLoopGrain = (typeof CLOSED_LOOP_GRAINS)[number];

/** One acquisition with its identity and, when linked, its primary CRM outcome. */
export interface AcquisitionFactRow {
  acquisitionEventId: string;
  entityType: string;
  destinationChannel: string;
  sourcePlatform: string;
  attributionConfidence: AttributionConfidence;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  creativeId: string;
  creativeName: string;
  formId: string;
  landingPageId: string;
  course: string;
  salesperson: string;
  matchConfidence: MatchConfidence | "";
  outcome: CrmOutcome | null;
}

export interface SpendRow {
  campaignId: string;
  adsetId: string;
  adId: string;
  creativeId: string;
  spend: number;
  impressions: number;
  clicks: number;
}

export interface QualityMetrics {
  leads: number;
  conversations: number;
  metaFormLeads: number;
  landingLeads: number;
  crmMatched: number;
  interested: number;
  qualified: number;
  quotations: number;
  won: number;
  saleOrders: number;
  invoices: number;
  revenue: number;
  spend: number;
  impressions: number;
  clicks: number;
  cpl: number | null;
  costPerInterested: number | null;
  costPerQualified: number | null;
  costPerQuotation: number | null;
  cac: number | null;
  /** Rates use CRM-matched leads as the denominator; unmatched leads have no known outcome. */
  interestRate: number | null;
  qualificationRate: number | null;
  quotationRate: number | null;
  winRate: number | null;
  revenuePerLead: number | null;
  roas: number | null;
}

export interface GrainRow extends QualityMetrics {
  key: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  creativeId: string;
  creativeName: string;
}

const GRAIN_KEYS: Record<
  ClosedLoopGrain,
  readonly ("campaignId" | "adsetId" | "adId" | "creativeId")[]
> = {
  campaign: ["campaignId"],
  adset: ["campaignId", "adsetId"],
  ad: ["campaignId", "adsetId", "adId"],
  creative: ["creativeId"],
};

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;
const cost = (spend: number, count: number): number | null =>
  spend > 0 && count > 0 ? Math.round((spend / count) * 100) / 100 : null;

export function emptyMetrics(): QualityMetrics {
  return {
    leads: 0,
    conversations: 0,
    metaFormLeads: 0,
    landingLeads: 0,
    crmMatched: 0,
    interested: 0,
    qualified: 0,
    quotations: 0,
    won: 0,
    saleOrders: 0,
    invoices: 0,
    revenue: 0,
    spend: 0,
    impressions: 0,
    clicks: 0,
    cpl: null,
    costPerInterested: null,
    costPerQualified: null,
    costPerQuotation: null,
    cac: null,
    interestRate: null,
    qualificationRate: null,
    quotationRate: null,
    winRate: null,
    revenuePerLead: null,
    roas: null,
  };
}

export function addFact(metrics: QualityMetrics, fact: AcquisitionFactRow): void {
  metrics.leads += 1;
  if (fact.entityType === "chatwoot_conversation") metrics.conversations += 1;
  if (fact.entityType === "meta_lead") metrics.metaFormLeads += 1;
  if (fact.entityType === "landing_submission") metrics.landingLeads += 1;
  const outcome = fact.outcome;
  if (!outcome) return;
  metrics.crmMatched += 1;
  if (outcome.interested) metrics.interested += 1;
  if (outcome.qualified) metrics.qualified += 1;
  if (outcome.quotation) metrics.quotations += 1;
  if (outcome.won) metrics.won += 1;
  metrics.saleOrders += outcome.saleOrderIds.length;
  metrics.invoices += outcome.invoiceCount;
  metrics.revenue = Math.round((metrics.revenue + outcome.revenuePaidUsd) * 100) / 100;
}

export function finalizeMetrics(metrics: QualityMetrics): QualityMetrics {
  metrics.spend = Math.round(metrics.spend * 100) / 100;
  metrics.cpl = cost(metrics.spend, metrics.leads);
  metrics.costPerInterested = cost(metrics.spend, metrics.interested);
  metrics.costPerQualified = cost(metrics.spend, metrics.qualified);
  metrics.costPerQuotation = cost(metrics.spend, metrics.quotations);
  metrics.cac = cost(metrics.spend, metrics.won);
  metrics.interestRate = ratio(metrics.interested, metrics.crmMatched);
  metrics.qualificationRate = ratio(metrics.qualified, metrics.crmMatched);
  metrics.quotationRate = ratio(metrics.quotations, metrics.crmMatched);
  metrics.winRate = ratio(metrics.won, metrics.crmMatched);
  metrics.revenuePerLead = metrics.leads
    ? Math.round((metrics.revenue / metrics.leads) * 100) / 100
    : null;
  metrics.roas =
    metrics.spend > 0 ? Math.round((metrics.revenue / metrics.spend) * 100) / 100 : null;
  return metrics;
}

/**
 * Performance at one grain. Only exactly attributed acquisitions are credited
 * to an entity; everything else stays out of the entity rows (and is reported
 * as coverage instead). Spend is joined on the same provider IDs.
 */
export function rollupByGrain(
  facts: readonly AcquisitionFactRow[],
  spend: readonly SpendRow[],
  grain: ClosedLoopGrain,
): GrainRow[] {
  const keys = GRAIN_KEYS[grain];
  const rows = new Map<string, GrainRow>();
  const at = (source: Partial<Record<(typeof keys)[number], string>>): GrainRow | null => {
    const parts = keys.map((key) => clean(source[key]));
    if (parts.some((part) => !part)) return null;
    const key = parts.join("|");
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        campaignId: grain === "creative" ? "" : parts[0],
        campaignName: "",
        adsetId: keys.includes("adsetId") ? parts[1] : "",
        adsetName: "",
        adId: keys.includes("adId") ? parts[2] : "",
        adName: "",
        creativeId: grain === "creative" ? parts[0] : "",
        creativeName: "",
        ...emptyMetrics(),
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const fact of facts) {
    if (fact.attributionConfidence !== "exact") continue;
    const row = at(fact);
    if (!row) continue;
    row.campaignName ||= grain === "creative" ? "" : fact.campaignName;
    row.adsetName ||= row.adsetId ? fact.adsetName : "";
    row.adName ||= row.adId ? fact.adName : "";
    row.creativeName ||= row.creativeId ? fact.creativeName : "";
    addFact(row, fact);
  }
  for (const item of spend) {
    const row = at(item);
    if (!row) continue;
    row.spend += item.spend;
    row.impressions += item.impressions;
    row.clicks += item.clicks;
  }
  return [...rows.values()].map((row) => finalizeMetrics(row) as GrainRow);
}

/**
 * Lead-quality ranking: revenue per lead first, then win rate, then revenue.
 * A grain needs enough CRM-matched leads for its rates to mean anything; below
 * the threshold it is listed but not ranked above grains with evidence.
 */
export function rankByLeadQuality<T extends QualityMetrics>(
  rows: readonly T[],
  minMatched = 10,
): T[] {
  const eligible = (row: T) => row.crmMatched >= minMatched;
  return [...rows].sort(
    (a, b) =>
      Number(eligible(b)) - Number(eligible(a)) ||
      (b.revenuePerLead ?? -1) - (a.revenuePerLead ?? -1) ||
      (b.winRate ?? -1) - (a.winRate ?? -1) ||
      b.revenue - a.revenue ||
      b.leads - a.leads,
  );
}

export interface Coverage {
  total: number;
  withCampaignId: number;
  withAdsetId: number;
  withAdId: number;
  withCreativeId: number;
  withFormId: number;
  exact: number;
  crmMatched: number;
  crmMatchedExact: number;
  unknown: number;
}

export function coverageOf(facts: readonly AcquisitionFactRow[]): Coverage {
  const coverage: Coverage = {
    total: 0,
    withCampaignId: 0,
    withAdsetId: 0,
    withAdId: 0,
    withCreativeId: 0,
    withFormId: 0,
    exact: 0,
    crmMatched: 0,
    crmMatchedExact: 0,
    unknown: 0,
  };
  for (const fact of facts) {
    coverage.total += 1;
    if (clean(fact.campaignId)) coverage.withCampaignId += 1;
    if (clean(fact.adsetId)) coverage.withAdsetId += 1;
    if (clean(fact.adId)) coverage.withAdId += 1;
    if (clean(fact.creativeId)) coverage.withCreativeId += 1;
    if (clean(fact.formId)) coverage.withFormId += 1;
    if (fact.attributionConfidence === "exact") coverage.exact += 1;
    if (fact.attributionConfidence === "unknown") coverage.unknown += 1;
    if (fact.outcome) coverage.crmMatched += 1;
    if (fact.outcome && fact.matchConfidence === "exact") coverage.crmMatchedExact += 1;
  }
  return coverage;
}

export interface FunnelStep {
  key: string;
  value: number | null;
  /** Conversion from the previous available step, 0–1. */
  rateFromPrevious: number | null;
}

/** The closed-loop funnel, with each step's rate from the previous step that has a value. */
export function closedLoopFunnel(input: {
  impressions: number | null;
  clicks: number | null;
  metrics: QualityMetrics;
}): FunnelStep[] {
  const values: [string, number | null][] = [
    ["impressions", input.impressions],
    ["clicks", input.clicks],
    ["acquisitions", input.metrics.leads],
    ["crm_matched", input.metrics.crmMatched],
    ["interested", input.metrics.interested],
    ["quotation", input.metrics.quotations],
    ["won", input.metrics.won],
    ["sales_orders", input.metrics.saleOrders],
    ["invoices", input.metrics.invoices],
    ["revenue", input.metrics.revenue],
  ];
  let previous: number | null = null;
  return values.map(([key, value]) => {
    const step: FunnelStep = {
      key,
      value,
      rateFromPrevious:
        key === "revenue" || value === null || previous === null || previous <= 0
          ? null
          : value / previous,
    };
    if (value !== null && key !== "revenue") previous = value;
    return step;
  });
}

/**
 * A creative name a person can read. Dynamic catalog creatives are named by
 * their template (`{{product.name}} 2026-02-21-…`); show the headline instead,
 * or say what it is. The provider ID never changes.
 */
export function readableCreativeName(name: string, headline = ""): string {
  const raw = clean(name);
  if (!/\{\{[^}]+\}\}/.test(raw)) return raw;
  const title = clean(headline);
  if (title && !/\{\{[^}]+\}\}/.test(title)) return title;
  const suffix = raw.replace(/\{\{[^}]+\}\}/g, "").trim();
  return `Dynamic catalog creative${suffix ? ` ${suffix}` : ""}`;
}
