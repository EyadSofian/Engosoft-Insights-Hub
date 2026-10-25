/**
 * Classifies Meta ads by where their conversion actually happens and rolls
 * Meta-reported delivery into a coverage matrix.
 *
 * Everything here is aggregate platform reporting. It never identifies,
 * counts, or attributes an individual Chatwoot conversation, website visit, or
 * lead, and none of its numbers may be presented as conversation attribution.
 */

export const DESTINATION_TYPES = [
  "MESSAGING",
  "WEBSITE_LANDING",
  "META_INSTANT_FORM",
  "CALL",
  "OTHER",
] as const;

export type DestinationType = (typeof DESTINATION_TYPES)[number];

const MESSAGING_DESTINATIONS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  INSTAGRAM_DIRECT: "Instagram DM",
  MESSAGING_MESSENGER_WHATSAPP: "Messenger + WhatsApp",
  MESSAGING_INSTAGRAM_DIRECT_MESSENGER: "Instagram DM + Messenger",
  MESSAGING_INSTAGRAM_DIRECT_WHATSAPP: "Instagram DM + WhatsApp",
  MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP: "Instagram DM + Messenger + WhatsApp",
};

const META_OWNED_HOST =
  /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|wa\.me|whatsapp\.com|m\.me|messenger\.com)$/i;
const WHATSAPP_HOST = /(^|\.)(wa\.me|whatsapp\.com)$/i;
const MESSENGER_HOST = /(^|\.)(m\.me|messenger\.com)$/i;

export interface MetaAdEvidence {
  destinationType: string;
  optimizationGoal: string;
  callToActionTypes: string[];
  appDestinations: string[];
  leadFormIds: string[];
  links: string[];
}

