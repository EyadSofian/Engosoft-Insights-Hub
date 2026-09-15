import { createHash } from "node:crypto";
import { getPool } from "./acquisition-attribution.server";
import { databaseConfigured } from "./dashboard-db.server";
import { redactMetaSecrets } from "./meta-catalog-reconcile";

/**
 * Meta credential health and the automatic bootstrap that follows a new one.
 *
 * Each capability the attribution stack needs is tested with a harmless read.
 * The token itself never leaves this module: not in the response, not in a
 * log, not in the database. Only a short SHA-256 fingerprint is stored, so a
 * changed `META_LEAD_ADS_ACCESS_TOKEN` is noticed and bootstrapped without
 * anyone pressing a button.
 */

type Json = Record<string, unknown>;

export type CapabilityState = "connected" | "not_connected" | "not_configured";
export type CapabilityKey =
  | "adsRead"
  | "leadFormsRead"
  | "pageMetadata"
  | "whatsappBusinessManagement"
  | "messengerMessaging"
  | "instagramMessaging";

export const CAPABILITY_LABEL: Record<CapabilityKey, string> = {
  adsRead: "Meta Ads Read",
  leadFormsRead: "Lead Forms Read",
  pageMetadata: "Page Metadata",
  whatsappBusinessManagement: "WhatsApp Business Management",
  messengerMessaging: "Messenger Messaging",
  instagramMessaging: "Instagram Messaging",
};

export interface CredentialProbe {
  variable: string;
  configured: boolean;
  valid: boolean;
  appMatchesAttributionApp: boolean;
  type: string;
  expiresAt: string | null;
  scopes: string[];
  capabilities: Record<CapabilityKey, { state: CapabilityState; detail: string }>;
  checkedAt: string;
}

const DEFAULT_API_VERSION = "v25.0";
const TIMEOUT_MS = 15_000;

export const ATTRIBUTION_PAGE_IDS = (): string[] =>
  (process.env.META_ATTRIBUTION_PAGE_IDS?.trim() || "1500414613618298,125287657625184")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d{5,32}$/.test(id));
export const ATTRIBUTION_WABA_ID = () =>
  process.env.META_ATTRIBUTION_WABA_ID?.trim() || "1755559891705345";
const AD_ACCOUNT_PROBE = () =>
  process.env.META_ATTRIBUTION_AD_ACCOUNT_ID?.trim() || "act_405972484493798";

const version = () => process.env.META_API_VERSION?.trim() || DEFAULT_API_VERSION;
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown) => (value == null ? "" : String(value).trim());

export function credentialFingerprint(token: string): string {
  return token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : "";
}

function appToken(): string {
  const id = process.env.META_ATTRIBUTION_APP_ID?.trim();
  const secret = process.env.META_ATTRIBUTION_APP_SECRET?.trim();
  return id && secret ? `${id}|${secret}` : "";
}

