import type { Platform } from "./types";

export const PLATFORMS: Platform[] = ["meta", "snapchat"];

export const PLATFORM_LABEL: Record<Platform, { ar: string; en: string }> = {
  meta: { ar: "ميتا", en: "Meta" },
  snapchat: { ar: "سناب شات", en: "Snapchat" },
};

/** Metrics a platform genuinely does not report, so the UI can say so. */
export const PLATFORM_GAPS: Record<Platform, string[]> = {
  meta: [],
  snapchat: ["linkClicks", "ctrLink", "platformLeads"],
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
