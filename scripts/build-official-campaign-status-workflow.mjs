#!/usr/bin/env node

/**
 * Build the n8n workflow that reads the official campaign status from every
 * advertising platform. Secrets are accepted through the environment only;
 * none of them belong in git.
 *
 * n8n is the dashboard's primary, fast cache. Google Sheets receives the same
 * status rows only as a recovery snapshot.
 */

const env = typeof process !== "undefined" ? process.env : {};

const stripFunction = (fn) => {
  const source = fn.toString();
  return source.slice(source.indexOf("{") + 1, source.lastIndexOf("}")).trim();
};

async function fetchOfficialCampaignStatus() {
  // Serialized into an n8n Code node. Keep every dependency inside the body.
  const config = $("Official Status Configuration").first().json;
  const checkedAt = new Date().toISOString();
  const requestMode = String(config.requestMode || "scheduled");
  const rows = [];
  const health = [];
  const errors = [];

  const text = (value) => (value == null ? "" : String(value).trim());
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const parseList = (value) => {
    try {
      const parsed = JSON.parse(text(value) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const safeMessage = (error) =>
    text(error?.response?.body?.error?.message || error?.message || error)
      .replace(/Bearer\s+[^\s]+/gi, "Bearer <redacted>")
      .replace(/access[_-]?token[=:][^&\s]+/gi, "access_token=<redacted>")
      .replace(/\s+/g, " ")
      .slice(0, 320);
  const request = (options) =>
    this.helpers.httpRequest({ ...options, json: true, timeout: 90000 });
  const oauthForm = async (url, values) => {
    const body = Object.entries(values)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(text(value))}`)
      .join("&");
    const raw = await this.helpers.httpRequest({
      method: "POST",
      url,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      timeout: 90000,
    });
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return {}; }
    }
    return raw || {};
  };
  const fetchPaged = async (url, qs, headers = {}) => {
    const output = [];
    let next = url;
    let first = true;
    for (let page = 0; next && page < 100; page += 1) {
      const response = await request(
        first
          ? { method: "GET", url: next, qs, headers }
          : { method: "GET", url: next, headers },
      );
      first = false;
      output.push(...(Array.isArray(response?.data) ? response.data : []));
      next = text(response?.paging?.next);
    }
    return output;
  };
  const addHealth = (platform, ok, active, total, message = "") =>
    health.push({ platform, ok, active, total, message, checkedAt });
  const addRow = ({
    platform,
    accountId,
    account,
    campaignId,
    name,
    configuredStatus,
    effectiveStatus,
    servingStatus = "",
    statusReason = "",
    startTime = "",
    stopTime = "",
    updatedTime = "",
    activeAdsets = 0,
    activeAds = 0,
  }) => {
    rows.push({
      __row_type: "campaign_state",
      __platform: platform,
      __meta_key: `state|${platform}|${accountId}|${campaignId}`,
      __account_id: text(accountId),
      __account_name: text(account || accountId),
      __campaign_id: text(campaignId),
      __campaign_name: text(name || campaignId),
      __campaign_status: text(configuredStatus || "UNKNOWN"),
      __campaign_effective_status: text(effectiveStatus || configuredStatus || "UNKNOWN"),
      __serving_status: text(servingStatus),
      __status_reason: text(statusReason),
      __campaign_start_time: text(startTime),
      __campaign_stop_time: text(stopTime),
      __campaign_updated_time: text(updatedTime),
      __active_adsets: number(activeAdsets),
      __active_ads: number(activeAds),
      __delivery_state: "active",
      __status_checked_at: checkedAt,
      __request_mode: requestMode,
    });
  };

  // Meta: effective_status is the platform's official current campaign state.
  try {
    const token = text(config.META_TOKEN);
    const accounts = parseList(config.META_ACCOUNTS_JSON);
    const version = text(config.META_API_VERSION) || "v25.0";
    if (!token || !accounts.length) throw new Error("Meta credentials are not configured");
    let active = 0;
    let total = 0;
    for (const configured of accounts) {
      const rawId = text(configured?.id);
      const accountId = rawId.startsWith("act_") ? rawId : `act_${rawId}`;
      const info = await request({
        method: "GET",
        url: `https://graph.facebook.com/${version}/${accountId}`,
        qs: { fields: "id,name", access_token: token },
      });
      const [campaigns, adsets, ads] = await Promise.all([
        fetchPaged(
          `https://graph.facebook.com/${version}/${accountId}/campaigns`,
          {
            fields: "id,name,status,effective_status,start_time,stop_time,updated_time",
            limit: 500,
            access_token: token,
          },
        ),
        fetchPaged(
          `https://graph.facebook.com/${version}/${accountId}/adsets`,
          { fields: "id,campaign_id,effective_status", limit: 500, access_token: token },
        ),
        fetchPaged(
          `https://graph.facebook.com/${version}/${accountId}/ads`,
          { fields: "id,campaign_id,effective_status", limit: 500, access_token: token },
        ),
      ]);
      total += campaigns.length;
      const adsetCounts = new Map();
      const adCounts = new Map();
      for (const adset of adsets) {
        if (text(adset?.effective_status) !== "ACTIVE") continue;
        const id = text(adset?.campaign_id);
        adsetCounts.set(id, (adsetCounts.get(id) || 0) + 1);
      }
      for (const ad of ads) {
        if (text(ad?.effective_status) !== "ACTIVE") continue;
        const id = text(ad?.campaign_id);
        adCounts.set(id, (adCounts.get(id) || 0) + 1);
      }
      for (const campaign of campaigns) {
        if (text(campaign?.effective_status) !== "ACTIVE") continue;
        active += 1;
        const campaignId = text(campaign?.id);
        addRow({
          platform: "meta",
          accountId,
          account: text(info?.name || configured?.name || accountId),
          campaignId,
          name: campaign?.name,
          configuredStatus: campaign?.status,
          effectiveStatus: campaign?.effective_status,
          startTime: campaign?.start_time,
          stopTime: campaign?.stop_time,
          updatedTime: campaign?.updated_time,
          activeAdsets: adsetCounts.get(campaignId) || 0,
          activeAds: adCounts.get(campaignId) || 0,
        });
      }
    }
    addHealth("meta", true, active, total);
  } catch (error) {
    const message = safeMessage(error);
    errors.push({ platform: "meta", message });
    addHealth("meta", false, 0, 0, message);
  }

  // Snapchat: configured campaign status plus delivery_status come directly
  // from the Marketing API. Spend is deliberately not used as a status rule.
  try {
    const accountId = text(config.SNAP_AD_ACCOUNT_ID);
    if (!accountId) throw new Error("Snapchat account is not configured");
    const tokenResponse = await oauthForm(
      "https://accounts.snapchat.com/login/oauth2/access_token",
      {
        grant_type: "refresh_token",
        refresh_token: text(config.SNAP_REFRESH_TOKEN),
        client_id: text(config.SNAP_CLIENT_ID),
        client_secret: text(config.SNAP_CLIENT_SECRET),
      },
    );
    const accessToken = text(tokenResponse?.access_token);
    if (!accessToken) throw new Error("Snapchat OAuth did not return an access token");
    const response = await request({
      method: "GET",
      url: `https://adsapi.snapchat.com/v1/adaccounts/${accountId}/campaigns`,
      qs: { limit: 1000 },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const campaigns = (Array.isArray(response?.campaigns) ? response.campaigns : [])
      .map((entry) => entry?.campaign)
      .filter(Boolean);
    const activeCampaigns = campaigns.filter((campaign) => text(campaign?.status) === "ACTIVE");
    for (const campaign of activeCampaigns) {
      const delivery = Array.isArray(campaign?.delivery_status)
        ? campaign.delivery_status.map(text).filter(Boolean)
        : [];
      addRow({
        platform: "snapchat",
        accountId,
        account: text(config.SNAP_ACCOUNT_NAME) || accountId,
        campaignId: campaign?.id,
        name: campaign?.name,
        configuredStatus: campaign?.status,
        effectiveStatus: campaign?.status,
        servingStatus: delivery.includes("VALID") || delivery.includes("DELIVERING") ? "SERVING" : "LIMITED",
        statusReason: delivery.join(", "),
        startTime: campaign?.start_time,
        stopTime: campaign?.end_time,
        updatedTime: campaign?.updated_at,
      });
    }
    addHealth("snapchat", true, activeCampaigns.length, campaigns.length);
  } catch (error) {
    const message = safeMessage(error);
    errors.push({ platform: "snapchat", message });
    addHealth("snapchat", false, 0, 0, message);
  }

  // TikTok: operation_status=ENABLE is the user's official campaign switch;
  // secondary_status explains platform-side limits without changing that fact.
  try {
    const token = text(config.TIKTOK_ACCESS_TOKEN);
    const advertisers = parseList(config.TIKTOK_ADVERTISER_IDS_JSON).map(text).filter(Boolean);
    if (!token || !advertisers.length) throw new Error("TikTok credentials are not configured");
    let active = 0;
    let total = 0;
    for (const advertiserId of advertisers) {
      let page = 1;
      let totalPages = 1;
      do {
        const response = await request({
          method: "GET",
          url: "https://business-api.tiktok.com/open_api/v1.3/campaign/get/",
          qs: { advertiser_id: advertiserId, page, page_size: 1000 },
          headers: { "Access-Token": token },
        });
        if (number(response?.code) !== 0) {
          throw new Error(text(response?.message) || `TikTok error ${response?.code}`);
        }
        const campaigns = Array.isArray(response?.data?.list) ? response.data.list : [];
        total += campaigns.length;
        for (const campaign of campaigns) {
          if (text(campaign?.operation_status) !== "ENABLE") continue;
          active += 1;
          addRow({
            platform: "tiktok",
            accountId: advertiserId,
            account: advertiserId,
            campaignId: campaign?.campaign_id,
            name: campaign?.campaign_name,
            configuredStatus: campaign?.operation_status,
            effectiveStatus: campaign?.secondary_status || campaign?.operation_status,
            servingStatus:
              text(campaign?.secondary_status) === "CAMPAIGN_STATUS_ENABLE" ? "SERVING" : "LIMITED",
            statusReason: campaign?.secondary_status,
            updatedTime: campaign?.modify_time,
          });
        }
        totalPages = Math.max(1, number(response?.data?.page_info?.total_page));
        page += 1;
      } while (page <= totalPages);
    }
    addHealth("tiktok", true, active, total);
  } catch (error) {
    const message = safeMessage(error);
    errors.push({ platform: "tiktok", message });
    addHealth("tiktok", false, 0, 0, message);
  }

  // Google Ads: campaign.status=ENABLED is official. primary_status and
  // serving_status explain whether Google can actually serve it.
  try {
    const customers = parseList(config.GOOGLE_CUSTOMER_IDS_JSON).map(text).filter(Boolean);
    if (!customers.length) throw new Error("Google Ads customer is not configured");
    const tokenResponse = await oauthForm(
      "https://oauth2.googleapis.com/token",
      {
        client_id: text(config.GOOGLE_CLIENT_ID),
        client_secret: text(config.GOOGLE_CLIENT_SECRET),
        refresh_token: text(config.GOOGLE_REFRESH_TOKEN),
        grant_type: "refresh_token",
      },
    );
    const accessToken = text(tokenResponse?.access_token);
    if (!accessToken) throw new Error("Google OAuth did not return an access token");
    let active = 0;
    let total = 0;
    for (const customerId of customers) {
      const response = await request({
        method: "POST",
        url: `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:searchStream`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": text(config.GOOGLE_DEVELOPER_TOKEN),
          "login-customer-id": text(config.GOOGLE_LOGIN_CUSTOMER_ID),
          "content-type": "application/json",
        },
        body: {
          query:
            "SELECT customer.id, customer.descriptive_name, campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.serving_status, campaign.primary_status_reasons, campaign.start_date, campaign.end_date FROM campaign WHERE campaign.status != 'REMOVED'",
        },
      });
      const campaigns = (Array.isArray(response) ? response : [])
        .flatMap((batch) => (Array.isArray(batch?.results) ? batch.results : []));
      total += campaigns.length;
      for (const result of campaigns) {
        const campaign = result?.campaign || {};
        if (text(campaign?.status) !== "ENABLED") continue;
        active += 1;
        addRow({
          platform: "google",
          accountId: customerId,
          account: result?.customer?.descriptiveName || customerId,
          campaignId: campaign?.id,
          name: campaign?.name,
          configuredStatus: campaign?.status,
          effectiveStatus: campaign?.primaryStatus || campaign?.status,
          servingStatus: campaign?.servingStatus,
          statusReason: Array.isArray(campaign?.primaryStatusReasons)
            ? campaign.primaryStatusReasons.join(", ")
            : "",
          startTime: campaign?.startDate,
          stopTime: campaign?.endDate,
        });
      }
    }
    addHealth("google", true, active, total);
  } catch (error) {
    const message = safeMessage(error);
    errors.push({ platform: "google", message });
    addHealth("google", false, 0, 0, message);
  }

  if (!rows.length) {
    return [{ json: { __placeholder: true, __status_checked_at: checkedAt, __request_mode: requestMode, __platform_health_json: JSON.stringify(health), __errors_json: JSON.stringify(errors) } }];
  }
  return rows.map((row, index) => ({
    json: {
      ...row,
      __platform_health_json: index === 0 ? JSON.stringify(health) : "",
      __errors_json: index === 0 ? JSON.stringify(errors) : "",
    },
  }));
}

