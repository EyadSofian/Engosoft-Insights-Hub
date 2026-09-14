import { chatwootDestinationChannel, normalizeSourcePlatform } from "./acquisition-attribution";
import { mediaBuyerNameForCampaign } from "./media-buyers";

/**
 * The one Chatwoot custom-attribute schema for attribution and business context.
 *
 * Every writer (the Chatwoot webhook projector, the Meta messaging listener and
 * the historical backfill) builds its attributes here, so a conversation looks
 * the same whichever path touched it last. Facts an inbox or a configured rule
 * proves (channel, branch, customer source and type) are kept apart from
 * marketing attribution, which is written only from provider, UTM or tracking
 * evidence and is never inferred.
 */

export const CHATWOOT_ATTRIBUTION_DEFINITIONS = [
  {
    key: "attribution_source",
    name: "Attribution Source",
    description: "Platform the customer came from, from provider or UTM evidence.",
  },
  {
    key: "attribution_channel",
    name: "Attribution Channel",
    description: "Messaging channel proven by the Chatwoot inbox.",
  },
  {
    key: "attribution_medium",
    name: "Attribution Medium",
    description: "Marketing medium from provider or UTM evidence.",
  },
  {
    key: "attribution_campaign",
    name: "Attribution Campaign",
    description: "Exact campaign name from Meta or the declared UTM campaign.",
  },
  {
    key: "attribution_method",
    name: "Attribution Method",
    description: "How attribution was proven, or unknown.",
  },
  {
    key: "attribution_confidence",
    name: "Attribution Confidence",
    description: "exact, strong, inferred or unknown.",
  },
  {
    key: "attribution_unknown_reason",
    name: "Attribution Unknown Reason",
    description: "Why marketing attribution is unknown for this conversation.",
  },
  { key: "meta_campaign_id", name: "Meta Campaign ID", description: "Exact Meta campaign ID." },
  {
    key: "meta_campaign_name",
    name: "Meta Campaign Name",
    description: "Exact Meta campaign name.",
  },
  { key: "meta_adset_id", name: "Meta Ad Set ID", description: "Exact Meta ad set ID." },
  { key: "meta_adset_name", name: "Meta Ad Set Name", description: "Exact Meta ad set name." },
  { key: "meta_ad_id", name: "Meta Ad ID", description: "Exact Meta ad ID." },
  { key: "meta_ad_name", name: "Meta Ad Name", description: "Exact Meta ad name." },
  { key: "meta_creative_id", name: "Meta Creative ID", description: "Exact Meta creative ID." },
  {
    key: "meta_creative_name",
    name: "Meta Creative Name",
    description: "Exact Meta creative name.",
  },
  { key: "ctwa_clid", name: "CTWA Click ID", description: "Click-to-WhatsApp click ID from Meta." },
  {
    key: "engosoft_branch",
    name: "Engosoft Branch",
    description: "Branch from the configured inbox to branch mapping.",
  },
  {
    key: "marketer_name",
    name: "Marketer",
    description: "Media buyer who owns the exact campaign, from the documented ownership rule.",
  },
  {
    key: "customer_source",
    name: "Customer Source",
    description: "How the customer reached Engosoft, from the inbox channel and provider evidence.",
  },
  {
    key: "customer_type",
    name: "Customer Type",
    description: "From a configured Engosoft classification rule, otherwise unknown.",
  },
  { key: "utm_source", name: "UTM Source", description: "Declared utm_source." },
  { key: "utm_medium", name: "UTM Medium", description: "Declared utm_medium." },
  { key: "utm_campaign", name: "UTM Campaign", description: "Declared utm_campaign." },
  { key: "utm_content", name: "UTM Content", description: "Declared utm_content." },
  { key: "utm_term", name: "UTM Term", description: "Declared utm_term." },
] as const;

export type ChatwootAttributionKey = (typeof CHATWOOT_ATTRIBUTION_DEFINITIONS)[number]["key"];
export type ChatwootAttributionAttributes = Partial<Record<ChatwootAttributionKey, string>>;

export const CHATWOOT_ATTRIBUTION_KEYS: readonly ChatwootAttributionKey[] =
  CHATWOOT_ATTRIBUTION_DEFINITIONS.map((definition) => definition.key);

export const CUSTOMER_SOURCES = [
  "meta_instant_form",
  "click_to_whatsapp",
  "whatsapp",
  "messenger",
  "instagram_dm",
  "landing_page",
  "website_chat",
  "direct",
  "unknown",
] as const;

export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];

