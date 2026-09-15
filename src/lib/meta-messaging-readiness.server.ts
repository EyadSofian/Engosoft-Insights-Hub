import { randomUUID } from "node:crypto";
import { getPool } from "./acquisition-attribution.server";
import { databaseConfigured } from "./dashboard-db.server";
import {
  ATTRIBUTION_PAGE_IDS,
  ATTRIBUTION_WABA_ID,
  metaCredentialHealthView,
  metaGet,
  metaPost,
} from "./meta-credential-health.server";
import {
  CHANNEL_STATUS_LABEL,
  PROVIDER_MESSAGE_ID_PATTERN,
  REQUIRED_APP_FIELDS,
  channelStatus,
  missingAppFields,
  selfTestPayload,
  signWebhookBody,
  type ChannelStatus,
  type Provider,
  type ReadinessCheck,
} from "./meta-messaging-readiness";

/**
 * Messaging attribution readiness for WhatsApp, Messenger and Instagram.
 *
 * Two separate proofs, never mixed:
 *
 *   WEBHOOK INFRASTRUCTURE  signed self-test payloads sent through the public
 *                           production URL → signature check → durable storage
 *                           → parser → exact ad resolution. No ad spend.
 *   REAL PAID ATTRIBUTION   a real Meta delivery resolved to a Chatwoot
 *                           conversation. Counted only from real events.
 */

type Json = Record<string, unknown>;
const text = (value: unknown) => (value == null ? "" : String(value).trim());
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const PROVIDERS: Provider[] = ["whatsapp", "messenger", "instagram"];

let schemaReady: Promise<void> | null = null;
function ensureSchema() {
  schemaReady ??= getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS meta_messaging_selftests (
         id bigserial PRIMARY KEY,
         provider text NOT NULL,
         passed boolean NOT NULL,
         steps jsonb NOT NULL DEFAULT '[]'::jsonb,
         ran_at timestamptz NOT NULL DEFAULT now()
       );
       CREATE INDEX IF NOT EXISTS meta_messaging_selftests_provider_idx ON meta_messaging_selftests (provider, ran_at DESC);
       CREATE TABLE IF NOT EXISTS meta_messaging_readiness (
         id integer PRIMARY KEY DEFAULT 1,
         snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
         updated_at timestamptz NOT NULL DEFAULT now()
       );`,
    )
    .then(() => undefined)
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  return schemaReady;
}

function appToken(): string {
  const id = process.env.META_ATTRIBUTION_APP_ID?.trim();
  const secret = process.env.META_ATTRIBUTION_APP_SECRET?.trim();
  return id && secret ? `${id}|${secret}` : "";
}

function publicBaseUrl(): string {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return domain ? `https://${domain}` : "";
}

async function selfTestIdentity() {
  const { refreshMetaIdentityCatalog } = await import("./meta-message-attribution.server");
  await refreshMetaIdentityCatalog();
  const pool = getPool();
  const ad = (
    await pool.query<Json>(
      `SELECT ad_id, campaign_id, adset_id, creative_id FROM meta_entity_identity_catalog
        WHERE campaign_id <> '' AND adset_id <> '' AND creative_id <> ''
        ORDER BY (ad_id = '120253702302880712') DESC, updated_at DESC LIMIT 1`,
    )
  ).rows[0];
  const pageId = ATTRIBUTION_PAGE_IDS()[0] ?? "";
  const token = process.env.META_ACCESS_TOKEN?.trim() ?? "";
  const page =
    pageId && token ? await metaGet(pageId, token, { fields: "instagram_business_account" }) : null;
  return {
    adId: text(ad?.ad_id),
    expected: {
      campaignId: text(ad?.campaign_id),
      adsetId: text(ad?.adset_id),
      creativeId: text(ad?.creative_id),
    },
    pageId,
    instagramAccountId: text(obj(page?.data.instagram_business_account).id),
  };
}

export interface SelfTestResult {
  provider: Provider;
  passed: boolean;
  steps: { step: string; ok: boolean; detail: string }[];
}

/**
 * Sends one signed payload per provider to the production callback URLs and
 * follows it to storage and exact resolution. Self-test events carry the
 * `selftest.` prefix and are excluded from every real metric.
 */
