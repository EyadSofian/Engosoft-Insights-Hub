// Account-level Meta delivery read straight from the Graph API.
//
// The dashboard's Meta facts come from the `meta_ads` PostgreSQL dataset that
// n8n writes. That makes Meta the one paid platform whose numbers are never
// checked against their own source at runtime: TikTok and Google Ads are read
// from their APIs by this app, Snapchat has no API path at all. This module
// exists only so the reconciliation report can ask Meta directly what it
// charged, and is never used to render a dashboard figure.
import { metaGet } from "./meta-credential-health.server";

export interface MetaAccountDelivery {
  accountId: string;
  name: string;
  currency: string;
  timezone: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
}

export interface MetaOfficialDelivery {
  configured: boolean;
  ok: boolean;
  accounts: MetaAccountDelivery[];
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  /** Currencies other than USD, which this app's spend figures assume. */
  foreignCurrencies: string[];
  /** Distinct reporting timezones; Meta buckets a day in the account's own. */
  timezones: string[];
  errors: string[];
  readAt: string;
}

const number = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Meta's own grouped lead action.
 *
 * Summing several lead-ish action types double counts: for September 2026 the
 * same 2,216 leads appear as `onsite_conversion.lead_grouped`,
 * `offsite_complete_registration_add_meta_leads` and
 * `onsite_conversion.total_messaging_connection`, while the generic `lead`
 * action reads 2,218 because it also carries 2 website pixel leads.
 */
const LEAD_ACTION = "onsite_conversion.lead_grouped";

function leadsFrom(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const row = action as Record<string, unknown>;
    if (String(row.action_type) === LEAD_ACTION) return number(row.value);
  }
  return 0;
}

/** Every ad account the configured token can see, paged to the end. */
async function listAdAccounts(token: string): Promise<{
  accounts: { id: string; name: string; currency: string; timezone: string }[];
  error: string;
}> {
  const accounts: { id: string; name: string; currency: string; timezone: string }[] = [];
  let path = "me/adaccounts";
  let params: Record<string, string> = {
    fields: "id,name,currency,timezone_name",
    limit: "200",
  };
  for (let page = 0; page < 25; page += 1) {
    const result = await metaGet(path, token, params);
    if (!result.ok) return { accounts, error: result.error };
    const data = result.data as Record<string, unknown>;
    for (const entry of Array.isArray(data.data) ? data.data : []) {
      const row = (entry ?? {}) as Record<string, unknown>;
      const id = String(row.id ?? "");
      if (id) {
        accounts.push({
          id,
          name: String(row.name ?? id),
          currency: String(row.currency ?? ""),
          timezone: String(row.timezone_name ?? ""),
        });
      }
    }
    const paging = (data.paging ?? {}) as Record<string, unknown>;
    const cursors = (paging.cursors ?? {}) as Record<string, unknown>;
    const after = String(cursors.after ?? "");
    if (!paging.next || !after) break;
    path = "me/adaccounts";
    params = { ...params, after };
  }
  return { accounts, error: "" };
}

/**
 * What Meta itself reports for a window, summed over every visible account.
 *
 * An account that errors is recorded in `errors` and contributes nothing, so a
 * partial read is visible as a partial read rather than as a smaller bill.
 */
export async function metaOfficialDelivery(
  from: string,
  to: string,
): Promise<MetaOfficialDelivery> {
  const readAt = new Date().toISOString();
  const token = process.env.META_ACCESS_TOKEN?.trim() ?? "";
  const empty: MetaOfficialDelivery = {
    configured: false,
    ok: false,
    accounts: [],
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    foreignCurrencies: [],
    timezones: [],
    errors: [],
    readAt,
  };
  if (!token) return { ...empty, errors: ["META_ACCESS_TOKEN is not configured."] };
  if (!from || !to) return { ...empty, configured: true, errors: ["A date range is required."] };

  const listed = await listAdAccounts(token);
  if (listed.error && listed.accounts.length === 0) {
    return { ...empty, configured: true, errors: [listed.error] };
  }

  const errors = listed.error ? [listed.error] : [];
  const accounts: MetaAccountDelivery[] = [];
  for (const account of listed.accounts) {
    const result = await metaGet(`${account.id}/insights`, token, {
      time_range: JSON.stringify({ since: from, until: to }),
      level: "account",
      fields: "spend,impressions,clicks,actions",
    });
    if (!result.ok) {
      errors.push(`${account.id}: ${result.error}`);
      continue;
    }
    const rows = Array.isArray((result.data as Record<string, unknown>).data)
      ? ((result.data as Record<string, unknown>).data as unknown[])
      : [];
    const row = (rows[0] ?? {}) as Record<string, unknown>;
    accounts.push({
      accountId: account.id,
      name: account.name,
      currency: account.currency,
      timezone: account.timezone,
      spend: number(row.spend),
      impressions: number(row.impressions),
      clicks: number(row.clicks),
      leads: leadsFrom(row.actions),
    });
  }

  const sum = (pick: (a: MetaAccountDelivery) => number) =>
    accounts.reduce((total, account) => total + pick(account), 0);

  return {
    configured: true,
    // A read is only usable when every account answered.
    ok: errors.length === 0 && accounts.length > 0,
    accounts,
    spend: sum((a) => a.spend),
    impressions: sum((a) => a.impressions),
    clicks: sum((a) => a.clicks),
    leads: sum((a) => a.leads),
    foreignCurrencies: [
      ...new Set(accounts.map((a) => a.currency.toUpperCase()).filter((c) => c && c !== "USD")),
    ],
    timezones: [...new Set(accounts.map((a) => a.timezone).filter(Boolean))],
    errors,
    readAt,
  };
}