/** Facts proven by the inbox or an explicit mapping: they only ever fill an empty attribute. */
const FACT_KEYS: readonly ChatwootAttributionKey[] = [
  "attribution_channel",
  "engosoft_branch",
  "marketer_name",
];
/** Business classifications: they fill an empty attribute or replace `unknown`, nothing else. */
const CLASSIFICATION_KEYS: readonly ChatwootAttributionKey[] = ["customer_source", "customer_type"];
/** Channel-only classifications that later provider evidence may make more specific. */
const CLASSIFICATION_UPGRADES: Readonly<Record<string, readonly string[]>> = {
  whatsapp: ["click_to_whatsapp"],
};

const META_REFERRAL_METHODS = new Set([
  "meta_referral",
  "meta_whatsapp_referral",
  "meta_messenger_referral",
  "meta_instagram_referral",
]);
const DECLARED_METHODS = new Set(["utm", "signed_tracking_token", "referrer"]);
/** Reasons that would read as "organic" are not reasons; missing evidence is unknown. */
const ORGANIC_REASONS = new Set(["organic_direct", "no_paid_referral"]);
const CONFIDENCE_RANK: Record<string, number> = {
  exact: 3,
  strong: 2,
  declared: 2,
  inferred: 1,
  unknown: 0,
};

export const HISTORICAL_EVIDENCE_MISSING = "historical_evidence_missing";
export const REFERRAL_EVIDENCE_MISSING = "referral_evidence_missing";

export interface ChatwootAttributionFacts {
  /** Chatwoot channel type (`Channel::Whatsapp`) or canonical channel (`whatsapp`). */
  channel: string;
  /** Branch from the configured inbox → branch mapping; empty when none is configured. */
  branch?: string;
  attributionMethod: string;
  confidence: string;
  unknownReason?: string;
  /** True for conversations that existed before provider evidence was captured. */
  historical?: boolean;
  source?: string;
  medium?: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  adName?: string;
  creativeId?: string;
  creativeName?: string;
  ctwaClid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  /** Marketer from an explicit per-campaign mapping; overrides the naming rule. */
  marketer?: string;
  /** Customer type from a configured Engosoft rule; `unknown` when none applies. */
  customerType?: string;
}

const clean = (value: unknown): string => (value == null ? "" : String(value).trim());

function compact(values: Record<string, string>): ChatwootAttributionAttributes {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => Boolean(value)),
  ) as ChatwootAttributionAttributes;
}

export function hasAttributionEvidence(method: string): boolean {
  const value = clean(method);
  return META_REFERRAL_METHODS.has(value) || DECLARED_METHODS.has(value);
}

/**
 * How the customer reached Engosoft. The inbox proves the entry channel, so a
 * WhatsApp, Messenger, Instagram or website conversation always has a source;
 * a Meta click-to-WhatsApp referral upgrades WhatsApp to `click_to_whatsapp`.
 * Only a conversation on an unrecognised channel stays unknown.
 */
export function customerSourceFor(input: {
  attributionMethod: string;
  channel: string;
  confidence?: string;
}): CustomerSource {
  const method = clean(input.attributionMethod);
  const channel = chatwootDestinationChannel(clean(input.channel));
  if (method === "meta_whatsapp_referral" || (method === "meta_referral" && channel === "whatsapp"))
    return "click_to_whatsapp";
  if (channel === "whatsapp") return "whatsapp";
  if (channel === "messenger") return "messenger";
  if (channel === "instagram_dm") return "instagram_dm";
  if (channel === "website_chat") return "website_chat";
  if (method === "organic_direct" && clean(input.confidence) === "exact") return "direct";
  return "unknown";
}

/**
 * Builds the attributes a conversation should carry. Empty values are dropped,
 * so nothing is ever cleared in Chatwoot.
 */