async function packageOfficialResponse() {
  const items = $input.all().map((item) => item.json || {});
  const stateRows = items.filter((row) => row.__row_type === "campaign_state");
  const parse = (key) => {
    try { return JSON.parse(String(items.find((row) => row[key])?.[key] || "[]")); }
    catch { return []; }
  };
  const first = items[0] || {};
  const response = {
    ok: stateRows.length > 0,
    source: "n8n_live",
    definition: "official_status",
    generatedAt: String(first.__status_checked_at || new Date().toISOString()),
    requestMode: String(first.__request_mode || "scheduled"),
    platformHealth: parse("__platform_health_json"),
    accountsWithErrors: parse("__errors_json"),
    campaigns: stateRows.map((row) => ({
      platform: String(row.__platform || "meta"),
      accountId: String(row.__account_id || ""),
      account: String(row.__account_name || ""),
      accountTimezone: "",
      campaignId: String(row.__campaign_id || ""),
      name: String(row.__campaign_name || ""),
      configuredStatus: String(row.__campaign_status || "UNKNOWN"),
      effectiveStatus: String(row.__campaign_effective_status || "UNKNOWN"),
      servingStatus: String(row.__serving_status || ""),
      statusReason: String(row.__status_reason || ""),
      startTime: String(row.__campaign_start_time || ""),
      stopTime: String(row.__campaign_stop_time || ""),
      updatedTime: String(row.__campaign_updated_time || ""),
      activeAdsets: Number(row.__active_adsets || 0),
      activeAds: Number(row.__active_ads || 0),
      spend24h: 0,
      impressions24h: 0,
      clicks24h: 0,
      platformLeads24h: null,
      deliveryState: "active",
      checkedAt: String(row.__status_checked_at || first.__status_checked_at || ""),
      source: "n8n_live",
    })),
  };
  $getWorkflowStaticData("global").officialCampaignStatusResponse = response;
  return [{ json: response }];
}

