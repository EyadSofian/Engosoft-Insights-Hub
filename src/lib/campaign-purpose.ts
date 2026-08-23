export type PaidCampaignPurpose = "website" | "webinar" | "other";

const tokens = (name: string): string[] =>
  name
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);

/** Engosoft routes an explicit `web`, `web con`, or `con` tag to Website. */
export function isWebsiteCampaignName(name: string): boolean {
  const parts = tokens(name);
  return parts.includes("web") || parts.includes("con");
}

/** `con` and `web con` identify a website-conversion campaign. */
export function isWebsiteConversionCampaignName(name: string): boolean {
  const parts = tokens(name);
  return (
    parts.includes("con") ||
    /(^|\s)website\s*conversion(?:s)?(\s|$)/i.test(name.trim().toLowerCase())
  );
}

/** Webinar spend is kept out of the Website bucket and reported on its own. */
export function isWebinarCampaignName(name: string): boolean {
  const parts = tokens(name);
  return parts.includes("webinar") || parts.includes("webinars") || parts.includes("seminar");
}

export function paidCampaignPurpose(name: string): PaidCampaignPurpose {
  if (isWebinarCampaignName(name)) return "webinar";
  if (isWebsiteCampaignName(name)) return "website";
  return "other";
}