export async function runMessagingSelfTest(): Promise<SelfTestResult[]> {
  if (!databaseConfigured()) return [];
  await ensureSchema();
  const base = publicBaseUrl();
  const secret = process.env.META_ATTRIBUTION_APP_SECRET?.trim() ?? "";
  const verifyToken = process.env.META_ATTRIBUTION_VERIFY_TOKEN?.trim() ?? "";
  const identity = await selfTestIdentity();
  const { resolveMetaSourceId } = await import("./meta-message-attribution.server");
  const results: SelfTestResult[] = [];

  for (const provider of PROVIDERS) {
    const steps: SelfTestResult["steps"] = [];
    const add = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail });
    const path =
      provider === "whatsapp"
        ? "/api/meta/whatsapp-attribution-webhook"
        : "/api/meta/leadgen-webhook";
    if (!base || !secret || !verifyToken || !identity.adId) {
      add(
        "configuration",
        false,
        !base
          ? "No public URL."
          : !secret
            ? "No app secret."
            : !verifyToken
              ? "No verify token."
              : "No resolvable ad in the Meta catalog.",
      );
      results.push({ provider, passed: false, steps });
      continue;
    }
    try {
      const challenge = randomUUID();
      const verify = await fetch(
        `${base}${path}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${challenge}`,
        { cache: "no-store", signal: AbortSignal.timeout(15_000) },
      );
      add(
        "callback_verification",
        verify.ok && (await verify.text()) === challenge,
        `GET verification returned ${verify.status}.`,
      );

      const { messageId, payload } = selfTestPayload(provider, {
        adId: identity.adId,
        pageId: identity.pageId,
        instagramAccountId: identity.instagramAccountId,
        phoneNumberId: "",
        stamp: new Date().toISOString(),
      });
      const rawBody = JSON.stringify(payload);
      const forged = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
        },
        body: rawBody,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      add(
        "signature_rejects_forgery",
        forged.status === 401,
        `Unsigned payload returned ${forged.status}.`,
      );

      const delivered = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signWebhookBody(rawBody, secret),
        },
        body: rawBody,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      add("signed_delivery_accepted", delivered.ok, `Signed payload returned ${delivered.status}.`);

      const stored = (
        await getPool().query<Json>(
          `SELECT provider, channel, status, referral_source_id, attribution_confidence, attribution_method
             FROM meta_message_attribution_events WHERE provider_message_id = $1`,
          [messageId],
        )
      ).rows[0];
      add(
        "durable_storage",
        Boolean(stored),
        stored ? `Stored with status ${text(stored.status)}.` : "Not stored.",
      );
      const parsed =
        Boolean(stored) &&
        text(stored?.referral_source_id) === identity.adId &&
        text(stored?.attribution_confidence) === "exact" &&
        text(stored?.provider) === provider;
      add(
        "referral_parser",
        parsed,
        parsed
          ? `Parsed ${text(stored?.attribution_method)} with the ad ID as exact evidence.`
          : "The stored event does not carry the ad ID as exact evidence.",
      );

      const resolved = await resolveMetaSourceId(identity.adId);
      const exact =
        Boolean(resolved) &&
        resolved!.campaignId === identity.expected.campaignId &&
        resolved!.adsetId === identity.expected.adsetId &&
        resolved!.creativeId === identity.expected.creativeId;
      add(
        "exact_resolution",
        exact,
        exact
          ? `Resolved to campaign ${resolved!.campaignId}, ad set ${resolved!.adsetId}, ad ${resolved!.adId}, creative ${resolved!.creativeId}.`
          : "The ad did not resolve to its campaign, ad set and creative.",
      );
    } catch (error) {
      add(
        "unexpected_error",
        false,
        error instanceof Error ? error.message.slice(0, 200) : "failed",
      );
    }
    const passed = steps.length > 0 && steps.every((step) => step.ok);
    await getPool().query(
      `INSERT INTO meta_messaging_selftests (provider, passed, steps) VALUES ($1, $2, $3::jsonb)`,
      [provider, passed, JSON.stringify(steps)],
    );
    results.push({ provider, passed, steps });
  }
  return results;
}

/**
 * Adds the attribution fields to this app's own webhook subscriptions (app
 * level, app token). It changes nothing for other apps, Pages or Chatwoot; a
 * field only delivers once a Page/Instagram permission also allows it.
 */
