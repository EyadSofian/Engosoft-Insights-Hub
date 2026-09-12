import type { AcquisitionChannel, Platform } from "./types";

export const PLATFORMS: Platform[] = ["meta", "snapchat", "tiktok", "google", "chatgpt"];

export const PLATFORM_LABEL: Record<Platform, { ar: string; en: string }> = {
  meta: { ar: "ميتا", en: "Meta" },
  snapchat: { ar: "سناب شات", en: "Snapchat" },
  tiktok: { ar: "تيك توك", en: "TikTok" },
  google: { ar: "جوجل", en: "Google Ads" },
  chatgpt: { ar: "إعلانات ChatGPT", en: "ChatGPT Ads" },
};

/**
 * Organic deliberately comes first. On narrow screens the acquisition picker
 * scrolls horizontally, so putting it after four paid platforms made the new
 * channel effectively undiscoverable.
 */
export const ACQUISITION_CHANNELS: AcquisitionChannel[] = ["organic", ...PLATFORMS];

export const ACQUISITION_CHANNEL_LABEL: Record<AcquisitionChannel, { ar: string; en: string }> = {
  ...PLATFORM_LABEL,
  organic: { ar: "أورجانيك · Odoo", en: "Organic · Odoo" },
};

/** One colour per platform, shared by the switcher, the charts and every badge. */
export const PLATFORM_COLOR: Record<Platform, string> = {
  meta: "var(--chart-1)",
  snapchat: "var(--chart-2)",
  tiktok: "var(--chart-4)",
  google: "var(--chart-3)",
  chatgpt: "#10a37f",
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
  chatgpt: ["linkClicks", "ctrLink", "viewCompletions"],
};

/**
 * Read the scalable platform map while remaining compatible with snapshots
 * produced before `spendByPlatform` existed.
 */
export function resolveSpendByPlatform(totals: {
  spendByPlatform?: Partial<Record<Platform, number>>;
  spendMeta?: number;
  spendSnap?: number;
  spendTikTok?: number;
  spendGoogle?: number;
}): Record<Platform, number> {
  const legacy: Partial<Record<Platform, number>> = {
    meta: totals.spendMeta,
    snapchat: totals.spendSnap,
    tiktok: totals.spendTikTok,
    google: totals.spendGoogle,
  };
  return Object.fromEntries(
    PLATFORMS.map((platform) => {
      const candidate = totals.spendByPlatform?.[platform] ?? legacy[platform] ?? 0;
      return [platform, Number.isFinite(candidate) ? candidate : 0];
    }),
  ) as Record<Platform, number>;
}

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
