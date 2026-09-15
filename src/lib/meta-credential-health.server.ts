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
 * What the system does by itself once a working Attribution credential exists.
 * Every step is idempotent and additive: other apps' subscriptions and the
 * Chatwoot WhatsApp callback are never touched.
 */
export async function bootstrapAfterCredential(probe: CredentialProbe): Promise<BootstrapStep[]> {
  const steps: BootstrapStep[] = [];
  const token = process.env[probe.variable]?.trim() ?? "";
  const caps = probe.capabilities;
  const add = (step: string, ok: boolean, detail: string, skipped = false) =>
    steps.push({ step, ok, detail, skipped });

  // 1. Pages the credential can act on.
  const accounts = await metaGet("me/accounts", token, { fields: "id,name,tasks", limit: "100" });
  const pages = (Array.isArray(accounts.data.data) ? accounts.data.data : [])
    .map(obj)
    .filter((page) => ATTRIBUTION_PAGE_IDS().includes(text(page.id)));
  add(
    "discover_pages",
    accounts.ok,
    accounts.ok
      ? `${pages.length} Engosoft Pages available: ${pages.map((page) => text(page.name)).join(", ")}`
      : accounts.error,
  );
  const pageIds = pages.map((page) => text(page.id));

  // 2. Leads Access.
  const withLeads = pages.filter(
    (page) =>
      Array.isArray(page.tasks) && (page.tasks as unknown[]).map(text).includes("MANAGE_LEADS"),
  );
  add(
    "verify_leads_access",
    withLeads.length === pageIds.length && pageIds.length > 0,
    `${withLeads.length} of ${pageIds.length} Pages grant MANAGE_LEADS to this credential.`,
  );

  const leadgen = await import("./meta-leadgen.server");
  // 3. Page webhook fields: leadgen always; messaging fields once messaging is granted.
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
        : `Pages subscribed to: ${["leadgen", ...fields].join(", ")}.`,
    );
  } else {
    add("subscribe_pages", false, "Needs Page Metadata (pages_manage_metadata).", true);
  }

  // 4 + 5. Form catalog and historical lead records.
  if (caps.leadFormsRead.state === "connected" && pageIds.length) {
    const forms = await leadgen.listMetaLeadForms(pageIds);
    add(
      "sync_form_catalog",
      forms.pages.every((page) => !page.error),
      `${forms.forms.length} forms synced with names and status.`,
    );
    const backfill = await leadgen.backfillMetaLeads({
      formIds: forms.forms.map((form) => form.formId),
      dryRun: false,
      maxLeadsPerForm: 500,
    });
    const inserted = backfill.forms.reduce((sum, row) => sum + row.inserted, 0);
    add(
      "historical_form_reconciliation",
      backfill.forms.every((row) => !row.error),
      `${inserted} lead records stored with their form ID (resumable; continues on later runs).`,
    );
  } else {
    add("sync_form_catalog", false, "Needs Lead Forms Read (leads_retrieval).", true);
    add("historical_form_reconciliation", false, "Needs Lead Forms Read (leads_retrieval).", true);
  }

  // 6. WhatsApp Business Account subscription (additive, no callback override).
  if (caps.whatsappBusinessManagement.state === "connected") {
    const appId = process.env.META_ATTRIBUTION_APP_ID?.trim() ?? "";
    const current = await metaGet(`${ATTRIBUTION_WABA_ID()}/subscribed_apps`, token);
    const apps = (Array.isArray(current.data.data) ? current.data.data : []).map(obj);
    const present = apps.some((app) => text(obj(app.whatsapp_business_api_data).id) === appId);
    if (!present) {
      const subscribed = await metaPost(`${ATTRIBUTION_WABA_ID()}/subscribed_apps`, token);
      add(
        "verify_waba_subscription",
        subscribed.ok,
        subscribed.ok
          ? "Attribution app subscribed to the WhatsApp Business Account."
          : subscribed.error,
      );
    } else {
      add(
        "verify_waba_subscription",
        true,
        `Attribution app is one of ${apps.length} apps subscribed to the WhatsApp Business Account.`,
      );
    }
    const phones = await metaGet(`${ATTRIBUTION_WABA_ID()}/phone_numbers`, token, {
      fields: "id,display_phone_number,verified_name,quality_rating",
    });
    add(
      "verify_phone_numbers",
      phones.ok,
      phones.ok
        ? `${(phones.data.data as unknown[] | undefined)?.length ?? 0} phone numbers on the account.`
        : phones.error,
    );
  } else {
    add("verify_waba_subscription", false, "Needs WhatsApp Business Management.", true);
  }

  // 7 + 8. Messenger and Instagram Page subscriptions.
  for (const [step, cap] of [
    ["verify_messenger_subscription", caps.messengerMessaging],
    ["verify_instagram_subscription", caps.instagramMessaging],
  ] as const) {
    if (cap.state !== "connected" || !pageIds[0]) {
      add(step, false, cap.detail, true);
      continue;
    }
    const access = await pageToken(pageIds[0], token);
    const current = await metaGet(`${pageIds[0]}/subscribed_apps`, access);
    const mine = (Array.isArray(current.data.data) ? current.data.data : [])
      .map(obj)
      .find((app) => text(app.id) === (process.env.META_ATTRIBUTION_APP_ID?.trim() ?? ""));
    const fields = Array.isArray(mine?.subscribed_fields)
      ? (mine!.subscribed_fields as unknown[]).map(text)
      : [];
    add(
      step,
      fields.includes("messages"),
      `Attribution app Page fields: ${fields.join(", ") || "none"}.`,
    );
  }

  // 9. The prepared QA Click-to-WhatsApp test: campaign and ad set already exist
  // paused; the creative needs a Live app's credential. Everything stays PAUSED.
  if (probe.scopes.includes("ads_management")) {
    add("prepare_qa_ctwa_ad", ...(await prepareQaCtwaAd(token)));
  } else {
    add("prepare_qa_ctwa_ad", false, "Needs ads_management on the Attribution credential.", true);
  }

  // 10. Diagnostics: the platform self-test and readiness snapshot.
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

