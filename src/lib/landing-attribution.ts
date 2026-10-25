/**
 * The browser and Insights server share this deliberately small attribution
 * vocabulary. It contains no storage, network, or database code, so a landing
 * page can use exactly the same UTM rules without receiving any server secret.
 */
export const LANDING_EVENT_TYPES = ["landing_page_view", "form_started", "form_submitted"] as const;

export type LandingEventType = (typeof LANDING_EVENT_TYPES)[number];
export type AttributionMethod = "utm" | "tracking_token" | "referrer" | "direct" | "unknown";
export type ReferrerType = "search" | "social" | "referral" | "direct" | "unknown";

export interface UtmValues {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
}

export interface ClickIds {
  fbclid: string | null;
  gclid: string | null;
  ttclid: string | null;
}

export interface ParsedAttribution {
  rawUtm: UtmValues;
  normalizedUtm: UtmValues;
  clickIds: ClickIds;
}

const SOURCE_ALIASES: Record<string, string> = {
  fb: "facebook",
  facebook: "facebook",
  ig: "instagram",
  instagram: "instagram",
};
const TRACKING_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
  "ttclid",
]);

function clean(value: string | null): string | null {
  const next = value?.trim().replace(/\s+/g, " ") ?? "";
  return next || null;
}

/** Normalize only presentation-safe spelling. It never fills a missing UTM. */
export function normalizeAttributionValue(value: string | null): string | null {
  const next = clean(value);
  return next ? next.toLocaleLowerCase("en-US") : null;
}

/** The alias list is intentionally finite and reviewable; there is no fuzzy matching. */
export function normalizeUtmSource(value: string | null): string | null {
  const normalized = normalizeAttributionValue(value);
  return normalized ? (SOURCE_ALIASES[normalized] ?? normalized) : null;
}

function readParams(params: URLSearchParams): UtmValues {
  return {
    source: clean(params.get("utm_source")),
    medium: clean(params.get("utm_medium")),
    campaign: clean(params.get("utm_campaign")),
    content: clean(params.get("utm_content")),
    term: clean(params.get("utm_term")),
  };
}

function emptyUtm(): UtmValues {
  return { source: null, medium: null, campaign: null, content: null, term: null };
}

function emptyClickIds(): ClickIds {
  return { fbclid: null, gclid: null, ttclid: null };
}

/**
 * Parse raw tracking evidence from a URL. Invalid or absent URLs are simply
 * evidence-free; callers must not substitute labels such as "direct" here.
 */
export function parseLandingAttribution(url: string): ParsedAttribution {
  try {
    const params = new URL(url).searchParams;
    const rawUtm = readParams(params);
    return {
      rawUtm,
      normalizedUtm: {
        source: normalizeUtmSource(rawUtm.source),
        medium: normalizeAttributionValue(rawUtm.medium),
        campaign: normalizeAttributionValue(rawUtm.campaign),
        content: normalizeAttributionValue(rawUtm.content),
        term: normalizeAttributionValue(rawUtm.term),
      },
      clickIds: {
        fbclid: clean(params.get("fbclid")),
        gclid: clean(params.get("gclid")),
        ttclid: clean(params.get("ttclid")),
      },
    };
  } catch {
    return { rawUtm: emptyUtm(), normalizedUtm: emptyUtm(), clickIds: emptyClickIds() };
  }
}

/**
 * Keep a canonical page URL plus only the evidence this contract is allowed to
 * retain. A landing page may have arbitrary query data (including form state);
 * it must never become telemetry just because it happened to be in the URL.
 */
export function safeLandingPageUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (!TRACKING_QUERY_KEYS.has(key.toLocaleLowerCase("en-US"))) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Referrer queries and fragments are not attribution evidence and may be sensitive. */
export function safeLandingReferrer(value: string | null | undefined): string | null {
  const referrer = clean(value ?? null);
  if (!referrer) return null;
  try {
    const parsed = new URL(referrer);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function hasUtmEvidence(values: UtmValues): boolean {
  return Object.values(values).some(Boolean);
}

export function hasTrackingToken(ids: ClickIds): boolean {
  return Object.values(ids).some(Boolean);
}

export function classifyReferrer(referrer: string | null | undefined): ReferrerType {
  const value = clean(referrer ?? null);
  if (!value) return "direct";
  try {
    const host = new URL(value).hostname.toLocaleLowerCase("en-US");
    if (
      ["google.", "bing.", "yahoo.", "duckduckgo.", "yandex.", "baidu."].some((needle) =>
        host.includes(needle),
      )
    ) {
      return "search";
    }
    if (
      ["facebook.", "instagram.", "tiktok.", "linkedin.", "twitter.", "x.com", "youtube."].some(
        (needle) => host === needle || host.endsWith(`.${needle}`) || host.includes(needle),
      )
    ) {
      return "social";
    }
    return "referral";
  } catch {
    return "unknown";
  }
}

/** UTM evidence is always stronger than a click token, which is stronger than a referrer. */
export function resolveAttributionMethod(
  rawUtm: UtmValues,
  clickIds: ClickIds,
  referrer: string | null | undefined,
): AttributionMethod {
  if (hasUtmEvidence(rawUtm)) return "utm";
  if (hasTrackingToken(clickIds)) return "tracking_token";
  const referrerType = classifyReferrer(referrer);
  if (referrerType === "direct") return "direct";
  if (referrerType === "unknown") return "unknown";
  return "referrer";
}

export interface LandingTouch {
  landingPageId: string;
  landingPageName: string | null;
  landingPageSlug: string | null;
  landingPageUrl: string;
  landingPagePath: string;
  rawUtm: UtmValues;
  normalizedUtm: UtmValues;
  clickIds: ClickIds;
  referrer: string | null;
  referrerType: ReferrerType;
  attributionMethod: AttributionMethod;
}

export function makeLandingTouch(input: {
  landingPageId: string;
  landingPageName?: string | null;
  landingPageSlug?: string | null;
  landingPageUrl: string;
  landingPagePath: string;
  referrer?: string | null;
}): LandingTouch {
  const landingPageUrl = safeLandingPageUrl(input.landingPageUrl) ?? input.landingPageUrl;
  const parsed = parseLandingAttribution(landingPageUrl);
  const referrer = safeLandingReferrer(input.referrer);
  return {
    landingPageId: input.landingPageId,
    landingPageName: clean(input.landingPageName ?? null),
    landingPageSlug: clean(input.landingPageSlug ?? null),
    landingPageUrl,
    landingPagePath: input.landingPagePath,
    rawUtm: parsed.rawUtm,
    normalizedUtm: parsed.normalizedUtm,
    clickIds: parsed.clickIds,
    referrer,
    referrerType: classifyReferrer(referrer),
    attributionMethod: resolveAttributionMethod(parsed.rawUtm, parsed.clickIds, referrer),
  };
}