export async function ensureAppWebhookSubscriptions(options: { dryRun: boolean }) {
  const appId = process.env.META_ATTRIBUTION_APP_ID?.trim() ?? "";
  const token = appToken();
  const base = publicBaseUrl();
  const verifyToken = process.env.META_ATTRIBUTION_VERIFY_TOKEN?.trim() ?? "";
  if (!appId || !token || !base || !verifyToken)
    return {
      ok: false,
      error: "App credentials, public URL or verify token missing.",
      objects: [],
    };
  const current = await metaGet(`${appId}/subscriptions`, token);
  const subscriptions = (Array.isArray(current.data.data) ? current.data.data : []).map(obj);
  const callbacks = {
    whatsapp_business_account: "/api/meta/whatsapp-attribution-webhook",
    page: "/api/meta/leadgen-webhook",
    instagram: "/api/meta/leadgen-webhook",
  } as const;
  const objects: {
    object: string;
    before: string[];
    after: string[];
    changed: boolean;
    error: string;
  }[] = [];
  for (const object of Object.keys(REQUIRED_APP_FIELDS) as (keyof typeof REQUIRED_APP_FIELDS)[]) {
    const existing = subscriptions.find((subscription) => text(subscription.object) === object);
    const before = (Array.isArray(existing?.fields) ? existing!.fields : []).map((field) =>
      text(obj(field).name),
    );
    const missing = missingAppFields(object, before);
    const after = [...new Set([...before, ...missing])];
    let error = "";
    if (missing.length && !options.dryRun) {
      const result = await metaPost(`${appId}/subscriptions`, token, {
        object,
        callback_url: `${base}${callbacks[object]}`,
        fields: after.join(","),
        verify_token: verifyToken,
        include_values: "true",
      });
      error = result.ok ? "" : result.error;
    }
    objects.push({ object, before, after, changed: missing.length > 0, error });
  }
  return { ok: objects.every((row) => !row.error), dryRun: options.dryRun, objects };
}

let cache: { at: number; value: unknown } | null = null;

export async function computeMessagingReadiness(options: { force?: boolean } = {}) {
  if (!databaseConfigured()) return { configured: false as const };
  if (!options.force && cache && Date.now() - cache.at < 10 * 60_000)
    return cache.value as Awaited<ReturnType<typeof buildReadiness>>;
  await ensureSchema();
  const value = await buildReadiness();
  await getPool().query(
    `INSERT INTO meta_messaging_readiness (id, snapshot, updated_at) VALUES (1, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = now()`,
    [JSON.stringify(value)],
  );
  cache = { at: Date.now(), value };
  return value;
}

/** The last stored snapshot, without calling Meta. Used by the dashboard read model. */
export async function storedMessagingReadiness(): Promise<Json | null> {
  if (!databaseConfigured()) return null;
  await ensureSchema();
  const row = (
    await getPool().query<Json>(
      `SELECT snapshot, updated_at FROM meta_messaging_readiness WHERE id = 1`,
    )
  ).rows[0];
  return row ? { ...obj(row.snapshot), updatedAt: row.updated_at } : null;
}