export const QA_CTWA = {
  account: "act_405972484493798",
  campaignName: "QA – CTWA attribution test (paused, publish only with approval)",
  pageId: "1500414613618298",
  imageHash: "4aecbb4282891fb0ef5f21bf0c0bccf1",
} as const;

/** Creates the QA creative and a PAUSED ad in the prepared QA ad set, once. */
async function prepareQaCtwaAd(token: string): Promise<[boolean, string]> {
  const campaigns = await metaGet(`${QA_CTWA.account}/campaigns`, token, {
    fields: "id,name,effective_status",
    filtering: JSON.stringify([
      { field: "name", operator: "CONTAIN", value: "QA – CTWA attribution test" },
    ]),
  });
  const campaign = (Array.isArray(campaigns.data.data) ? campaigns.data.data : []).map(obj)[0];
  if (!campaign) return [false, campaigns.error || "The prepared QA campaign was not found."];
  const adsets = await metaGet(`${text(campaign.id)}/adsets`, token, {
    fields: "id,name,effective_status",
  });
  const adset = (Array.isArray(adsets.data.data) ? adsets.data.data : []).map(obj)[0];
  if (!adset) return [false, "The prepared QA ad set was not found."];
  const ads = await metaGet(`${text(adset.id)}/ads`, token, { fields: "id,effective_status" });
  const existing = (Array.isArray(ads.data.data) ? ads.data.data : []).map(obj)[0];
  if (existing)
    return [
      true,
      `QA ad ${text(existing.id)} already prepared (${text(existing.effective_status)}).`,
    ];
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
    adset_id: text(adset.id),
    creative: JSON.stringify({ creative_id: text(creative.data.id) }),
    status: "PAUSED",
  });
  return ad.ok
    ? [
        true,
        `QA ad ${text(ad.data.id)} prepared PAUSED in ad set ${text(adset.id)}; publishing needs explicit approval.`,
      ]
    : [false, ad.error];
}

let worker: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Checks credentials every 10 minutes and bootstraps once per new working credential. */
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
            `SELECT bootstrapped_fingerprint FROM meta_credential_health WHERE variable = $1`,
            [probe.variable],
          )
        ).rows[0];
        if (text(stored?.bootstrapped_fingerprint) === fingerprint) continue;
        const steps = await bootstrapAfterCredential(probe);
        await getPool().query(
          `UPDATE meta_credential_health SET bootstrap = $2::jsonb, bootstrapped_fingerprint = $3, bootstrapped_at = now() WHERE variable = $1`,
          [probe.variable, JSON.stringify(steps), fingerprint],
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

/** Public view: capability states and bootstrap steps. No token, no fingerprint. */
export async function metaCredentialHealthView() {
  if (!databaseConfigured()) return { configured: false as const };
  await ensureSchema();
  const rows = (
    await getPool().query<Json>(
      `SELECT variable, probe, checked_at, bootstrap, bootstrapped_at FROM meta_credential_health ORDER BY variable`,
    )
  ).rows;
  return {
    configured: true as const,
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
      };
    }),
  };
}