export interface DestinationClassification {
  type: DestinationType;
  messagingDestination: string | null;
  /** Meta's "Website and instant forms" ad sets can serve either path. */
  mixedDestination: boolean;
  landingUrl: string | null;
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

function callToActions(creative: Json): Json[] {
  const spec = obj(creative.object_story_spec);
  const found: Json[] = [];
  for (const key of ["link_data", "video_data", "template_data", "photo_data"]) {
    const cta = obj(obj(spec[key]).call_to_action);
    if (Object.keys(cta).length) found.push(cta);
  }
  for (const cta of list(obj(creative.asset_feed_spec).call_to_actions)) found.push(obj(cta));
  const typeOnly = str(creative.call_to_action_type);
  if (typeOnly) found.push({ type: typeOnly });
  return found;
}

/** Reads only destination evidence from a Graph `ad` with `adset` and `creative` expanded. */
export function extractMetaAdEvidence(ad: unknown): MetaAdEvidence {
  const record = obj(ad);
  const adset = obj(record.adset);
  const creative = obj(record.creative);
  const spec = obj(creative.object_story_spec);
  const ctas = callToActions(creative);
  return {
    destinationType: str(adset.destination_type) || "UNDEFINED",
    optimizationGoal: str(adset.optimization_goal),
    callToActionTypes: unique(ctas.map((cta) => str(cta.type))),
    appDestinations: unique(ctas.map((cta) => str(obj(cta.value).app_destination))),
    leadFormIds: unique(ctas.map((cta) => str(obj(cta.value).lead_gen_form_id))),
    links: unique([
      str(obj(spec.link_data).link),
      str(obj(spec.template_data).link),
      str(creative.link_url),
      str(creative.template_url),
      ...ctas.map((cta) => str(obj(cta.value).link)),
      ...list(obj(creative.asset_feed_spec).link_urls).map((link) => str(obj(link).website_url)),
    ]),
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Exactly one destination per ad, in this order: an explicit messaging
 * destination or messaging button, a native lead form, a call, an external
 * website link, and otherwise OTHER. A mixed "website and instant forms" ad
 * set follows its creative and stays flagged as mixed.
 */
export function classifyMetaAdDestination(evidence: MetaAdEvidence): DestinationClassification {
  const {
    destinationType,
    optimizationGoal,
    callToActionTypes: cta,
    appDestinations: app,
    leadFormIds,
    links,
  } = evidence;
  const mixedDestination = destinationType === "WEBSITE_AND_LEAD_FORM";
  const hosts = links.flatMap((link) => {
    const host = hostOf(link);
    return host ? [{ link, host }] : [];
  });
  const externalLinks = hosts
    .filter(({ host }) => !META_OWNED_HOST.test(host))
    .map(({ link }) => link);
  const linksTo = (pattern: RegExp) => hosts.some(({ host }) => pattern.test(host));
  const messaging = (messagingDestination: string): DestinationClassification => ({
    type: "MESSAGING",
    messagingDestination,
    mixedDestination,
    landingUrl: null,
  });
  const other = (type: DestinationType, landingUrl: string | null = null) => ({
    type,
    messagingDestination: null,
    mixedDestination,
    landingUrl,
  });

  if (MESSAGING_DESTINATIONS[destinationType])
    return messaging(MESSAGING_DESTINATIONS[destinationType]);
  if (cta.includes("WHATSAPP_MESSAGE") || app.includes("WHATSAPP") || linksTo(WHATSAPP_HOST))
    return messaging("WhatsApp");
  if (cta.includes("MESSAGE_PAGE") || app.includes("MESSENGER") || linksTo(MESSENGER_HOST))
    return messaging("Messenger");
  if (cta.includes("INSTAGRAM_MESSAGE") || app.includes("INSTAGRAM_DIRECT"))
    return messaging("Instagram DM");
  if (
    leadFormIds.length ||
    (["ON_AD", "LEAD_FORM_MESSENGER"].includes(destinationType) &&
      /LEAD_GENERATION|QUALITY_LEAD/.test(optimizationGoal))
  )
    return other("META_INSTANT_FORM");
  if (
    destinationType === "PHONE_CALL" ||
    cta.includes("CALL_NOW") ||
    optimizationGoal === "QUALITY_CALL"
  )
    return other("CALL");
  if (externalLinks.length || destinationType === "WEBSITE")
    return other("WEBSITE_LANDING", externalLinks[0] ?? null);
  return other("OTHER");
}

/** Meta action types reported per ad. These are platform counts, never individual records. */
export const RESULT_ACTIONS = {
  instantFormLeads: "onsite_conversion.lead_grouped",
  messagingConversationsStarted: "onsite_conversion.messaging_conversation_started_7d",
  pixelLeads: "offsite_conversion.fb_pixel_lead",
  landingPageViews: "landing_page_view",
  callsPlaced: "click_to_call_native_call_placed",
} as const;

export type ResultKey = keyof typeof RESULT_ACTIONS;

/** The Meta-reported result that matches each destination's own conversion. */
export const PRIMARY_RESULT: Record<DestinationType, ResultKey | null> = {
  MESSAGING: "messagingConversationsStarted",
  WEBSITE_LANDING: "landingPageViews",
  META_INSTANT_FORM: "instantFormLeads",
  CALL: "callsPlaced",
  OTHER: null,
};

export type IngestionStatus = "partial" | "missing" | "not_applicable";

/**
 * Engosoft's own event-level ingestion per destination, as verified in
 * production on 2026-09-14. Change this only with production evidence.
 *
 * - MESSAGING: Meta message listener subscribed to the WABA and Chatwoot webhook
 *   live, but no real Meta delivery observed yet and Messenger/Instagram DM are
 *   not subscribed.
 * - WEBSITE_LANDING: landing collector live on the Odoo CFM page only.
 * - META_INSTANT_FORM: no native Lead Ads ingestion exists.
 */
export const ENGOSOFT_INGESTION: Record<DestinationType, IngestionStatus> = {
  MESSAGING: "partial",
  WEBSITE_LANDING: "partial",
  META_INSTANT_FORM: "missing",
  CALL: "missing",
  OTHER: "not_applicable",
};

export function parseMetaActions(actions: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of list(actions)) {
    const action = obj(entry);
    const type = str(action.action_type);
    const value = Number(action.value);
    if (type && Number.isFinite(value)) out[type] = (out[type] ?? 0) + value;
  }
  return out;
}

export interface ClassifiedAdPerformance {
  campaignId: string;
  adId: string;
  currency: string;
  classification: DestinationClassification;
  spend: number;
  impressions: number;
  clicks: number;
  actions: Record<string, number>;
}

export interface CoverageRow {
  type: DestinationType;
  campaigns: number;
  ads: number;
  mixedDestinationAds: number;
  /** Never summed across currencies. */
  spendByCurrency: Record<string, number>;
  impressions: number;
  clicks: number;
  results: Record<ResultKey, number>;
  primaryResult: ResultKey | null;
  messagingDestinations: Record<string, number>;
  ingestion: IngestionStatus;
}

const cents = (value: number) => Math.round(value * 100) / 100;

export function addSpend(target: Record<string, number>, currency: string, spend: number): void {
  const key = currency || "UNKNOWN";
  target[key] = cents((target[key] ?? 0) + spend);
}

export function buildCoverageMatrix(ads: readonly ClassifiedAdPerformance[]): CoverageRow[] {
  return DESTINATION_TYPES.map((type) => {
    const rows = ads.filter((ad) => ad.classification.type === type);
    const spendByCurrency: Record<string, number> = {};
    const messagingDestinations: Record<string, number> = {};
    const results = Object.fromEntries(
      Object.keys(RESULT_ACTIONS).map((key) => [key, 0]),
    ) as Record<ResultKey, number>;
    let impressions = 0;
    let clicks = 0;
    for (const ad of rows) {
      addSpend(spendByCurrency, ad.currency, ad.spend);
      impressions += ad.impressions;
      clicks += ad.clicks;
      for (const [key, actionType] of Object.entries(RESULT_ACTIONS) as [ResultKey, string][])
        results[key] += ad.actions[actionType] ?? 0;
      const destination = ad.classification.messagingDestination;
      if (destination)
        messagingDestinations[destination] = (messagingDestinations[destination] ?? 0) + 1;
    }
    return {
      type,
      campaigns: new Set(rows.map((ad) => ad.campaignId)).size,
      ads: rows.length,
      mixedDestinationAds: rows.filter((ad) => ad.classification.mixedDestination).length,
      spendByCurrency,
      impressions,
      clicks,
      results,
      primaryResult: PRIMARY_RESULT[type],
      messagingDestinations,
      ingestion: ENGOSOFT_INGESTION[type],
    };
  });
}