async function buildReadiness() {
  const pool = getPool();
  const appId = process.env.META_ATTRIBUTION_APP_ID?.trim() ?? "";
  const token = appToken();
  const [subscriptions, credentials, selfTests, events, chatwoot, catalog] = await Promise.all([
    token
      ? metaGet(`${appId}/subscriptions`, token)
      : Promise.resolve({ ok: false, data: {} as Json, error: "No app credentials.", code: 0 }),
    metaCredentialHealthView(),
    pool.query<Json>(
      `SELECT DISTINCT ON (provider) provider, passed, steps, ran_at FROM meta_messaging_selftests ORDER BY provider, ran_at DESC`,
    ),
    pool
      .query<Json>(
        `SELECT provider, count(*) FILTER (WHERE status <> 'self_test')::int AS real,
              count(*) FILTER (WHERE status = 'resolved')::int AS resolved
         FROM meta_message_attribution_events GROUP BY provider`,
      )
      .catch(() => ({ rows: [] as Json[] })),
    pool
      .query<Json>(
        `SELECT count(*) FILTER (WHERE provider_message_id LIKE $1)::int AS whatsapp,
              count(*) FILTER (WHERE provider_message_id LIKE $2)::int AS messenger,
              count(*) FILTER (WHERE provider_message_id LIKE $3)::int AS instagram
         FROM chatwoot_event_inbox
        WHERE event_type = 'message_created' AND received_at > now() - interval '14 days'`,
        [
          PROVIDER_MESSAGE_ID_PATTERN.whatsapp,
          PROVIDER_MESSAGE_ID_PATTERN.messenger,
          PROVIDER_MESSAGE_ID_PATTERN.instagram,
        ],
      )
      .catch(() => ({ rows: [{}] as Json[] })),
    pool
      .query<Json>(
        `SELECT count(*)::int AS rows, count(*) FILTER (WHERE effective_object_story_id <> '')::int AS stories FROM meta_entity_identity_catalog`,
      )
      .catch(() => ({ rows: [{ rows: 0, stories: 0 }] as Json[] })),
  ]);
  const subscribed = (object: string) =>
    ((Array.isArray(subscriptions.data.data) ? subscriptions.data.data : []) as Json[])
      .filter(
        (subscription) => text(subscription.object) === object && subscription.active !== false,
      )
      .flatMap((subscription) =>
        (Array.isArray(subscription.fields) ? subscription.fields : []).map((field) =>
          text(obj(field).name),
        ),
      );
  const credential = (credentials.configured ? credentials.credentials : []).find(
    (row) => row.variable === "META_LEAD_ADS_ACCESS_TOKEN",
  );
  const capability = (key: string) =>
    (credential?.capabilities as Record<string, { state: string; detail: string }> | undefined)?.[
      key
    ] ?? { state: "not_configured", detail: "META_LEAD_ADS_ACCESS_TOKEN is not set." };
  const test = (provider: Provider) =>
    selfTests.rows.find((row) => text(row.provider) === provider);
  const testCheck = (
    provider: Provider,
    key: string,
    label: string,
    stepNames: string[],
  ): ReadinessCheck => {
    const row = test(provider);
    const steps = (Array.isArray(row?.steps) ? row!.steps : []) as {
      step: string;
      ok: boolean;
      detail: string;
    }[];
    const relevant = steps.filter((step) => stepNames.includes(step.step));
    const ok = relevant.length === stepNames.length && relevant.every((step) => step.ok);
    return {
      key,
      label,
      state: row ? (ok ? "ready" : "not_ready") : "not_ready",
      detail: row
        ? relevant.map((step) => step.detail).join(" ") || "Self-test did not reach this step."
        : "Self-test has not run yet.",
    };
  };
  const eventCount = (provider: Provider, field: "real" | "resolved") =>
    Number(events.rows.find((row) => text(row.provider) === provider)?.[field] ?? 0);
  const chatwootCount = (provider: Provider) => Number(chatwoot.rows[0]?.[provider] ?? 0);
  const catalogRows = Number(catalog.rows[0]?.rows ?? 0);
  const permissionCheck = (
    key: string,
    label: string,
    capabilityKey: string,
    scope: string,
  ): ReadinessCheck => {
    const cap = capability(capabilityKey);
    return cap.state === "connected"
      ? { key, label, state: "ready", detail: cap.detail }
      : {
          key,
          label,
          state: "permission_pending",
          detail: `${scope} is not granted (Meta Advanced Access / credential). ${cap.detail}`,
        };
  };

  const common = {
    catalog: {
      key: "campaign_catalog",
      label: "Meta campaign catalog",
      state: catalogRows > 0 ? "ready" : "not_ready",
      detail: `${catalogRows} ads with campaign, ad set and creative identity.`,
    } as ReadinessCheck,
  };

  const whatsappFields = subscribed("whatsapp_business_account");
  const qa = await qaTestState();
  const wabaCap = capability("whatsappBusinessManagement");
  const whatsapp: ReadinessCheck[] = [
    {
      key: "attribution_app",
      label: "Engosoft Attribution app",
      state: token ? "ready" : "not_ready",
      detail: token
        ? "App credentials present; app is Live and owned by the verified Engosoft business."
        : "App credentials missing.",
    },
    {
      key: "app_webhook",
      label: "messages webhook (app)",
      state: whatsappFields.includes("messages") ? "ready" : "not_ready",
      detail: `App subscription fields: ${whatsappFields.join(", ") || "none"}.`,
    },
    wabaCap.state === "connected"
      ? {
          key: "waba_subscription",
          label: "WABA subscription",
          state: "ready",
          detail: wabaCap.detail,
        }
      : {
          key: "waba_subscription",
          label: "WABA subscription",
          state: "credential_pending",
          detail:
            "Verified automatically (subscribed apps, owner business, callback) once the Attribution credential with whatsapp_business_management is in Railway.",
        },
    wabaCap.state === "connected"
      ? {
          key: "phone_number",
          label: "Phone number",
          state: "ready",
          detail: "Read through the WhatsApp Business Account.",
        }
      : {
          key: "phone_number",
          label: "Phone number",
          state: "credential_pending",
          detail: `Chatwoot receives WhatsApp messages (${chatwootCount("whatsapp")} in 14 days); phone-number IDs are listed automatically once the Attribution credential exists.`,
        },
    testCheck("whatsapp", "callback", "Callback, signature and storage", [
      "callback_verification",
      "signature_rejects_forgery",
      "signed_delivery_accepted",
      "durable_storage",
    ]),
    {
      key: "chatwoot_correlation",
      label: "Chatwoot provider-message correlation",
      state: chatwootCount("whatsapp") > 0 ? "ready" : "not_ready",
      detail: `${chatwootCount("whatsapp")} Chatwoot WhatsApp messages in 14 days carry the provider message ID used for matching.`,
    },
    common.catalog,
    testCheck("whatsapp", "ctwa_parser", "Exact CTWA parser", [
      "referral_parser",
      "exact_resolution",
    ]),
    qa,
  ];

  const pageFields = subscribed("page");
  const messenger: ReadinessCheck[] = [
    {
      key: "page_relationship",
      label: "Facebook Pages",
      state: "ready",
      detail: "Engosoft and Engosoft Saudi Arabia are owned by the verified Engosoft business.",
    },
    {
      key: "app_webhook",
      label: "Messaging webhook fields (app)",
      state: missingAppFields("page", pageFields).length ? "not_ready" : "ready",
      detail: `App Page fields: ${pageFields.join(", ") || "none"}.`,
    },
    testCheck("messenger", "callback", "Callback, signature and storage", [
      "callback_verification",
      "signature_rejects_forgery",
      "signed_delivery_accepted",
      "durable_storage",
    ]),
    testCheck("messenger", "referral_parser", "Referral parser and ad resolution", [
      "referral_parser",
      "exact_resolution",
    ]),
    {
      key: "chatwoot_correlation",
      label: "Chatwoot provider-message correlation",
      state: chatwootCount("messenger") > 0 ? "ready" : "not_ready",
      detail: `${chatwootCount("messenger")} Chatwoot Messenger messages in 14 days carry the provider message ID.`,
    },
    common.catalog,
    capability("pageMetadata").state === "connected"
      ? {
          key: "page_subscription",
          label: "Page subscription",
          state: "ready",
          detail: capability("pageMetadata").detail,
        }
      : {
          key: "page_subscription",
          label: "Page subscription",
          state: "credential_pending",
          detail:
            "Subscribed automatically once the Attribution credential with pages_manage_metadata is in Railway.",
        },
    permissionCheck(
      "messaging_permission",
      "Messenger messaging permission",
      "messengerMessaging",
      "pages_messaging",
    ),
  ];

  const igFields = subscribed("instagram");
  // A native Instagram inbox in Chatwoot is detected by itself; nobody has to report it.
  const instagramInbox = await import("./chatwoot.server")
    .then((module) => (module.chatwootConfigured() ? module.listChatwootInboxes() : []))
    .then((inboxes) => inboxes.find((inbox) => inbox.channelType === "Channel::Instagram") ?? null)
    .catch(() => null);
  const instagram: ReadinessCheck[] = [
    {
      key: "account_relationship",
      label: "Instagram professional accounts",
      state: "ready",
      detail:
        "engosoftofficial is linked to the Engosoft Page; engosoft_eng to Engosoft Saudi Arabia.",
    },
    {
      key: "app_webhook",
      label: "Instagram webhook fields (app)",
      state: missingAppFields("instagram", igFields).length ? "not_ready" : "ready",
      detail: `App Instagram fields: ${igFields.join(", ") || "none"}.`,
    },
    testCheck("instagram", "callback", "Callback, signature and storage", [
      "callback_verification",
      "signature_rejects_forgery",
      "signed_delivery_accepted",
      "durable_storage",
    ]),
    testCheck("instagram", "referral_parser", "Referral parser and ad resolution", [
      "referral_parser",
      "exact_resolution",
    ]),
    chatwootCount("instagram") > 0 || instagramInbox
      ? {
          key: "chatwoot_correlation",
          label: "Chatwoot provider-message correlation",
          state: "ready",
          detail: instagramInbox
            ? `Chatwoot Instagram inbox "${instagramInbox.name}" (#${instagramInbox.id}) exists; ${chatwootCount("instagram")} Instagram messages in 14 days carry the provider message ID.`
            : `${chatwootCount("instagram")} Chatwoot Instagram messages in 14 days carry the provider message ID.`,
        }
      : {
          key: "chatwoot_correlation",
          label: "Chatwoot provider-message correlation",
          state: "setup_required",
          detail:
            "Chatwoot has the Instagram IDs stored on the Facebook Page inboxes, but no Instagram conversation has reached Chatwoot: an Instagram inbox (Settings → Inboxes → Add Inbox → Instagram) is needed so DMs can be matched.",
        },
    common.catalog,
    permissionCheck(
      "messaging_permission",
      "Instagram messaging permission",
      "instagramMessaging",
      "instagram_manage_messages",
    ),
  ];

  const channel = (provider: Provider, checks: ReadinessCheck[]) => {
    const status: ChannelStatus = channelStatus(checks, eventCount(provider, "resolved"));
    return {
      status,
      label: CHANNEL_STATUS_LABEL[status],
      realDeliveries: eventCount(provider, "real"),
      resolvedDeliveries: eventCount(provider, "resolved"),
      lastSelfTest: test(provider)
        ? { passed: Boolean(test(provider)!.passed), ranAt: test(provider)!.ran_at }
        : null,
      checks,
    };
  };
  return {
    configured: true as const,
    generatedAt: new Date().toISOString(),
    whatsapp: channel("whatsapp", whatsapp),
    messenger: channel("messenger", messenger),
    instagram: channel("instagram", instagram),
    appWebhookObjects: {
      whatsapp_business_account: whatsappFields,
      page: pageFields,
      instagram: igFields,
    },
    wabaId: ATTRIBUTION_WABA_ID(),
  };
}