/** GET a Graph path. Errors come back as data, with every secret redacted. */
export async function metaGet(
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<{ ok: boolean; data: Json; error: string; code: number }> {
  const url = new URL(`https://graph.facebook.com/${version()}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  const secrets = [token, appToken(), process.env.META_ATTRIBUTION_APP_SECRET?.trim() ?? ""];
  const clean = (message: string) =>
    secrets.reduce((out, secret) => redactMetaSecrets(out, secret), message);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = obj(await response.json().catch(() => ({})));
    const error = obj(data.error);
    if (!response.ok || Object.keys(error).length) {
      return {
        ok: false,
        data: {},
        error: clean(text(error.message) || `HTTP ${response.status}`),
        code: Number(error.code) || 0,
      };
    }
    return { ok: true, data, error: "", code: 0 };
  } catch (error) {
    return {
      ok: false,
      data: {},
      error: clean(error instanceof Error ? error.message : String(error)),
      code: 0,
    };
  }
}

export async function metaPost(
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<{ ok: boolean; data: Json; error: string }> {
  const url = new URL(`https://graph.facebook.com/${version()}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  const secrets = [token, appToken(), process.env.META_ATTRIBUTION_APP_SECRET?.trim() ?? ""];
  const clean = (message: string) =>
    secrets.reduce((out, secret) => redactMetaSecrets(out, secret), message);
  try {
    const response = await fetch(url, {
      method: "POST",
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = obj(await response.json().catch(() => ({})));
    const error = obj(data.error);
    if (!response.ok || Object.keys(error).length) {
      return {
        ok: false,
        data: {},
        error: clean(text(error.message) || `HTTP ${response.status}`),
      };
    }
    return { ok: true, data, error: "" };
  } catch (error) {
    return {
      ok: false,
      data: {},
      error: clean(error instanceof Error ? error.message : String(error)),
    };
  }
}

const pageTokenCache = new Map<string, { token: string; at: number; fingerprint: string }>();

async function pageToken(pageId: string, token: string): Promise<string> {
  const fingerprint = credentialFingerprint(token);
  const cached = pageTokenCache.get(pageId);
  if (cached && cached.fingerprint === fingerprint && Date.now() - cached.at < 50 * 60_000)
    return cached.token;
  const result = await metaGet(pageId, token, { fields: "access_token" });
  const value = text(result.data.access_token);
  if (value) pageTokenCache.set(pageId, { token: value, at: Date.now(), fingerprint });
  return value;
}

const state = (ok: boolean, detail: string): { state: CapabilityState; detail: string } => ({
  state: ok ? "connected" : "not_connected",
  detail,
});

/** Tests one credential. Harmless reads only; nothing is created or changed. */
export async function probeMetaCredential(variable: string): Promise<CredentialProbe> {
  const token = process.env[variable]?.trim() ?? "";
  const checkedAt = new Date().toISOString();
  const empty = {
    state: "not_configured" as CapabilityState,
    detail: `${variable} is not set on Railway.`,
  };
  const base: CredentialProbe = {
    variable,
    configured: Boolean(token),
    valid: false,
    appMatchesAttributionApp: false,
    type: "",
    expiresAt: null,
    scopes: [],
    capabilities: {
      adsRead: empty,
      leadFormsRead: empty,
      pageMetadata: empty,
      whatsappBusinessManagement: empty,
      messengerMessaging: empty,
      instagramMessaging: empty,
    },
    checkedAt,
  };
  if (!token) return base;

  // An app token can only inspect its own app's credentials; a credential from
  // another app (the Marketing API app) inspects itself instead.
  let debug = appToken()
    ? await metaGet("debug_token", appToken(), { input_token: token })
    : { ok: false, data: {} as Json, error: "", code: 0 };
  if (!debug.ok || obj(debug.data.data).is_valid !== true) {
    const self = await metaGet("debug_token", token, { input_token: token });
    if (self.ok) debug = self;
  }
  const info = obj(debug.data.data);
  base.valid = info.is_valid === true;
  base.type = text(info.type);
  base.appMatchesAttributionApp =
    text(info.app_id) === (process.env.META_ATTRIBUTION_APP_ID?.trim() ?? "");
  base.expiresAt =
    Number(info.expires_at) > 0 ? new Date(Number(info.expires_at) * 1000).toISOString() : null;
  base.scopes = Array.isArray(info.scopes) ? info.scopes.map(text).filter(Boolean) : [];
  if (!base.valid) {
    const reason = debug.error || "Meta reports the credential as invalid or expired.";
    for (const key of Object.keys(base.capabilities) as CapabilityKey[]) {
      base.capabilities[key] = { state: "not_connected", detail: reason };
    }
    return base;
  }
  const has = (scope: string) => base.scopes.includes(scope);
  const pages = ATTRIBUTION_PAGE_IDS();
  const firstPage = pages[0] ?? "";

  const ads = await metaGet(AD_ACCOUNT_PROBE(), token, { fields: "id" });
  base.capabilities.adsRead = state(ads.ok, ads.ok ? "Reads the Engosoft ad account." : ads.error);

  const pageAccess = firstPage ? await pageToken(firstPage, token) : "";
  if (!pageAccess) {
    const detail = "No Page access token could be derived for the Engosoft Page.";
    base.capabilities.leadFormsRead = state(false, detail);
    base.capabilities.pageMetadata = state(false, detail);
    base.capabilities.messengerMessaging = state(false, detail);
    base.capabilities.instagramMessaging = state(false, detail);
  } else {
    const forms = await metaGet(`${firstPage}/leadgen_forms`, pageAccess, {
      fields: "id",
      limit: "1",
    });
    base.capabilities.leadFormsRead = state(
      forms.ok && has("leads_retrieval"),
      forms.ok
        ? has("leads_retrieval")
          ? "Reads lead forms on the Engosoft Page."
          : "Forms listed, but leads_retrieval is missing."
        : forms.error,
    );
    const subscribed = await metaGet(`${firstPage}/subscribed_apps`, pageAccess);
    base.capabilities.pageMetadata = state(
      subscribed.ok,
      subscribed.ok ? "Reads the Page's webhook subscriptions." : subscribed.error,
    );
    const conversations = has("pages_messaging")
      ? await metaGet(`${firstPage}/conversations`, pageAccess, { fields: "id", limit: "1" })
      : { ok: false, error: "pages_messaging is not granted to this credential." };
    base.capabilities.messengerMessaging = state(
      conversations.ok,
      conversations.ok
        ? "Reads Messenger conversation metadata on the Engosoft Page."
        : conversations.error,
    );
    const igScope = has("instagram_manage_messages") || has("instagram_business_manage_messages");
    const igConversations = igScope
      ? await metaGet(`${firstPage}/conversations`, pageAccess, {
          platform: "instagram",
          fields: "id",
          limit: "1",
        })
      : { ok: false, error: "instagram_manage_messages is not granted to this credential." };
    base.capabilities.instagramMessaging = state(
      igConversations.ok,
      igConversations.ok ? "Reads Instagram DM conversation metadata." : igConversations.error,
    );
  }
  const waba = await metaGet(`${ATTRIBUTION_WABA_ID()}/subscribed_apps`, token);
  base.capabilities.whatsappBusinessManagement = state(
    waba.ok,
    waba.ok ? "Reads the WhatsApp Business Account's app subscriptions." : waba.error,
  );
  return base;
}

let schemaReady: Promise<void> | null = null;
function ensureSchema() {
  schemaReady ??= getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS meta_credential_health (
         variable text PRIMARY KEY,
         fingerprint text NOT NULL DEFAULT '',
         probe jsonb NOT NULL DEFAULT '{}'::jsonb,
         checked_at timestamptz,
         bootstrap jsonb NOT NULL DEFAULT '{}'::jsonb,
         bootstrapped_fingerprint text NOT NULL DEFAULT '',
         bootstrapped_at timestamptz
       );
       ALTER TABLE meta_credential_health ADD COLUMN IF NOT EXISTS bootstrap_fingerprint text NOT NULL DEFAULT '';
       ALTER TABLE meta_credential_health ADD COLUMN IF NOT EXISTS bootstrap_attempted_at timestamptz;
       CREATE TABLE IF NOT EXISTS meta_qa_ctwa_state (
         id integer PRIMARY KEY DEFAULT 1,
         campaign_id text NOT NULL DEFAULT '',
         adset_id text NOT NULL DEFAULT '',
         ad_id text NOT NULL DEFAULT '',
         creative_id text NOT NULL DEFAULT '',
         status text NOT NULL DEFAULT '',
         destination_phones jsonb NOT NULL DEFAULT '[]'::jsonb,
         prepared_at timestamptz,
         proof_at timestamptz,
         proof jsonb NOT NULL DEFAULT '{}'::jsonb,
         paused_at timestamptz,
         pause_error text NOT NULL DEFAULT ''
       );`,
    )
    .then(() => undefined)
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  return schemaReady;
}

const VARIABLES = ["META_LEAD_ADS_ACCESS_TOKEN", "META_ACCESS_TOKEN"] as const;

export async function checkMetaCredentials(options: { force?: boolean } = {}) {
  if (!databaseConfigured()) return { configured: false as const, credentials: [] };
  await ensureSchema();
  const pool = getPool();
  const results: (CredentialProbe & { changed: boolean })[] = [];
  for (const variable of VARIABLES) {
    const fingerprint = credentialFingerprint(process.env[variable]?.trim() ?? "");
    const stored = (
      await pool.query<Json>(
        `SELECT fingerprint, probe, checked_at FROM meta_credential_health WHERE variable = $1`,
        [variable],
      )
    ).rows[0];
    const changed = !stored || text(stored.fingerprint) !== fingerprint;
    const stale =
      !stored?.checked_at ||
      Date.now() - new Date(String(stored.checked_at)).getTime() > 6 * 3_600_000;
    if (!options.force && !changed && !stale) {
      results.push({ ...(obj(stored.probe) as unknown as CredentialProbe), changed: false });
      continue;
    }
    const probe = await probeMetaCredential(variable);
    await pool.query(
      `INSERT INTO meta_credential_health (variable, fingerprint, probe, checked_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (variable) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, probe = EXCLUDED.probe, checked_at = now()`,
      [variable, fingerprint, JSON.stringify(probe)],
    );
    results.push({ ...probe, changed });
  }
  return { configured: true as const, credentials: results };
}

/* --- bootstrap --------------------------------------------------------------- */

export interface BootstrapStep {
  step: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
}

/**
 * Everything the system does by itself once META_LEAD_ADS_ACCESS_TOKEN appears.
 * Each step is idempotent and additive: other apps' subscriptions, the Chatwoot
 * WhatsApp callback and live campaigns are never touched, and the QA ad stays
 * PAUSED. A failed step is retried on a later tick.
 */
export async function bootstrapAfterCredential(probe: CredentialProbe): Promise<BootstrapStep[]> {
  const steps: BootstrapStep[] = [];
  const token = process.env[probe.variable]?.trim() ?? "";
  const caps = probe.capabilities;
  const appId = process.env.META_ATTRIBUTION_APP_ID?.trim() ?? "";
  const add = (step: string, ok: boolean, detail: string, skipped = false) =>
    steps.push({ step, ok, detail, skipped });
  const { missingScopes } = await import("./meta-credential-health");

  // 1–3. Token, app and system user, scopes.
  add(
    "validate_token",
    probe.valid,
    probe.valid
      ? `Valid ${probe.type || "credential"}${probe.expiresAt ? `, expires ${probe.expiresAt}` : ", never expires"}.`
      : "Meta reports the credential as invalid.",
  );
  if (!probe.valid) return steps;
  const me = await metaGet("me", token, { fields: "id,name" });
  add(
    "identify_app_and_system_user",
    probe.appMatchesAttributionApp && me.ok,
    `${probe.appMatchesAttributionApp ? "Issued for Engosoft Attribution" : "Issued for a different app, not Engosoft Attribution"}; identity ${me.ok ? text(me.data.name) || "system user" : me.error}.`,
  );
  const missing = missingScopes(probe.scopes);
  add(
    "validate_scopes",
    missing.length === 0,
    missing.length
      ? `Missing: ${missing.join(", ")}. Available capabilities are used; the rest wait.`
      : "All required scopes granted.",
  );

  // 4–5. Pages and Leads Access.
  const accounts = await metaGet("me/accounts", token, { fields: "id,name,tasks", limit: "100" });
  const pages = (Array.isArray(accounts.data.data) ? accounts.data.data : [])
    .map(obj)
    .filter((page) => ATTRIBUTION_PAGE_IDS().includes(text(page.id)));
  const pageIds = pages.map((page) => text(page.id));
  add(
    "verify_pages",
    accounts.ok && pageIds.length === ATTRIBUTION_PAGE_IDS().length,
    accounts.ok
      ? `${pageIds.length} of ${ATTRIBUTION_PAGE_IDS().length} Engosoft Pages available: ${pages.map((page) => text(page.name)).join(", ")}.`
      : accounts.error,
  );
  const withLeads = pages.filter(
    (page) =>
      Array.isArray(page.tasks) && (page.tasks as unknown[]).map(text).includes("MANAGE_LEADS"),
  );
  add(
    "verify_leads_access",
    pageIds.length > 0 && withLeads.length === pageIds.length,
    `${withLeads.length} of ${pageIds.length} Pages grant MANAGE_LEADS.`,
  );

  const leadgen = await import("./meta-leadgen.server");
  // 6. Page webhook subscriptions (leadgen; messaging once granted).
  if (caps.pageMetadata.state === "connected" && pageIds.length) {
    const fields =
      caps.messengerMessaging.state === "connected"
        ? ["messages", "messaging_referrals", "messaging_postbacks"]
        : [];
    const subscribed = await leadgen.subscribeMetaLeadgenPages(pageIds, { dryRun: false, fields });
    const errors = subscribed.results.filter((result) => result.error);
    add(
      "subscribe_pages",
      errors.length === 0,
      errors.length
        ? errors.map((error) => error.error).join("; ")
        : `Pages subscribed to ${["leadgen", ...fields].join(", ")}.`,
    );
  } else {
    add("subscribe_pages", false, "Waiting for pages_manage_metadata.", true);
  }

  // 7–8. Form names and historical Lead Ads (including CRM leads without an ad ID).
  if (caps.leadFormsRead.state === "connected" && pageIds.length) {
    const forms = await leadgen.listMetaLeadForms(pageIds);
    add(
      "sync_form_names",
      forms.pages.every((page) => !page.error),
      `${forms.forms.length} forms synced with names and status.`,
    );
    const backfill = await leadgen.backfillMetaLeads({
      formIds: forms.forms.map((form) => form.formId),
      dryRun: false,
      maxLeadsPerForm: 500,
    });
    const inserted = backfill.forms.reduce((sum, row) => sum + row.inserted, 0);
    const queued = await leadgen.queueCrmMetaLeadsWithoutAdId();
    add(
      "reconcile_historical_lead_ads",
      backfill.forms.every((row) => !row.error),
      `${inserted} lead records stored with form IDs; ${queued.queued} CRM leads without an ad ID queued for exact lookup by lead ID (resumable).`,
    );
  } else {
    add("sync_form_names", false, "Waiting for leads_retrieval.", true);
    add("reconcile_historical_lead_ads", false, "Waiting for leads_retrieval.", true);
  }

  // 9–11. WhatsApp Business Account, phone numbers, subscription and callback.
  const whatsapp = await verifyWhatsAppBusinessAccount(
    token,
    caps.whatsappBusinessManagement.state === "connected",
  );
  for (const step of whatsapp) steps.push(step);

  // 12–13. Messenger and Instagram subscriptions.
  const appSubscriptions = appToken() ? await metaGet(`${appId}/subscriptions`, appToken()) : null;
  const appFields = (object: string) =>
    ((Array.isArray(appSubscriptions?.data.data) ? appSubscriptions!.data.data : []) as Json[])
      .filter((row) => text(row.object) === object)
      .flatMap((row) =>
        (Array.isArray(row.fields) ? row.fields : []).map((field) => text(obj(field).name)),
      );
  for (const [step, cap, object] of [
    ["verify_messenger_subscriptions", caps.messengerMessaging, "page"],
    ["verify_instagram_subscriptions", caps.instagramMessaging, "instagram"],
  ] as const) {
    const fields = appFields(object);
    let pageFields: string[] = [];
    if (caps.pageMetadata.state === "connected" && pageIds[0]) {
      const access = await pageToken(pageIds[0], token);
      const current = await metaGet(`${pageIds[0]}/subscribed_apps`, access);
      const mine = (Array.isArray(current.data.data) ? current.data.data : [])
        .map(obj)
        .find((app) => text(app.id) === appId);
      pageFields = Array.isArray(mine?.subscribed_fields)
        ? (mine!.subscribed_fields as unknown[]).map(text)
        : [];
    }
    add(
      step,
      fields.includes("messages") && cap.state === "connected",
      `App ${object} fields: ${fields.join(", ") || "none"}; Page fields for this app: ${pageFields.join(", ") || "not readable yet"}; permission: ${cap.state === "connected" ? "granted" : "pending Meta approval"}.`,
      cap.state !== "connected",
    );
  }

  // 14. Credential health refresh.
  await checkMetaCredentials({ force: true }).catch(() => undefined);
  add("refresh_credential_health", true, "Capability rows refreshed.");

  // 15. Resume the Meta catalog reconciliation.
  try {
    const { runMetaCatalogReconcile } = await import("./meta-catalog-reconcile.server");
    const summary = await runMetaCatalogReconcile({ maxAds: 400 });
    add(
      "resume_catalog_reconciliation",
      summary.status !== "failed",
      summary.message || summary.status,
    );
  } catch (error) {
    add(
      "resume_catalog_reconciliation",
      false,
      error instanceof Error ? error.message.slice(0, 200) : "failed",
    );
  }

  // 16. The prepared QA Click-to-WhatsApp ad, PAUSED.
  if (probe.scopes.includes("ads_management")) {
    add("prepare_qa_ctwa_ad", ...(await prepareQaCtwaAd(token)));
  } else {
    add(
      "prepare_qa_ctwa_ad",
      false,
      "Waiting for ads_management on the Attribution credential.",
      true,
    );
  }

  // Diagnostics: platform self-test and readiness snapshot.
  try {
    const readiness = await import("./meta-messaging-readiness.server");
    const selfTest = await readiness.runMessagingSelfTest();
    await readiness.computeMessagingReadiness({ force: true });
    add(
      "run_diagnostics",
      selfTest.every((result) => result.passed),
      selfTest
        .map((result) => `${result.provider}: ${result.passed ? "passed" : "failed"}`)
        .join(", "),
    );
  } catch (error) {
    add(
      "run_diagnostics",
      false,
      error instanceof Error ? error.message.slice(0, 200) : "diagnostics failed",
    );
  }
  return steps;
}

async function verifyWhatsAppBusinessAccount(
  token: string,
  capable: boolean,
): Promise<BootstrapStep[]> {
  if (!capable) {
    return ["verify_waba", "list_phone_numbers", "verify_messages_subscription"].map((step) => ({
      step,
      ok: false,
      skipped: true,
      detail: "Waiting for whatsapp_business_management.",
    }));
  }
  const appId = process.env.META_ATTRIBUTION_APP_ID?.trim() ?? "";
  const waba = ATTRIBUTION_WABA_ID();
  const steps: BootstrapStep[] = [];
  const account = await metaGet(waba, token, {
    fields: "id,name,owner_business_info,account_review_status",
  });
  const owner = obj(account.data.owner_business_info);
  steps.push({
    step: "verify_waba",
    ok: account.ok,
    detail: account.ok
      ? `WABA ${text(account.data.id)} "${text(account.data.name)}", owned by ${text(owner.name) || "unknown"} (${text(owner.id)}${text(owner.id) === "147679829607313" ? ", the Engosoft business" : ", NOT the Engosoft business: Advanced Access is needed for webhooks"}), review ${text(account.data.account_review_status) || "unknown"}.`
      : account.error,
  });
  const phones = await metaGet(`${waba}/phone_numbers`, token, {
    fields: "id,display_phone_number,verified_name,quality_rating,platform_type",
  });
  const numbers = (Array.isArray(phones.data.data) ? phones.data.data : []).map(obj);
  await getPool()
    .query(
      `INSERT INTO meta_qa_ctwa_state (id, destination_phones) VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET destination_phones = EXCLUDED.destination_phones`,
      [
        JSON.stringify(
          numbers.map((number) => ({
            id: text(number.id),
            display: text(number.display_phone_number),
            name: text(number.verified_name),
          })),
        ),
      ],
    )
    .catch(() => undefined);
  steps.push({
    step: "list_phone_numbers",
    ok: phones.ok && numbers.length > 0,
    detail: phones.ok
      ? numbers
          .map(
            (number) =>
              `${text(number.display_phone_number)} (ID ${text(number.id)}, ${text(number.verified_name)})`,
          )
          .join("; ") || "No phone numbers."
      : phones.error,
  });
  const subscribed = await metaGet(`${waba}/subscribed_apps`, token);
  const apps = (Array.isArray(subscribed.data.data) ? subscribed.data.data : []).map(obj);
  let present = apps.some((app) => text(obj(app.whatsapp_business_api_data).id) === appId);
  let detail = `${apps.length} apps subscribed to the WABA; Engosoft Attribution ${present ? "is" : "is not"} one of them.`;
  if (subscribed.ok && !present) {
    const added = await metaPost(`${waba}/subscribed_apps`, token);
    present = added.ok;
    detail += added.ok
      ? " Subscribed it now (no callback override)."
      : ` Subscribing failed: ${added.error}`;
  }
  const appSubscriptions = appToken() ? await metaGet(`${appId}/subscriptions`, appToken()) : null;
  const whatsappObject = (
    (Array.isArray(appSubscriptions?.data.data) ? appSubscriptions!.data.data : []) as Json[]
  ).find((row) => text(row.object) === "whatsapp_business_account");
  const fields = (Array.isArray(whatsappObject?.fields) ? whatsappObject!.fields : []).map(
    (field) => text(obj(field).name),
  );
  const callback = text(whatsappObject?.callback_url).replace(/^https:\/\/[^/]+/, "");
  steps.push({
    step: "verify_messages_subscription",
    ok: subscribed.ok && present && fields.includes("messages") && whatsappObject?.active !== false,
    detail: `${subscribed.ok ? detail : subscribed.error} App object whatsapp_business_account: fields ${fields.join(", ") || "none"}, callback ${callback || "none"}, ${whatsappObject?.active === false ? "inactive" : "active"}.`,
  });
  return steps;
}

export const QA_CTWA = {
  account: "act_405972484493798",
  campaignId: "120254541943490712",
  adsetId: "120254541944970712",
  campaignName: "QA – CTWA attribution test (paused, publish only with approval)",
  pageId: "1500414613618298",
  imageHash: "4aecbb4282891fb0ef5f21bf0c0bccf1",
  dailyBudgetUsd: 3,
} as const;

/** Creates the QA creative and a PAUSED ad in the prepared QA ad set, once. */
async function prepareQaCtwaAd(token: string): Promise<[boolean, string]> {
  const ads = await metaGet(`${QA_CTWA.adsetId}/ads`, token, {
    fields: "id,effective_status,creative{id}",
  });
  const existing = (Array.isArray(ads.data.data) ? ads.data.data : []).map(obj)[0];
  if (existing) {
    await recordQaState({
      adId: text(existing.id),
      creativeId: text(obj(existing.creative).id),
      status: text(existing.effective_status),
    });
    return [
      true,
      `QA ad ${text(existing.id)} already prepared (${text(existing.effective_status)}).`,
    ];
  }
  const creative = await metaPost(`${QA_CTWA.account}/adcreatives`, token, {
    name: "QA – CTWA test creative",
    object_story_spec: JSON.stringify({
      page_id: QA_CTWA.pageId,
      link_data: {
        image_hash: QA_CTWA.imageHash,
        link: "https://api.whatsapp.com/send",
        message: "تحدث مع مستشار Engosoft على واتساب لمعرفة تفاصيل دورة CFM.",
        call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
      },
    }),
  });
  if (!creative.ok) return [false, creative.error];
  const ad = await metaPost(`${QA_CTWA.account}/ads`, token, {
    name: "QA – CTWA test ad (paused)",
    adset_id: QA_CTWA.adsetId,
    creative: JSON.stringify({ creative_id: text(creative.data.id) }),
    status: "PAUSED",
  });
  if (!ad.ok) return [false, ad.error];
  await recordQaState({
    adId: text(ad.data.id),
    creativeId: text(creative.data.id),
    status: "PAUSED",
  });
  return [
    true,
    `QA ad ${text(ad.data.id)} prepared PAUSED in ad set ${QA_CTWA.adsetId}; publishing needs explicit approval.`,
  ];
}

async function recordQaState(input: { adId: string; creativeId: string; status: string }) {
  await getPool()
    .query(
      `INSERT INTO meta_qa_ctwa_state (id, campaign_id, adset_id, ad_id, creative_id, status, prepared_at)
       VALUES (1, $1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO UPDATE SET campaign_id = EXCLUDED.campaign_id, adset_id = EXCLUDED.adset_id,
         ad_id = EXCLUDED.ad_id, creative_id = EXCLUDED.creative_id, status = EXCLUDED.status,
         prepared_at = COALESCE(meta_qa_ctwa_state.prepared_at, now())`,
      [QA_CTWA.campaignId, QA_CTWA.adsetId, input.adId, input.creativeId, input.status],
    )
    .catch(() => undefined);
}

/**
 * Called when a real (not self-test) WhatsApp referral resolves to the QA
 * campaign: records the proof and pauses the QA campaign so the test never keeps
 * spending after it proved the chain. Pausing only ever reduces spend. Set
 * META_QA_AUTO_PAUSE=false to keep it running.
 */
export async function handleQaCtwaProof(input: {
  campaignId: string;
  adId: string;
  creativeId: string;
  providerMessageId: string;
  conversationId: number;
}) {
  if (input.campaignId !== QA_CTWA.campaignId || !databaseConfigured()) return;
  await ensureSchema();
  const pool = getPool();
  const state = (
    await pool.query<Json>(`SELECT proof_at, paused_at FROM meta_qa_ctwa_state WHERE id = 1`)
  ).rows[0];
  if (state?.proof_at) return;
  await pool.query(
    `INSERT INTO meta_qa_ctwa_state (id, campaign_id, proof_at, proof)
     VALUES (1, $1, now(), $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET proof_at = now(), proof = EXCLUDED.proof`,
    [QA_CTWA.campaignId, JSON.stringify(input)],
  );
  if (text(process.env.META_QA_AUTO_PAUSE).toLowerCase() === "false") return;
  const token =
    [process.env.META_LEAD_ADS_ACCESS_TOKEN, process.env.META_ACCESS_TOKEN]
      .map((value) => value?.trim() ?? "")
      .find(Boolean) ?? "";
  if (!token) return;
  const paused = await metaPost(QA_CTWA.campaignId, token, { status: "PAUSED" });
  await pool.query(
    `UPDATE meta_qa_ctwa_state SET paused_at = CASE WHEN $1 THEN now() ELSE paused_at END, pause_error = $2 WHERE id = 1`,
    [paused.ok, paused.ok ? "" : paused.error],
  );
}

export async function qaCtwaState() {
  if (!databaseConfigured()) return null;
  await ensureSchema();
  return (
    (await getPool().query<Json>(`SELECT * FROM meta_qa_ctwa_state WHERE id = 1`)).rows[0] ?? null
  );
}

let worker: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Checks credentials every 10 minutes. A new working Attribution credential is
 * bootstrapped at once; a bootstrap with failed steps is retried hourly until
 * every available step succeeds, and again whenever the credential changes.
 */
export function startMetaCredentialWorker() {
  if (worker || !databaseConfigured()) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const health = await checkMetaCredentials();
      for (const probe of health.credentials) {
        if (probe.variable !== "META_LEAD_ADS_ACCESS_TOKEN" || !probe.valid) continue;
        const fingerprint = credentialFingerprint(process.env[probe.variable]?.trim() ?? "");
        const stored = (
          await getPool().query<Json>(
            `SELECT bootstrapped_fingerprint, bootstrap_attempted_at, bootstrap_fingerprint FROM meta_credential_health WHERE variable = $1`,
            [probe.variable],
          )
        ).rows[0];
        if (text(stored?.bootstrapped_fingerprint) === fingerprint) continue;
        const sameCredential = text(stored?.bootstrap_fingerprint) === fingerprint;
        const attemptedAt = stored?.bootstrap_attempted_at
          ? new Date(String(stored.bootstrap_attempted_at)).getTime()
          : 0;
        if (sameCredential && Date.now() - attemptedAt < 60 * 60_000) continue;
        const steps = await bootstrapAfterCredential(probe);
        const complete = steps.every((step) => step.ok || step.skipped);
        await getPool().query(
          `UPDATE meta_credential_health SET bootstrap = $2::jsonb, bootstrap_fingerprint = $3, bootstrap_attempted_at = now(),
             bootstrapped_fingerprint = CASE WHEN $4 THEN $3 ELSE bootstrapped_fingerprint END,
             bootstrapped_at = CASE WHEN $4 THEN now() ELSE bootstrapped_at END
           WHERE variable = $1`,
          [probe.variable, JSON.stringify(steps), fingerprint, complete],
        );
      }
    } catch (error) {
      console.error(
        "[meta-credential] check failed:",
        error instanceof Error ? error.message.slice(0, 200) : error,
      );
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 60_000).unref?.();
  worker = setInterval(() => void tick(), 10 * 60_000);
  worker.unref?.();
}

/** Public view: business capability rows, per-credential detail and the bootstrap log. No token, no fingerprint. */
export async function metaCredentialHealthView() {
  if (!databaseConfigured()) return { configured: false as const };
  await ensureSchema();
  const rows = (
    await getPool().query<Json>(
      `SELECT variable, probe, checked_at, bootstrap, bootstrapped_at, bootstrap_attempted_at FROM meta_credential_health ORDER BY variable DESC`,
    )
  ).rows;
  const { capabilityRows, missingScopes } = await import("./meta-credential-health");
  const probes = rows.map((row) => obj(row.probe) as unknown as CredentialProbe);
  const attribution = probes.find((probe) => probe.variable === "META_LEAD_ADS_ACCESS_TOKEN");
  const ordered = [
    attribution ?? {
      variable: "META_LEAD_ADS_ACCESS_TOKEN",
      configured: false,
      valid: false,
      scopes: [],
      capabilities: {},
    },
    ...probes.filter((probe) => probe.variable !== "META_LEAD_ADS_ACCESS_TOKEN"),
  ];
  return {
    configured: true as const,
    summary: capabilityRows(
      ordered.map((probe) => ({
        configured: Boolean(probe.configured),
        valid: Boolean(probe.valid),
        scopes: probe.scopes ?? [],
        capabilities: (probe.capabilities ?? {}) as Record<
          string,
          { state: CapabilityState; detail: string }
        >,
      })),
    ),
    attributionCredential: {
      added: Boolean(attribution?.configured),
      valid: Boolean(attribution?.valid),
      issuedForAttributionApp: Boolean(attribution?.appMatchesAttributionApp),
      missingScopes: attribution?.valid ? missingScopes(attribution.scopes ?? []) : [],
    },
    qaCtwa: await qaCtwaState().catch(() => null),
    credentials: rows.map((row) => {
      const probe = obj(row.probe) as unknown as CredentialProbe;
      return {
        variable: text(row.variable),
        configured: Boolean(probe.configured),
        valid: Boolean(probe.valid),
        attributionApp: Boolean(probe.appMatchesAttributionApp),
        type: probe.type ?? "",
        expiresAt: probe.expiresAt ?? null,
        scopes: probe.scopes ?? [],
        capabilities: Object.fromEntries(
          (Object.keys(CAPABILITY_LABEL) as CapabilityKey[]).map((key) => [
            key,
            {
              label: CAPABILITY_LABEL[key],
              ...(probe.capabilities?.[key] ?? { state: "not_configured", detail: "" }),
            },
          ]),
        ),
        checkedAt: row.checked_at,
        bootstrap: row.bootstrap,
        bootstrappedAt: row.bootstrapped_at,
        bootstrapAttemptedAt: row.bootstrap_attempted_at,
      };
    }),
  };
}
