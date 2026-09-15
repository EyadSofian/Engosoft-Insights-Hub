import { createHmac } from "node:crypto";

/**
 * Pure rules for Meta messaging attribution readiness: what the platform
 * self-test sends, how it is signed, and how a checklist becomes a channel
 * status a manager can read. No I/O here, so every rule is tested.
 */

export type Provider = "whatsapp" | "messenger" | "instagram";

export type CheckState =
  /** Verified working in production. */
  | "ready"
  /** Verified not working, or not configured. */
  | "not_ready"
  /** Cannot be checked with the credentials the system holds. */
  | "unverified"
  /** Waiting on a Meta permission / review, not on code or configuration. */
  | "permission_pending"
  /** Verified automatically as soon as the Attribution credential exists. */
  | "credential_pending"
  /** Needs a one-time setup outside this system (for example a Chatwoot inbox). */
  | "setup_required";

export interface ReadinessCheck {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
}

export type ChannelStatus =
  /** Real provider referrals are arriving and resolving. */
  | "connected"
  /** Everything is verified; the channel is waiting for its first real ad-started message. */
  | "infrastructure_ready_awaiting_traffic"
  /** Everything Engosoft controls is verified; only Meta's review is outstanding. */
  | "infrastructure_ready_meta_approval_pending"
  /** Everything Engosoft controls is verified; the Attribution credential completes it. */
  | "infrastructure_ready_credential_pending"
  /** A one-time inbox setup is needed before messages can be matched. */
  | "inbox_setup_required"
  /** Something Engosoft controls is not ready. */
  | "not_connected";

export const CHANNEL_STATUS_LABEL: Record<ChannelStatus, { en: string; ar: string }> = {
  connected: { en: "Connected", ar: "متصل" },
  infrastructure_ready_awaiting_traffic: {
    en: "Infrastructure ready — awaiting first message",
    ar: "البنية جاهزة — بانتظار أول رسالة",
  },
  infrastructure_ready_meta_approval_pending: {
    en: "Infrastructure ready — Meta approval pending",
    ar: "البنية جاهزة — بانتظار موافقة Meta",
  },
  infrastructure_ready_credential_pending: {
    en: "Infrastructure ready — credential pending",
    ar: "البنية جاهزة — بانتظار بيانات الاعتماد",
  },
  inbox_setup_required: { en: "Inbox setup required", ar: "يلزم إعداد صندوق الوارد" },
  not_connected: { en: "Not connected", ar: "غير متصل" },
};

/**
 * A channel is connected only by real deliveries. Otherwise the most
 * significant outstanding item names the status: anything not ready (or not
 * verifiable) → not connected; an inbox to set up; a Meta review; the
 * Attribution credential; nothing left → awaiting traffic.
 */
export function channelStatus(
  checks: readonly ReadinessCheck[],
  realResolvedDeliveries: number,
): ChannelStatus {
  if (realResolvedDeliveries > 0) return "connected";
  const has = (state: CheckState) => checks.some((check) => check.state === state);
  if (has("not_ready") || has("unverified")) return "not_connected";
  if (has("setup_required")) return "inbox_setup_required";
  if (has("permission_pending")) return "infrastructure_ready_meta_approval_pending";
  if (has("credential_pending")) return "infrastructure_ready_credential_pending";
  return "infrastructure_ready_awaiting_traffic";
}

export const SELF_TEST_PREFIX = "selftest.";

export interface SelfTestIdentity {
  adId: string;
  pageId: string;
  instagramAccountId: string;
  phoneNumberId: string;
  stamp: string;
}

/**
 * One webhook payload per provider, shaped exactly like Meta's own, carrying a
 * real ad ID so resolution is exercised end to end. No customer data: the
 * sender IDs, click ID and message IDs are self-test markers.
 */
export function selfTestPayload(
  provider: Provider,
  identity: SelfTestIdentity,
): {
  messageId: string;
  payload: Record<string, unknown>;
} {
  const seconds = Math.floor(Date.parse(identity.stamp) / 1000) || Math.floor(Date.now() / 1000);
  const suffix = identity.stamp.replace(/[^0-9]/g, "").slice(0, 17);
  if (provider === "whatsapp") {
    const messageId = `${SELF_TEST_PREFIX}wa.${suffix}`;
    return {
      messageId,
      payload: {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "selftest-waba",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: { phone_number_id: identity.phoneNumberId || "selftest-phone" },
                  messages: [
                    {
                      id: messageId,
                      from: "selftest",
                      timestamp: String(seconds),
                      type: "text",
                      referral: {
                        source_id: identity.adId,
                        source_type: "ad",
                        source_url: "https://fb.me/selftest",
                        ctwa_clid: `${SELF_TEST_PREFIX}clid`,
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
  }
  const instagram = provider === "instagram";
  const messageId = `${SELF_TEST_PREFIX}${instagram ? "ig" : "fb"}.${suffix}`;
  const recipient = instagram ? identity.instagramAccountId || "selftest-ig" : identity.pageId;
  return {
    messageId,
    payload: {
      object: instagram ? "instagram" : "page",
      entry: [
        {
          id: recipient,
          time: seconds * 1000,
          messaging: [
            {
              sender: { id: "selftest-sender" },
              recipient: { id: recipient },
              timestamp: seconds * 1000,
              message: {
                mid: messageId,
                referral: {
                  ad_id: identity.adId,
                  source: "ADS",
                  type: "OPEN_THREAD",
                  ...(instagram ? { ads_context_data: { ad_title: "selftest" } } : {}),
                },
              },
            },
          ],
        },
      ],
    },
  };
}

export function signWebhookBody(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

/** Chatwoot keeps each provider's own message ID as the message `source_id`. */
export const PROVIDER_MESSAGE_ID_PATTERN: Record<Provider, string> = {
  whatsapp: "wamid.%",
  messenger: "m\\_%",
  instagram: "aWdf%",
};

/** App-level webhook fields each object needs for attribution (leadgen stays). */
export const REQUIRED_APP_FIELDS: Record<
  "whatsapp_business_account" | "page" | "instagram",
  string[]
> = {
  whatsapp_business_account: ["messages"],
  page: ["leadgen", "messages", "messaging_referrals", "messaging_postbacks"],
  instagram: ["messages", "messaging_referral", "messaging_postbacks"],
};

/** Which required fields an app subscription is missing. */
export function missingAppFields(
  object: keyof typeof REQUIRED_APP_FIELDS,
  subscribed: readonly string[],
): string[] {
  return REQUIRED_APP_FIELDS[object].filter((field) => !subscribed.includes(field));
}
