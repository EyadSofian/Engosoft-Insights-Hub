import { chatwootDestinationChannel, normalizeSourcePlatform } from "./acquisition-attribution";

/**
 * The one Chatwoot custom-attribute schema for attribution.
 *
 * Both writers (the Chatwoot webhook projector and the Meta messaging listener)
 * build their attributes here, so a conversation looks the same whichever path
 * touched it last. Operational facts that an inbox proves (channel, branch) are
 * kept apart from marketing attribution, which is written only from provider,
 * UTM or tracking evidence and is never inferred.
 */

export const CHATWOOT_ATTRIBUTION_DEFINITIONS = [
  { key: "attribution_source", name: "Attribution source" },
  { key: "attribution_channel", name: "Attribution channel" },
  { key: "attribution_medium", name: "Attribution medium" },
  { key: "attribution_campaign", name: "Attribution campaign" },
  { key: "meta_campaign_id", name: "Meta campaign ID" },
  { key: "meta_adset_id", name: "Meta ad set ID" },
  { key: "meta_ad_id", name: "Meta ad ID" },
  { key: "meta_creative_id", name: "Meta creative ID" },
  { key: "ctwa_clid", name: "CTWA click ID" },
  { key: "engosoft_branch", name: "Engosoft branch" },
  { key: "attribution_method", name: "Attribution method" },
  { key: "attribution_confidence", name: "Attribution confidence" },
  { key: "attribution_unknown_reason", name: "Attribution unknown reason" },
  { key: "utm_source", name: "UTM source" },
  { key: "utm_medium", name: "UTM medium" },
  { key: "utm_campaign", name: "UTM campaign" },
  { key: "utm_content", name: "UTM content" },
  { key: "utm_term", name: "UTM term" },
] as const;

export type ChatwootAttributionKey = (typeof CHATWOOT_ATTRIBUTION_DEFINITIONS)[number]["key"];
export type ChatwootAttributionAttributes = Partial<Record<ChatwootAttributionKey, string>>;

export const CHATWOOT_ATTRIBUTION_KEYS: readonly ChatwootAttributionKey[] =
  CHATWOOT_ATTRIBUTION_DEFINITIONS.map((definition) => definition.key);

/** Facts an inbox mapping proves. They never say anything about marketing. */
const FACT_KEYS: readonly ChatwootAttributionKey[] = ["attribution_channel", "engosoft_branch"];

const META_REFERRAL_METHODS = new Set([
  "meta_referral",
  "meta_whatsapp_referral",
  "meta_messenger_referral",
  "meta_instagram_referral",
]);
const DECLARED_METHODS = new Set(["utm", "signed_tracking_token", "referrer"]);
/** Reasons that would read as "organic" are not reasons; missing evidence is unknown. */
const ORGANIC_REASONS = new Set(["organic_direct", "no_paid_referral"]);

export const HISTORICAL_EVIDENCE_MISSING = "historical_evidence_missing";
export const REFERRAL_EVIDENCE_MISSING = "referral_evidence_missing";

export interface ChatwootAttributionFacts {
  /** Chatwoot channel type (`Channel::Whatsapp`) or canonical channel (`whatsapp`). */
  channel: string;
  /** Branch from the trusted inbox → branch mapping; empty when none is configured. */
  branch?: string;
  attributionMethod: string;
  confidence: string;
  unknownReason?: string;
  /** True for conversations that existed before provider evidence was captured. */
  historical?: boolean;
  source?: string;
  medium?: string;
  campaignName?: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  creativeId?: string;
  ctwaClid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
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
 * Builds the attributes a conversation should carry. Empty values are dropped,
 * so nothing is ever cleared in Chatwoot.
 */
export function buildChatwootAttributionAttributes(
  facts: ChatwootAttributionFacts,
): ChatwootAttributionAttributes {
  const method = clean(facts.attributionMethod);
  const channel = chatwootDestinationChannel(clean(facts.channel));
  const base = {
    attribution_channel: channel === "unknown" ? "" : channel,
    engosoft_branch: clean(facts.branch),
  };

  if (!hasAttributionEvidence(method)) {
    const reason = clean(facts.unknownReason);
    return compact({
      ...base,
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
  return compact({
    ...base,
    attribution_method: method,
    attribution_confidence: clean(facts.confidence) || "unknown",
    attribution_unknown_reason: clean(facts.unknownReason),
    attribution_source: source === "unknown" ? "" : source,
    attribution_medium: clean(facts.medium),
    attribution_campaign: clean(facts.campaignName) || clean(facts.utmCampaign),
    // Meta identifiers and click IDs come only from a provider referral.
    meta_campaign_id: metaReferral ? clean(facts.campaignId) : "",
    meta_adset_id: metaReferral ? clean(facts.adsetId) : "",
    meta_ad_id: metaReferral ? clean(facts.adId) : "",
    meta_creative_id: metaReferral ? clean(facts.creativeId) : "",
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

/**
 * Returns only the attributes that should change.
 *
 * - Nothing is ever cleared: empty wanted values are skipped.
 * - Inbox facts (channel, branch) only fill an empty attribute, so a manual
 *   value set by an agent survives.
 * - Unknown data never replaces proven attribution.
 * - In backfill mode, markers only fill empty (or `unknown`) attributes.
 */
export function planChatwootAttributionUpdate(
  current: Record<string, unknown>,
  wanted: ChatwootAttributionAttributes,
  mode: "live" | "backfill",
): Record<string, string> {
  const proven = hasProvenChatwootAttribution(current);
  const wantedUnknown = wanted.attribution_method === "unknown";
  const changes: Record<string, string> = {};
  for (const [key, value] of Object.entries(wanted) as [ChatwootAttributionKey, string][]) {
    if (!value) continue;
    const existing = clean(current[key]);
    if (existing === value) continue;
    const fact = FACT_KEYS.includes(key);
    if (fact) {
      if (existing) continue;
    } else {
      if (wantedUnknown && proven) continue;
      if (mode === "backfill" && existing && existing !== "unknown") continue;
    }
    changes[key] = value;
  }
  return changes;
}
