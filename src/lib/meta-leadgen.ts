/**
 * Meta Lead Ads (instant form) evidence.
 *
 * Pure: no network, database, or secrets. Lead answers (`field_data`) are
 * never requested or read here. Only the identifiers Meta attaches to a lead
 * are kept, so attribution rows can never carry a person's form responses.
 */

export interface MetaLeadgenEvidence {
  /** `meta_lead:<leadgen_id>`; one durable row per Meta lead however often Meta retries. */
  eventKey: string;
  leadId: string;
  pageId: string;
  formId: string;
  adId: string;
  /** Meta calls the ad set `adgroup_id` in the webhook payload. */
  adsetId: string;
  occurredAt: string | null;
}

/** Lead node fields requested from Graph. `field_data` is deliberately absent. */
export const META_LEAD_FIELDS = [
  "id",
  "created_time",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "form_id",
  "platform",
  "is_organic",
].join(",");

export const META_LEAD_FORM_FIELDS = "id,name,status,locale,created_time,page";

export interface MetaLeadRecord {
  leadId: string;
  createdTime: string | null;
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  formId: string;
  platform: string;
  isOrganic: boolean | null;
}

export interface MetaLeadFormRecord {
  formId: string;
  pageId: string;
  name: string;
  status: string;
  locale: string;
  createdTime: string | null;
}

export type MetaLeadScope = "paid" | "organic" | "unknown";

type Json = Record<string, unknown>;

const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const id = (value: unknown): string => {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return typeof value === "string" && /^\d{1,32}$/.test(value.trim()) ? value.trim() : "";
};
const text = (value: unknown, max = 300): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** Accepts Meta's unix seconds, ISO strings, and `+0000` offsets. */
export function metaTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const millis = value < 1e12 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const raw = value.trim();
    if (/^\d{9,13}$/.test(raw)) return metaTimestamp(Number(raw));
    const parsed = Date.parse(raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

export function metaLeadEventKey(leadId: string): string {
  return `meta_lead:${leadId}`;
}

/**
 * Reads only Page `leadgen` changes. Anything else in the envelope (feed,
 * messaging, other objects) is ignored rather than rejected, so one webhook
 * subscription change on Meta's side cannot turn into failed deliveries.
 */
export function normalizeMetaLeadgenWebhook(payload: unknown): MetaLeadgenEvidence[] {
  const body = obj(payload);
  if (body.object !== "page") return [];
  const found = new Map<string, MetaLeadgenEvidence>();
  for (const entry of list(body.entry)) {
    const entryPageId = id(obj(entry).id);
    for (const change of list(obj(entry).changes)) {
      const record = obj(change);
      if (record.field !== "leadgen") continue;
      const value = obj(record.value);
      const leadId = id(value.leadgen_id);
      if (!leadId) continue;
      found.set(leadId, {
        eventKey: metaLeadEventKey(leadId),
        leadId,
        pageId: id(value.page_id) || entryPageId,
        formId: id(value.form_id),
        adId: id(value.ad_id),
        adsetId: id(value.adgroup_id),
        occurredAt: metaTimestamp(value.created_time),
      });
    }
  }
  return [...found.values()];
}

export function parseMetaLeadRecord(value: unknown): MetaLeadRecord | null {
  const record = obj(value);
  const leadId = id(record.id);
  if (!leadId) return null;
  return {
    leadId,
    createdTime: metaTimestamp(record.created_time),
    adId: id(record.ad_id),
    adName: text(record.ad_name),
    adsetId: id(record.adset_id),
    adsetName: text(record.adset_name),
    campaignId: id(record.campaign_id),
    campaignName: text(record.campaign_name),
    formId: id(record.form_id),
    platform: text(record.platform, 40).toLowerCase(),
    isOrganic: typeof record.is_organic === "boolean" ? record.is_organic : null,
  };
}

export function parseMetaLeadForm(value: unknown, fallbackPageId = ""): MetaLeadFormRecord | null {
  const record = obj(value);
  const formId = id(record.id);
  if (!formId) return null;
  return {
    formId,
    pageId: id(obj(record.page).id) || fallbackPageId,
    name: text(record.name),
    status: text(record.status, 40),
    locale: text(record.locale, 20),
    createdTime: metaTimestamp(record.created_time),
  };
}

/**
 * Paid only when Meta itself says the lead is not organic and names the ad.
 * A lead Meta reports as organic stays organic even if an ad ID is present.
 */
export function metaLeadScope(record: Pick<MetaLeadRecord, "isOrganic" | "adId">): {
  scope: MetaLeadScope;
  unknownReason: string;
} {
  if (record.isOrganic === true) return { scope: "organic", unknownReason: "" };
  if (record.adId) return { scope: "paid", unknownReason: "" };
  return { scope: "unknown", unknownReason: "meta_lead_ad_missing" };
}

/** Meta reports `fb` / `ig`; anything unexpected stays visible rather than guessed. */
export function metaLeadPlatform(platform: string): string {
  const value = platform.trim().toLowerCase();
  if (value === "fb" || value === "facebook") return "facebook";
  if (value === "ig" || value === "instagram") return "instagram";
  return value || "meta";
}