async function readCachedOfficialResponse() {
  const cached = $getWorkflowStaticData("global").officialCampaignStatusResponse;
  return [{
    json: cached && Array.isArray(cached.campaigns)
      ? { ...cached, requestMode: "webhook" }
      : { ok: false, source: "n8n_live", definition: "official_status", generatedAt: "", requestMode: "webhook", platformHealth: [], accountsWithErrors: [{ message: "Official status cache is empty. Run refresh once." }], campaigns: [] },
  }];
}

async function prepareGoogleBackup() {
  return $input.all()
    .filter((item) => item.json?.__row_type === "campaign_state")
    .map((item) => {
      const row = item.json;
      const state = {
        rowType: "campaign_state",
        platform: String(row.__platform || "meta"),
        campaignStatus: String(row.__campaign_status || "UNKNOWN"),
        campaignEffectiveStatus: String(row.__campaign_effective_status || "UNKNOWN"),
        servingStatus: String(row.__serving_status || ""),
        statusReason: String(row.__status_reason || ""),
        campaignStartTime: String(row.__campaign_start_time || ""),
        campaignStopTime: String(row.__campaign_stop_time || ""),
        campaignUpdatedTime: String(row.__campaign_updated_time || ""),
        activeAdsets: Number(row.__active_adsets || 0),
        activeAds: Number(row.__active_ads || 0),
        deliveryState: "active",
        statusSource: "official_platform_api",
        checkedAt: String(row.__status_checked_at || ""),
      };
      return { json: {
        "التاريخ": String(row.__status_checked_at || "").slice(0, 10),
        "اسم الحساب الإعلاني": String(row.__account_name || ""),
        "اسم الكامبين": String(row.__campaign_name || ""),
        "Ad set name": "", "Ad Name": "", "Spend (Cost)": 0, "العملة": "",
        Impressions: 0, "Link Clicks": 0, "Clicks (all)": 0, "CTR (all)": "", "CTR (link)": "",
        "Leads (on facebook Leads)": 0, "Leads (Website/Pixel)": 0, "Leads (Total)": 0,
        "CPL (Cost/Lead)": "", Course: "", __meta_key: String(row.__meta_key || ""),
        __account_id: String(row.__account_id || ""), __account_name: String(row.__account_name || ""),
        __account_status: "", __account_currency: "", __campaign_id: String(row.__campaign_id || ""),
        __adset_id: "", __ad_id: "", __lead_types: JSON.stringify(state),
        __synced_at: String(row.__status_checked_at || ""),
      } };
    });
}

