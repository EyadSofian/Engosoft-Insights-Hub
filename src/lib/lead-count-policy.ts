/**
 * These Odoo sources remain visible in source/inventory reports, but are not
 * acquisition leads for KPI denominators or target achievement. Classify the
 * original source label and the Odoo lead segment: an older sourceKey alias
 * merged plain WhatsApp with WhatsApp Broadcast, while only the latter is
 * excluded. A broadcast-segment lead is excluded even if its source is Facebook.
 */
export type ExcludedLeadSource = "recommendation" | "whatsapp_broadcast" | "autodialer_broadcast";

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/[\s_–—-]+/g, "");
}

export function excludedLeadSource(source: string, leadSegment = ""): ExcludedLeadSource | null {
  const key = normalized(source);
  const segment = normalized(leadSegment);
  const isAutoDialerBroadcast = (value: string) =>
    value === "autodialerbroadcast" || value === "autodailerbroadcast";
  if (isAutoDialerBroadcast(key) || isAutoDialerBroadcast(segment)) return "autodialer_broadcast";
  const isWhatsAppBroadcast = (value: string) =>
    value === "whatsappbroadcast" || value === "whtsappbroadcast";
  if (isWhatsAppBroadcast(key) || isWhatsAppBroadcast(segment)) return "whatsapp_broadcast";
  const isRecommendation = (value: string) =>
    value === "recommendation" ||
    value === "recommendationsales" ||
    value === "whatsapprecommendation" ||
    value === "whatsapprecommendations" ||
    value === "recommendationwhatsapp" ||
    value.startsWith("recommendedfrom");
  if (isRecommendation(key) || isRecommendation(segment)) return "recommendation";
  return null;
}

export function countsAsPotentialLead(source: string, leadSegment = ""): boolean {
  return excludedLeadSource(source, leadSegment) === null;
}