export function buildChatwootAttributionAttributes(
  facts: ChatwootAttributionFacts,
): ChatwootAttributionAttributes {
  const method = clean(facts.attributionMethod);
  const channel = chatwootDestinationChannel(clean(facts.channel));
  const business = {
    attribution_channel: channel === "unknown" ? "" : channel,
    engosoft_branch: clean(facts.branch),
    customer_source: customerSourceFor({
      attributionMethod: method,
      channel: clean(facts.channel),
      confidence: facts.confidence,
    }),
    customer_type: clean(facts.customerType) || "unknown",
  };

  if (!hasAttributionEvidence(method)) {
    const reason = clean(facts.unknownReason);
    return compact({
      ...business,
      attribution_method: "unknown",
      attribution_confidence: "unknown",
      attribution_unknown_reason:
        reason && !ORGANIC_REASONS.has(reason)
          ? reason
          : facts.historical
            ? HISTORICAL_EVIDENCE_MISSING
            : REFERRAL_EVIDENCE_MISSING,
    });
  }

  const source = normalizeSourcePlatform(facts.source);
  const metaReferral = META_REFERRAL_METHODS.has(method);
  // Meta identifiers, names and click IDs come only from a provider referral, and a
  // name is carried only with the exact ID it belongs to.
  const campaignId = metaReferral ? clean(facts.campaignId) : "";
  const campaignName = campaignId ? clean(facts.campaignName) : "";
  const adsetId = metaReferral ? clean(facts.adsetId) : "";
  const adId = metaReferral ? clean(facts.adId) : "";
  const creativeId = metaReferral ? clean(facts.creativeId) : "";
  return compact({
    ...business,
    marketer_name: campaignId
      ? clean(facts.marketer) || mediaBuyerNameForCampaign(campaignName)
      : "",
    attribution_method: method,
    attribution_confidence: clean(facts.confidence) || "unknown",
    attribution_unknown_reason: clean(facts.unknownReason),
    attribution_source: source === "unknown" ? "" : source,
    attribution_medium: clean(facts.medium),
    attribution_campaign: campaignName || clean(facts.utmCampaign),
    meta_campaign_id: campaignId,
    meta_campaign_name: campaignName,
    meta_adset_id: adsetId,
    meta_adset_name: adsetId ? clean(facts.adsetName) : "",
    meta_ad_id: adId,
    meta_ad_name: adId ? clean(facts.adName) : "",
    meta_creative_id: creativeId,
    meta_creative_name: creativeId ? clean(facts.creativeName) : "",
    ctwa_clid: metaReferral ? clean(facts.ctwaClid) : "",
    utm_source: clean(facts.utmSource),
    utm_medium: clean(facts.utmMedium),
    utm_campaign: clean(facts.utmCampaign),
    utm_content: clean(facts.utmContent),
    utm_term: clean(facts.utmTerm),
  });
}

/** A conversation already carries proven attribution when any provider or declared evidence is on it. */
export function hasProvenChatwootAttribution(current: Record<string, unknown>): boolean {
  return (
    clean(current.attribution_confidence) === "exact" ||
    Boolean(
      clean(current.meta_campaign_id) || clean(current.meta_ad_id) || clean(current.ctwa_clid),
    ) ||
    hasAttributionEvidence(clean(current.attribution_method))
  );
}

function confidenceRank(value: unknown): number {
  return CONFIDENCE_RANK[clean(value)] ?? 0;
}

/**
 * Returns only the attributes that should change.
 *
 * - Nothing is ever cleared: empty wanted values are skipped.
 * - Facts (channel, branch, marketer) only fill an empty attribute, so a manual
 *   value set by an agent survives.
 * - Classifications (customer source and type) fill an empty attribute or
 *   upgrade `unknown`; a known classification is only replaced by a more
 *   specific one proven later (WhatsApp → click-to-WhatsApp).
 * - Attribution is never replaced by unknown data or by weaker evidence.
 * - In backfill mode, attribution markers only fill empty (or `unknown`) attributes.
 */
export function planChatwootAttributionUpdate(
  current: Record<string, unknown>,
  wanted: ChatwootAttributionAttributes,
  mode: "live" | "backfill",
): Record<string, string> {
  const proven = hasProvenChatwootAttribution(current);
  const wantedUnknown = wanted.attribution_method === "unknown";
  const weaker =
    confidenceRank(wanted.attribution_confidence) < confidenceRank(current.attribution_confidence);
  const changes: Record<string, string> = {};
  for (const [key, value] of Object.entries(wanted) as [ChatwootAttributionKey, string][]) {
    if (!value) continue;
    const existing = clean(current[key]);
    if (existing === value) continue;
    if (FACT_KEYS.includes(key)) {
      if (existing) continue;
    } else if (CLASSIFICATION_KEYS.includes(key)) {
      if (existing && existing !== "unknown" && !CLASSIFICATION_UPGRADES[existing]?.includes(value))
        continue;
      // A conversation with proven attribution never gains an `unknown` or a
      // channel-only classification; its provider evidence supplies the specific one.
      if (proven && (value === "unknown" || CLASSIFICATION_UPGRADES[value])) continue;
    } else {
      if (wantedUnknown && proven) continue;
      if (weaker) continue;
      if (mode === "backfill" && existing && existing !== "unknown") continue;
    }
    changes[key] = value;
  }
  return changes;
}
