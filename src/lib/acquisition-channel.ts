import type { AcquisitionChannel, Platform } from "./types";

/** CRM/Odoo source keys that unambiguously identify a paid ad platform. */
export const PLATFORM_SOURCE_KEYS: Record<Platform, string[]> = {
  meta: ["facebook", "instagram", "fb", "ig", "meta"],
  snapchat: ["snapchat", "snap"],
  tiktok: ["tiktok", "tik tok"],
  google: ["google", "google ads", "adwords", "youtube"],
};

/**
 * Odoo does not currently use a literal `utm.source = Organic`. Instead, its
 * real 2026 records carry the concrete origin (Website, UChat, WhatsApp,
 * recommendation, phone, webinar, landing page, and so on). Organic reporting
 * is therefore the non-empty source population that is not a paid platform or
 * a generic paid marker. This keeps new organic source variants visible without
 * maintaining a brittle allow-list every time Operations adds one in Odoo.
 */
const PAID_SOURCE_KEYS = new Set([
  ...Object.values(PLATFORM_SOURCE_KEYS).flat(),
  "ads",
  "ad",
  "paid",
  "paid ads",
  "cpc",
  "ppc",
  "sem",
]);

const sourceKey = (value: string): string => value.trim().toLocaleLowerCase("en");

export function isOrganicSourceKey(value: string): boolean {
  const key = sourceKey(value);
  return key !== "" && !PAID_SOURCE_KEYS.has(key);
}

export function acquisitionChannel(filters: {
  platform?: Platform;
  channel?: "organic";
}): AcquisitionChannel | undefined {
  return filters.channel === "organic" ? "organic" : filters.platform;
}
