/**
 * The canonical acquisition vocabulary shared by every adapter.
 *
 * An acquisition event is whatever a provider proves happened: a Meta lead, a
 * Chatwoot conversation, a landing form submission, or a landing visit. They
 * are different entities and are never counted as one another. The provider
 * evidence decides attribution; CRM is only ever joined afterwards.
 */

export const ACQUISITION_ENTITY_TYPES = [
  "meta_lead",
  "chatwoot_conversation",
  "landing_submission",
  "landing_visit",
] as const;

export type AcquisitionEntityType = (typeof ACQUISITION_ENTITY_TYPES)[number];

/**
 * Source types are stored as text so a future adapter (TikTok lead forms,
 * Google lead forms, a new messaging surface) adds a value without a migration.
 */
export const ACQUISITION_SOURCE_TYPES = [
  "meta_instant_form",
  "meta_whatsapp_referral",
  "meta_messenger_referral",
  "meta_instagram_referral",
  "landing_page_form",
  "landing_page_visit",
  "website_chat",
  "direct_or_organic",
  "unknown",
] as const;

export type AcquisitionSourceType = (typeof ACQUISITION_SOURCE_TYPES)[number];

export const DESTINATION_CHANNELS = [
  "meta_instant_form",
  "whatsapp",
  "messenger",
  "instagram_dm",
  "website_chat",
  "landing_page",
  "unknown",
] as const;

export type DestinationChannel = (typeof DESTINATION_CHANNELS)[number];

/**
 * Entity types that represent a new prospect. Landing visits are reported
 * beside them but are not acquisitions: a visit without a submission is traffic.
 */
export const ACQUISITION_COUNTED_ENTITIES: readonly AcquisitionEntityType[] = [
  "meta_lead",
  "chatwoot_conversation",
  "landing_submission",
];

export function chatwootDestinationChannel(channel: string): DestinationChannel {
  switch (channel.trim()) {
    case "Channel::Whatsapp":
      return "whatsapp";
    case "Channel::FacebookPage":
      return "messenger";
    case "Channel::Instagram":
      return "instagram_dm";
    case "Channel::WebWidget":
    case "Channel::Api":
      return "website_chat";
    default:
      return "unknown";
  }
}

const META_REFERRAL_SOURCE: Record<string, AcquisitionSourceType> = {
  meta_whatsapp_referral: "meta_whatsapp_referral",
  meta_messenger_referral: "meta_messenger_referral",
  meta_instagram_referral: "meta_instagram_referral",
};

/**
 * Maps a Chatwoot conversation's stored evidence onto a source type. Only
 * provider referral evidence becomes a Meta source; a channel alone never does,
 * and missing evidence stays `unknown` rather than being called organic.
 */
export function chatwootSourceType(input: {
  attributionMethod: string;
  channel: string;
  confidence: string;
  campaignId: string;
}): AcquisitionSourceType {
  const method = input.attributionMethod.trim();
  if (META_REFERRAL_SOURCE[method]) return META_REFERRAL_SOURCE[method];
  if (method === "meta_referral") {
    const destination = chatwootDestinationChannel(input.channel);
    if (destination === "whatsapp") return "meta_whatsapp_referral";
    if (destination === "messenger") return "meta_messenger_referral";
    if (destination === "instagram_dm") return "meta_instagram_referral";
    return "unknown";
  }
  if (["utm", "signed_tracking_token", "referrer"].includes(method)) return "website_chat";
  if (method === "organic_direct" && input.confidence === "exact") return "direct_or_organic";
  return "unknown";
}

export function metaLeadSourceType(scope: "paid" | "organic" | "unknown"): AcquisitionSourceType {
  if (scope === "paid") return "meta_instant_form";
  if (scope === "organic") return "direct_or_organic";
  return "unknown";
}

/** Exact means provider-issued identifiers resolved the campaign; nothing weaker counts. */
export function isExactAttribution(input: { confidence: string; campaignId: string }): boolean {
  return input.confidence === "exact" && input.campaignId.trim().length > 0;
}
