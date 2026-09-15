/**
 * Business-language view of Meta credential capabilities. Pure, so the exact
 * words a manager reads ("Missing leads_retrieval", "Permission pending") are
 * tested. A missing permission is always a sentence, never a zero.
 */

export type CapabilityState = "connected" | "not_connected" | "not_configured";

export interface CapabilitySnapshot {
  configured: boolean;
  valid: boolean;
  scopes: string[];
  capabilities: Record<string, { state: CapabilityState; detail: string }>;
}

/** Every scope the Attribution credential needs, and what each unlocks. */
export const REQUIRED_SCOPES: { scope: string; purpose: string }[] = [
  { scope: "ads_read", purpose: "read campaigns, ads and creatives" },
  { scope: "ads_management", purpose: "prepare the paused QA ad; pause it after proof" },
  { scope: "leads_retrieval", purpose: "read lead forms and lead records" },
  { scope: "pages_manage_metadata", purpose: "subscribe the Pages to webhooks" },
  { scope: "pages_manage_ads", purpose: "list lead forms on the Pages" },
  { scope: "pages_read_engagement", purpose: "read promoted posts and Page details" },
  { scope: "pages_show_list", purpose: "discover the Engosoft Pages" },
  { scope: "business_management", purpose: "read business-owned assets" },
  {
    scope: "whatsapp_business_management",
    purpose: "verify the WABA, phone numbers and subscribed apps",
  },
  {
    scope: "whatsapp_business_messaging",
    purpose: "receive WhatsApp message webhooks for the WABA",
  },
  { scope: "pages_messaging", purpose: "receive Messenger ad referrals (Advanced Access)" },
  {
    scope: "instagram_manage_messages",
    purpose: "receive Instagram DM ad referrals (Advanced Access)",
  },
];

export function missingScopes(scopes: readonly string[]): string[] {
  const granted = new Set(scopes);
  return REQUIRED_SCOPES.map((entry) => entry.scope).filter((scope) => !granted.has(scope));
}

export type RowStatus =
  "connected" | "missing_permission" | "permission_pending" | "credential_not_added";

export interface CapabilityRow {
  key: string;
  label: string;
  status: RowStatus;
  text: string;
}

const ROWS: {
  key: string;
  label: string;
  capability: string;
  scope: string;
  /** Needs Meta App Review rather than a credential scope alone. */
  review?: boolean;
}[] = [
  { key: "ads", label: "Ads", capability: "adsRead", scope: "ads_read" },
  { key: "lead_forms", label: "Lead forms", capability: "leadFormsRead", scope: "leads_retrieval" },
  {
    key: "page_subscriptions",
    label: "Page subscriptions",
    capability: "pageMetadata",
    scope: "pages_manage_metadata",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    capability: "whatsappBusinessManagement",
    scope: "whatsapp_business_management",
  },
  {
    key: "messenger",
    label: "Messenger",
    capability: "messengerMessaging",
    scope: "pages_messaging",
    review: true,
  },
  {
    key: "instagram",
    label: "Instagram",
    capability: "instagramMessaging",
    scope: "instagram_manage_messages",
    review: true,
  },
];

/**
 * One row per business capability, using the best of the credentials the
 * system holds (the Marketing API credential already reads ads; everything
 * else needs the Attribution credential).
 */
export function capabilityRows(credentials: readonly CapabilitySnapshot[]): CapabilityRow[] {
  const attributionAdded = credentials.some(
    (credential, index) => index === 0 && credential.configured,
  );
  return ROWS.map((row) => {
    const connected = credentials.some(
      (credential) =>
        credential.valid && credential.capabilities[row.capability]?.state === "connected",
    );
    if (connected)
      return { key: row.key, label: row.label, status: "connected", text: "Connected" };
    const scopeGranted = credentials.some(
      (credential) => credential.valid && credential.scopes.includes(row.scope),
    );
    if (row.review) {
      return {
        key: row.key,
        label: row.label,
        status: "permission_pending",
        text: scopeGranted
          ? `Permission pending (${row.scope} not yet usable)`
          : `Permission pending (${row.scope})`,
      };
    }
    return {
      key: row.key,
      label: row.label,
      status: attributionAdded ? "missing_permission" : "credential_not_added",
      text: `Missing ${row.scope}`,
    };
  });
}
