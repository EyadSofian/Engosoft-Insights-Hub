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

/**
 * Chatwoot stores its own channel type (`Channel::Whatsapp`), while the Meta
 * listener stores the canonical value (`whatsapp`). Both mean the same inbox.
 */
const CHANNEL_ALIASES: Record<string, DestinationChannel> = {
  "Channel::Whatsapp": "whatsapp",
  "Channel::FacebookPage": "messenger",
  "Channel::Instagram": "instagram_dm",
  "Channel::WebWidget": "website_chat",
  "Channel::Api": "website_chat",
  whatsapp: "whatsapp",
  messenger: "messenger",
  instagram_dm: "instagram_dm",
  website_chat: "website_chat",
};

export function chatwootDestinationChannel(channel: string): DestinationChannel {
  return CHANNEL_ALIASES[channel.trim()] ?? "unknown";
}

/** SQL twin of `chatwootDestinationChannel`, generated from the same table. */
export function chatwootChannelSql(expression: string): string {
  const cases = Object.entries(CHANNEL_ALIASES)
    .map(([alias, channel]) => `WHEN '${alias}' THEN '${channel}'`)
    .join(" ");
  return `(CASE btrim(COALESCE(${expression}, '')) ${cases} ELSE 'unknown' END)`;
}

/**
 * Source platforms are a closed vocabulary. Raw provider values are mapped here,
 * so Meta's `{{site_source_name}}` codes (fb, ig, msg, an) and referrer hosts
 * never reach the dashboard as labels. A value that is present but unrecognised
 * is `other`; no value at all is `unknown`.
 */
export const SOURCE_PLATFORMS = [
  "facebook",
  "instagram",
  "messenger",
  "whatsapp",
  "audience_network",
  "google",
  "tiktok",
  "snapchat",
  "website",
  "direct",
  "other",
  "unknown",
] as const;

export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const PLATFORM_ALIASES: Readonly<Record<string, SourcePlatform>> = {
  facebook: "facebook",
  fb: "facebook",
  "facebook.com": "facebook",
  "m.facebook.com": "facebook",
  "l.facebook.com": "facebook",
  "lm.facebook.com": "facebook",
  "web.facebook.com": "facebook",
  instagram: "instagram",
  ig: "instagram",
  "instagram.com": "instagram",
  "l.instagram.com": "instagram",
  messenger: "messenger",
  msg: "messenger",
  "messenger.com": "messenger",
  whatsapp: "whatsapp",
  wa: "whatsapp",
  "whatsapp.com": "whatsapp",
  audience_network: "audience_network",
  an: "audience_network",
  google: "google",
  "google.com": "google",
  tiktok: "tiktok",
  "tiktok.com": "tiktok",
  snapchat: "snapchat",
  snap: "snapchat",
  "snapchat.com": "snapchat",
  website: "website",
  web: "website",
  site: "website",
  engosoft: "website",
  "engosoft.com": "website",
  direct: "direct",
  "(direct)": "direct",
  other: "other",
  unknown: "unknown",
  meta: "unknown",
  "(not set)": "unknown",
};

export function normalizeSourcePlatform(
  value: string | null | undefined,
  blank: SourcePlatform = "unknown",
): SourcePlatform {
  const key = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!key) return blank;
  return PLATFORM_ALIASES[key] ?? "other";
}

/** SQL twin of `normalizeSourcePlatform`, generated from the same alias table. */
export function sourcePlatformSql(expression: string, blank: SourcePlatform = "unknown"): string {
  const cases = Object.entries(PLATFORM_ALIASES)
    .map(([alias, platform]) => `WHEN '${alias}' THEN '${platform}'`)
    .join(" ");
  return `(CASE regexp_replace(lower(btrim(COALESCE(${expression}, ''))), '^www\\.', '') WHEN '' THEN '${blank}' ${cases} ELSE 'other' END)`;
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

/** One row of the grouped acquisition dataset, exactly as the table shows it. */
export interface AcquisitionGroup {
  entity_type: string;
  source_type: string;
  destination_channel: string;
  source_platform: string;
  events: number;
  exact: number;
  spend_covered: number;
}

export interface AcquisitionCards {
  /** Meta leads + Chatwoot conversations + landing submissions. Landing visits are traffic and excluded. */
  totalEvents: number;
  messagingConversations: number;
  metaInstantFormLeads: number;
  landingVisits: number;
  landingSubmissions: number;
  exactAttribution: number;
  knownSourceEvents: number;
  unknownEvents: number;
  /** Null when no spend data exists to compare against, not when the count is zero. */
  spendCoveredEvents: number | null;
  /** Exact attribution ÷ total events, as a 0–1 ratio. Null only when there are no events. */
  attributionRate: number | null;
  eventsByEntity: Record<string, number>;
  conversationsByChannel: Record<string, number>;
  eventsByPlatform: Record<string, number>;
}

const whole = (value: unknown): number => Math.max(0, Math.round(Number(value) || 0));

function bump(target: Record<string, number>, key: string, value: number) {
  target[key] = (target[key] ?? 0) + value;
}

/**
 * Every headline card is a sum over the grouped rows the table renders, so a
 * card can never disagree with the table beneath it. Landing visits keep their
 * own card but are traffic, not acquisitions, so they stay out of the total,
 * the known/unknown split, exact attribution, spend coverage and the rate.
 */
export function summarizeAcquisitionGroups(
  groups: readonly AcquisitionGroup[],
  options: { spendDataAvailable: boolean },
): AcquisitionCards {
  const cards: AcquisitionCards = {
    totalEvents: 0,
    messagingConversations: 0,
    metaInstantFormLeads: 0,
    landingVisits: 0,
    landingSubmissions: 0,
    exactAttribution: 0,
    knownSourceEvents: 0,
    unknownEvents: 0,
    spendCoveredEvents: options.spendDataAvailable ? 0 : null,
    attributionRate: null,
    eventsByEntity: {},
    conversationsByChannel: {},
    eventsByPlatform: {},
  };
  for (const group of groups) {
    const events = whole(group.events);
    bump(cards.eventsByEntity, group.entity_type, events);
    if (group.entity_type === "landing_visit") cards.landingVisits += events;
    if (!ACQUISITION_COUNTED_ENTITIES.includes(group.entity_type as AcquisitionEntityType))
      continue;

    cards.totalEvents += events;
    cards.exactAttribution += whole(group.exact);
    if (cards.spendCoveredEvents !== null) cards.spendCoveredEvents += whole(group.spend_covered);
    if (group.source_type === "unknown") cards.unknownEvents += events;
    else cards.knownSourceEvents += events;
    bump(cards.eventsByPlatform, group.source_platform || "unknown", events);
    if (group.entity_type === "chatwoot_conversation") {
      cards.messagingConversations += events;
      bump(cards.conversationsByChannel, group.destination_channel || "unknown", events);
    } else if (group.entity_type === "meta_lead") cards.metaInstantFormLeads += events;
    else if (group.entity_type === "landing_submission") cards.landingSubmissions += events;
  }
  cards.attributionRate = cards.totalEvents ? cards.exactAttribution / cards.totalEvents : null;
  return cards;
}
