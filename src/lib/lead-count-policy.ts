/**
 * These Odoo sources remain visible in source/inventory reports, but are not
 * acquisition leads for KPI denominators or target achievement. Classify the
 * original source label: an older sourceKey alias merged plain WhatsApp with
 * WhatsApp Broadcast, while only the latter is excluded.
 */
export type ExcludedLeadSource = "recommendation" | "whatsapp_broadcast";

export function excludedLeadSource(source: string): ExcludedLeadSource | null {
  const key = source
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/[\s_–—-]+/g, "");
  if (key === "whatsappbroadcast") return "whatsapp_broadcast";
  if (
    key === "recommendation" ||
    key === "recommendationsales" ||
    key.startsWith("recommendedfrom")
  )
    return "recommendation";
  return null;
}

export function countsAsPotentialLead(source: string): boolean {
  return excludedLeadSource(source) === null;
}
