import { authoritativeAccountingUsd } from "./accounting-authority.ts";

export type LegacyAdPlatform = "meta" | "snapchat" | "tiktok";

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function first(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return "";
}

/** Historical ad rows must name their platform; guessing would misprice spend. */
export function legacyAdPlatform(row: Record<string, unknown>): LegacyAdPlatform | null {
  const raw = first(row, ["__platform", "platform", "Platform", "المنصة"]).toLowerCase();
  if (raw.includes("snap")) return "snapchat";
  if (raw.includes("tiktok") || raw.includes("tik tok") || raw.includes("تيك توك")) return "tiktok";
  if (raw.includes("meta") || raw.includes("facebook") || raw.includes("ميتا")) return "meta";
  return null;
}

/**
 * Return the native lead metric only when it is semantically valid.
 *
 * The supplied TikTok history contains a legacy `On-Facebook leads` column.
 * It remains in PostgreSQL for audit but is never reported as TikTok leads.
 */
export function legacyAdLeadValue(
  row: Record<string, unknown>,
  platform: LegacyAdPlatform,
): string | null {
  if (platform === "tiktok") return null;
  const keys =
    platform === "meta"
      ? ["Leads (on facebook Leads)", "Leads (Native)", "Leads"]
      : ["Leads (Native)", "Leads"];
  return first(row, keys) || null;
}

/** Explicit course mapping carried by the 2025 YOY spend workbook. */
export function legacyAdCourseValue(row: Record<string, unknown>): string {
  return first(row, ["Modified Course", "Modified course", "Course", "الدورة"]);
}

/**
 * Historical accounting is immutable at the workbook's recognised USD value.
 * Missing USD fails closed; callers must not re-rate it using today's FX.
 */
export function lockedLegacyAccountingUsd(row: Record<string, unknown>): string {
  return (
    first(row, ["__source_usd_locked", "Source USD", "$ Sales", "USD Paid"]) ||
    authoritativeAccountingUsd(row)
  );
}