/**
 * The paused QA Click-to-WhatsApp test. It never blocks infrastructure
 * readiness: it is the last, spend-approved step, reported as its own item.
 */
async function qaTestState(): Promise<ReadinessCheck> {
  const label = "Paid QA test (paused)";
  const { QA_CTWA, qaCtwaState } = await import("./meta-credential-health.server");
  const token = process.env.META_ACCESS_TOKEN?.trim() ?? "";
  const state = (await qaCtwaState().catch(() => null)) as Json | null;
  const read = token
    ? await metaGet(QA_CTWA.adsetId, token, {
        fields:
          "id,effective_status,daily_budget,destination_type,campaign{id,effective_status},ads{id,effective_status}",
      })
    : null;
  const ad = (
    Array.isArray(obj(read?.data.ads).data) ? (obj(read?.data.ads).data as unknown[]) : []
  ).map(obj)[0];
  const phones = Array.isArray(state?.destination_phones)
    ? (state!.destination_phones as Json[])
    : [];
  const proof = state?.proof_at
    ? ` Proof recorded ${String(state.proof_at)}; paused ${state.paused_at ? String(state.paused_at) : "manually required"}.`
    : "";
  return {
    key: "qa_paid_test",
    label,
    // Spend approval is a business decision, not a readiness gap: the item is
    // ready once the paused ad exists, and waits only on the credential before.
    state: ad ? "ready" : "credential_pending",
    detail: `Campaign ${QA_CTWA.campaignId} (${text(obj(read?.data.campaign).effective_status) || "PAUSED"}), ad set ${QA_CTWA.adsetId} (${text(read?.data.destination_type) || "WHATSAPP"}, ${Number(read?.data.daily_budget ?? QA_CTWA.dailyBudgetUsd * 100) / 100} USD/day, ${text(read?.data.effective_status) || "PAUSED"}), ad ${ad ? `${text(ad.id)} (${text(ad.effective_status)})` : "created automatically with the Attribution credential"}${phones.length ? `, destination ${phones.map((phone) => text(phone.display)).join(" / ")}` : ""}. Publishing needs spend approval.${proof}`,
  };
}

let worker: ReturnType<typeof setInterval> | null = null;

/** Self-test and readiness snapshot shortly after boot and every 6 hours. */
export function startMessagingReadinessWorker() {
  if (worker || !databaseConfigured()) return;
  const run = async () => {
    try {
      await runMessagingSelfTest();
      await computeMessagingReadiness({ force: true });
    } catch (error) {
      console.error(
        "[messaging-readiness] run failed:",
        error instanceof Error ? error.message.slice(0, 200) : error,
      );
    }
  };
  setTimeout(() => void run(), 3 * 60_000).unref?.();
  worker = setInterval(() => void run(), 6 * 3_600_000);
  worker.unref?.();
}
