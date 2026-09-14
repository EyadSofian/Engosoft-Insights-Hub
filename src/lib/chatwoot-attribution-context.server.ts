/**
 * Business context that Engosoft configures explicitly for Chatwoot attribution.
 *
 * Read from `CHATWOOT_ATTRIBUTION_CONTEXT_JSON`, for example:
 *
 *   {
 *     "marketerByCampaignId": { "120250553509150718": "Sayed" },
 *     "customerTypeByInbox": { "29": "website_visitor" }
 *   }
 *
 * The inbox → branch mapping stays in `CHATWOOT_ATTRIBUTION_BRANCH_MAP_JSON`.
 * Nothing here is inferred: a conversation with no configured rule gets no
 * marketer override and a customer type of `unknown`.
 */

interface AttributionContextConfig {
  marketerByCampaignId: Record<string, string>;
  customerTypeByInbox: Record<string, string>;
}

let cached: { raw: string; value: AttributionContextConfig } | null = null;

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key.trim(), typeof item === "string" ? item.trim() : ""])
      .filter(([key, item]) => key && item),
  );
}

export function attributionContextConfig(): AttributionContextConfig {
  const raw = process.env.CHATWOOT_ATTRIBUTION_CONTEXT_JSON || "";
  if (cached?.raw === raw) return cached.value;
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (value && typeof value === "object" && !Array.isArray(value))
      parsed = value as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const value = {
    marketerByCampaignId: stringMap(parsed.marketerByCampaignId),
    customerTypeByInbox: stringMap(parsed.customerTypeByInbox),
  };
  cached = { raw, value };
  return value;
}

/** An explicitly configured marketer for an exact campaign ID, or "". */
export function configuredMarketer(campaignId: string | null | undefined): string {
  const id = String(campaignId || "").trim();
  return id ? attributionContextConfig().marketerByCampaignId[id] || "" : "";
}

/** The configured customer type for an inbox, or "" when no rule exists. */
export function configuredCustomerType(inboxId: number | string | null | undefined): string {
  const id = String(inboxId ?? "").trim();
  return id ? attributionContextConfig().customerTypeByInbox[id] || "" : "";
}

export function customerTypeRulesConfigured(): boolean {
  return Object.keys(attributionContextConfig().customerTypeByInbox).length > 0;
}