const assignment = (id, name, value, type = "string") => ({ id, name, value, type });
const contextNode = (id, name, requestMode, position) => ({
  id, name, type: "n8n-nodes-base.set", typeVersion: 3.4, position,
  parameters: { assignments: { assignments: [assignment(`${id}-mode`, "requestMode", requestMode)] }, options: {} },
});

const schema = [
  "التاريخ", "اسم الحساب الإعلاني", "اسم الكامبين", "Ad set name", "Ad Name", "Spend (Cost)", "العملة",
  "Impressions", "Link Clicks", "Clicks (all)", "Leads (on facebook Leads)", "Leads (Website/Pixel)",
  "Leads (Total)", "CPL (Cost/Lead)", "Course", "__meta_key", "__account_id", "__account_name",
  "__account_status", "__account_currency", "__campaign_id", "__adset_id", "__ad_id", "__lead_types", "__synced_at",
].map((id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true, removed: false }));

const workflow = {
  name: "Engosoft — All Ads Official Campaign Status [v2]",
  settings: { executionOrder: "v1", timezone: "Africa/Cairo" },
  nodes: [
    { id: "status-webhook", name: "Dashboard Official Status Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [0, 0], webhookId: "4fbe7508-663a-4eb7-8c3a-42e23a58c124", parameters: { httpMethod: "GET", path: "engosoft-meta-campaign-live-status-v1-4fbe7508", responseMode: "responseNode", options: {} } },
    { id: "status-refresh-webhook", name: "Force Official Status Refresh", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [0, 130], webhookId: "5f7cb370-efb1-4b5f-8d7e-4d6522755ea8", parameters: { httpMethod: "POST", path: "engosoft-meta-campaign-refresh-v1-7d6522755ea8", responseMode: "responseNode", options: {} } },
    { id: "status-schedule", name: "Refresh Official Status Hourly", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.3, position: [0, 270], parameters: { rule: { interval: [{ field: "cronExpression", expression: "15 * * * *" }] } } },
    { id: "status-manual", name: "Manual Test Run", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0, 420], parameters: {} },
    contextNode("status-refresh-context", "Refresh Request", "refresh_webhook", [230, 130]),
    contextNode("status-background-context", "Background Request", "scheduled", [230, 330]),
    { id: "status-cache-read", name: "Read n8n Official Cache", type: "n8n-nodes-base.code", typeVersion: 2, position: [300, -60], parameters: { jsCode: stripFunction(readCachedOfficialResponse) } },
    { id: "status-config", name: "Official Status Configuration", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [500, 160], parameters: { assignments: { assignments: [
      assignment("cfg-meta-token", "META_TOKEN", env.META_TOKEN || "REPLACE_META_TOKEN"),
      assignment("cfg-meta-accounts", "META_ACCOUNTS_JSON", env.META_ACCOUNTS_JSON || "[]"),
      assignment("cfg-meta-version", "META_API_VERSION", "v25.0"),
      assignment("cfg-snap-account", "SNAP_AD_ACCOUNT_ID", env.SNAP_AD_ACCOUNT_ID || ""),
      assignment("cfg-snap-name", "SNAP_ACCOUNT_NAME", env.SNAP_ACCOUNT_NAME || "Engosoft Snapchat"),
      assignment("cfg-snap-refresh", "SNAP_REFRESH_TOKEN", env.SNAP_REFRESH_TOKEN || ""),
      assignment("cfg-snap-client", "SNAP_CLIENT_ID", env.SNAP_CLIENT_ID || ""),
      assignment("cfg-snap-secret", "SNAP_CLIENT_SECRET", env.SNAP_CLIENT_SECRET || ""),
      assignment("cfg-tiktok-token", "TIKTOK_ACCESS_TOKEN", env.TIKTOK_ACCESS_TOKEN || ""),
      assignment("cfg-tiktok-ids", "TIKTOK_ADVERTISER_IDS_JSON", env.TIKTOK_ADVERTISER_IDS_JSON || "[]"),
      assignment("cfg-google-client", "GOOGLE_CLIENT_ID", env.GOOGLE_ADS_CLIENT_ID || ""),
      assignment("cfg-google-secret", "GOOGLE_CLIENT_SECRET", env.GOOGLE_ADS_CLIENT_SECRET || ""),
      assignment("cfg-google-refresh", "GOOGLE_REFRESH_TOKEN", env.GOOGLE_ADS_REFRESH_TOKEN || ""),
      assignment("cfg-google-dev", "GOOGLE_DEVELOPER_TOKEN", env.GOOGLE_ADS_DEVELOPER_TOKEN || ""),
      assignment("cfg-google-login", "GOOGLE_LOGIN_CUSTOMER_ID", env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || ""),
      assignment("cfg-google-customers", "GOOGLE_CUSTOMER_IDS_JSON", env.GOOGLE_ADS_CUSTOMER_IDS_JSON || "[]"),
      assignment("cfg-sheet-url", "SPREADSHEET_URL", "https://docs.google.com/spreadsheets/d/14kv8Xkv8SeFhF9roekDI0OKmpZBU29YQOlMj03LOKT0/edit?usp=sharing"),
      assignment("cfg-sheet-name", "SHEET_NAME", "Meta Ads Daily"),
      assignment("cfg-mode", "requestMode", "={{ $json.requestMode || 'scheduled' }}"),
    ] }, options: {} } },
    { id: "status-fetch", name: "Fetch Official Status — All Platforms", type: "n8n-nodes-base.code", typeVersion: 2, position: [790, 160], parameters: { jsCode: stripFunction(fetchOfficialCampaignStatus) }, retryOnFail: true, maxTries: 2, waitBetweenTries: 4000 },
    { id: "status-package", name: "Cache + Package Official Response", type: "n8n-nodes-base.code", typeVersion: 2, position: [1060, 30], parameters: { jsCode: stripFunction(packageOfficialResponse) } },
    { id: "status-has-row", name: "Has Official State Row", type: "n8n-nodes-base.if", typeVersion: 2, position: [1060, 300], parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 }, conditions: [{ id: "status-key-check", leftValue: "={{ $json.__meta_key }}", rightValue: "", operator: { type: "string", operation: "notEmpty", singleValue: true } }], combinator: "and" }, options: {} } },
    { id: "status-backup-map", name: "Prepare Google Backup Rows", type: "n8n-nodes-base.code", typeVersion: 2, position: [1290, 300], parameters: { jsCode: stripFunction(prepareGoogleBackup) } },
    { id: "status-sheet", name: "Backup Official Status to Google", type: "n8n-nodes-base.googleSheets", typeVersion: 4.7, position: [1530, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, credentials: { googleSheetsOAuth2Api: { id: "ZXa2IX134lVjdbGk", name: "Google Sheets account" } }, parameters: { operation: "appendOrUpdate", documentId: { __rl: true, value: "={{ $('Official Status Configuration').first().json.SPREADSHEET_URL }}", mode: "url" }, sheetName: { __rl: true, value: "={{ $('Official Status Configuration').first().json.SHEET_NAME }}", mode: "name" }, columns: { mappingMode: "autoMapInputData", value: {}, matchingColumns: ["__meta_key"], schema, attemptToConvertTypes: false, convertFieldsToString: false }, options: { cellFormat: "RAW", handlingExtraData: "insertInNewColumn", useAppend: true } } },
    { id: "status-webhook-kind", name: "Is Refresh Webhook", type: "n8n-nodes-base.if", typeVersion: 2, position: [1320, 30], parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 }, conditions: [{ id: "status-webhook-check", leftValue: "={{ $json.requestMode }}", rightValue: "refresh_webhook", operator: { type: "string", operation: "equals" } }], combinator: "and" }, options: {} } },
    { id: "status-get-response", name: "Return Official Campaign Status", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.4, position: [570, -60], parameters: { respondWith: "json", responseBody: "={{ JSON.stringify($json) }}", options: {} } },
    { id: "status-refresh-response", name: "Return Fresh Official Status", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.4, position: [1570, 40], parameters: { respondWith: "json", responseBody: "={{ JSON.stringify($json) }}", options: {} } },
    { id: "status-note", name: "Status rules", type: "n8n-nodes-base.stickyNote", typeVersion: 1, position: [720, -230], parameters: { width: 780, height: 200, content: "## Official status first\n- Meta: `effective_status=ACTIVE`\n- Snapchat: `status=ACTIVE` plus `delivery_status`\n- TikTok: `operation_status=ENABLE` plus `secondary_status`\n- Google Ads: `campaign.status=ENABLED` plus primary/serving status\n- Spend is displayed as context only. It never decides whether a campaign is active.\n- n8n is primary; Google Sheets is backup only." } },
  ],
  connections: {
    "Dashboard Official Status Webhook": { main: [[{ node: "Read n8n Official Cache", type: "main", index: 0 }]] },
    "Read n8n Official Cache": { main: [[{ node: "Return Official Campaign Status", type: "main", index: 0 }]] },
    "Force Official Status Refresh": { main: [[{ node: "Refresh Request", type: "main", index: 0 }]] },
    "Refresh Official Status Hourly": { main: [[{ node: "Background Request", type: "main", index: 0 }]] },
    "Manual Test Run": { main: [[{ node: "Background Request", type: "main", index: 0 }]] },
    "Refresh Request": { main: [[{ node: "Official Status Configuration", type: "main", index: 0 }]] },
    "Background Request": { main: [[{ node: "Official Status Configuration", type: "main", index: 0 }]] },
    "Official Status Configuration": { main: [[{ node: "Fetch Official Status — All Platforms", type: "main", index: 0 }]] },
    "Fetch Official Status — All Platforms": { main: [[{ node: "Cache + Package Official Response", type: "main", index: 0 }, { node: "Has Official State Row", type: "main", index: 0 }]] },
    "Cache + Package Official Response": { main: [[{ node: "Is Refresh Webhook", type: "main", index: 0 }]] },
    "Is Refresh Webhook": { main: [[{ node: "Return Fresh Official Status", type: "main", index: 0 }], []] },
    "Has Official State Row": { main: [[{ node: "Prepare Google Backup Rows", type: "main", index: 0 }], []] },
    "Prepare Google Backup Rows": { main: [[{ node: "Backup Official Status to Google", type: "main", index: 0 }]] },
  },
};

export { workflow };

// The persistent browser/automation REPL imports this module to deploy the
// sanitized template. Its process shim intentionally has no stdout stream.
if (typeof process !== "undefined" && process?.stdout?.write) {
  process.stdout.write(`${JSON.stringify(workflow, null, 2)}\n`);
}
