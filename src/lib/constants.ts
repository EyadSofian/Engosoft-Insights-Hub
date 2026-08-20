import type { AcquisitionChannel, Platform } from "./types";

export const PLATFORMS: Platform[] = ["meta", "snapchat", "tiktok", "google"];

export const PLATFORM_LABEL: Record<Platform, { ar: string; en: string }> = {
  meta: { ar: "ميتا", en: "Meta" },
  snapchat: { ar: "سناب شات", en: "Snapchat" },
  tiktok: { ar: "تيك توك", en: "TikTok" },
  google: { ar: "جوجل", en: "Google Ads" },
};

export const ACQUISITION_CHANNELS: AcquisitionChannel[] = [...PLATFORMS, "organic"];

export const ACQUISITION_CHANNEL_LABEL: Record<AcquisitionChannel, { ar: string; en: string }> = {
  ...PLATFORM_LABEL,
  organic: { ar: "أورجانيك", en: "Organic" },
};

/** One colour per platform, shared by the switcher, the charts and every badge. */
export const PLATFORM_COLOR: Record<Platform, string> = {
  meta: "var(--chart-1)",
  snapchat: "var(--chart-2)",
  tiktok: "var(--chart-4)",
  google: "var(--chart-3)",
};

export const ACQUISITION_CHANNEL_COLOR: Record<AcquisitionChannel, string> = {
  ...PLATFORM_COLOR,
  organic: "var(--success)",
};

/** Metrics a platform genuinely does not report, so the UI can say so. */
export const PLATFORM_GAPS: Record<Platform, string[]> = {
  meta: [],
  snapchat: ["linkClicks", "ctrLink"],
  tiktok: ["linkClicks", "ctrLink"],
  google: ["linkClicks", "ctrLink"],
};

/**
 * Public URL of this deployment, used for the link at the end of each report.
 * Read from the environment because it is deployment-specific — a hardcoded
 * guess shipped a dead link in every message. When unset the link is omitted
 * rather than pointing somewhere that 404s.
 */
export function dashboardUrl(): string {
  const raw = process.env.PUBLIC_APP_URL || process.env.DASHBOARD_URL || "";
  return raw.trim().replace(/\/+$/, "");
}
