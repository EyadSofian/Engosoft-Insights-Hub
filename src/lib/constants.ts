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

export const DASHBOARD_URL = "https://engosoft-insights-hub.up.railway.app";
