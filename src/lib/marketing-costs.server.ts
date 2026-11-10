import { getFiltered, computeTotals } from "./metrics.server";
import { getAdSpendCoverage } from "./ad-delivery-coverage.server";
import { accountingReportingDate } from "./accounting-policy";
import { odooConfig, odooCall, searchRead, m2oId, m2oName, type M2O } from "./odoo.server";
import type { GlobalFilters } from "./types";
import {
  analyzeMarketingCosts,
  type BroadcastJob,
  type InvoiceFact,
  type WaCostPoint,
} from "./marketing-costs";

type Json = Record<string, any>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const day = (t: number) =>
  new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
const cache = new Map<string, { at: number; pending: Promise<MarketingCostsReport> }>();

async function getJson(
  url: string,
  headers: Record<string, string>,
  timeout = 20000,
): Promise<Json> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeout),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  return obj(await response.json());
}

async function inboxes(): Promise<Json[]> {
  const base = txt(process.env.CHATWOOT_BASE_URL).replace(/\/+$/, "");
  const account = txt(process.env.CHATWOOT_ACCOUNT_ID || process.env.ACCOUNT_ID);
  const token = txt(process.env.CHATWOOT_API_TOKEN);
  if (!base || !account || !token) throw new Error("Chatwoot read connection unavailable");
  const data = await getJson(`${base}/api/v1/accounts/${encodeURIComponent(account)}/inboxes`, {
    api_access_token: token,
  });
  return Array.isArray(data.payload) ? data.payload : [];
}

function monthWindows(from: string, to: string) {
  const out: [number, number][] = [];
  let start = Date.parse(`${from}T00:00:00+03:00`);
  const end = Date.parse(`${to}T00:00:00+03:00`) + 86400000;
  if (!Number.isFinite(start + end) || end <= start || end - start > 367 * 86400000) return out;
  while (start < end) {
    const next = Math.min(end, start + 31 * 86400000);
    out.push([start / 1000, next / 1000]);
    start = next;
  }
  return out;
}

async function whatsappCosts(from: string, to: string) {
  const points: WaCostPoint[] = [],
    accounts: { id: string; name: string; currency: string }[] = [],
    errors: string[] = [];
  let boxes: Json[] = [];
  try {
    boxes = await inboxes();
  } catch {
    return { points, accounts, boxes, errors: ["chatwoot_inboxes_unavailable"], complete: false };
  }
  const groups = new Map<string, string[]>();
  for (const inbox of boxes) {
    if (inbox.provider !== "whatsapp_cloud") continue;
    const cfg = obj(inbox.provider_config),
      id = txt(cfg.business_account_id),
      token = txt(cfg.api_key);
    if (!/^\d+$/.test(id) || !token) continue;
    groups.set(id, [...new Set([...(groups.get(id) || []), token])]);
  }
  const windows = monthWindows(from, to);
  if (!windows.length)
    return { points, accounts, boxes, errors: ["select_period_up_to_one_year"], complete: false };
  if (!groups.size) errors.push("whatsapp_account_credentials_unavailable");
  for (const [id, tokens] of groups) {
    let accountOk = false;
    for (const token of tokens) {
      const current: WaCostPoint[] = [];
      const seenPoints = new Set<string>();
      try {
        let metadata: Json = {};
        for (const [start, end] of windows) {
          const url = new URL(
            `https://graph.facebook.com/${txt(process.env.META_API_VERSION) || "v25.0"}/${id}`,
          );
          url.searchParams.set(
            "fields",
            `id,name,currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["PRICING_CATEGORY","PRICING_TYPE","PHONE"])`,
          );
          const data = await getJson(url.toString(), { Authorization: `Bearer ${token}` });
          if (data.error) throw new Error("Meta pricing read rejected");
          metadata = data;
          const series = obj(data.pricing_analytics).data;
          if (!Array.isArray(series)) throw new Error("Meta pricing series absent");
          for (const seriesRow of series)
            for (const raw of seriesRow.data_points || []) {
              if (
                raw.cost == null ||
                raw.volume == null ||
                !Number.isFinite(Number(raw.start)) ||
                !Number.isFinite(Number(raw.cost)) ||
                !Number.isFinite(Number(raw.volume))
              )
                throw new Error("Invalid Meta pricing point");
              const date = day(Number(raw.start));
              if (date < from || date > to) continue;
              const pointKey = JSON.stringify([
                raw.start,
                raw.end,
                raw.phone_number,
                raw.country,
                raw.tier,
                raw.pricing_category,
                raw.pricing_type,
              ]);
              if (seenPoints.has(pointKey)) continue;
              seenPoints.add(pointKey);
              current.push({
                accountId: id,
                date,
                phone: txt(raw.phone_number),
                category: txt(raw.pricing_category) || "UNKNOWN",
                pricingType: txt(raw.pricing_type) || "UNKNOWN",
                currency: txt(data.currency).toUpperCase(),
                cost: Number(raw.cost),
                volume: Number(raw.volume),
              });
            }
        }
        // An inbox is not an extra bill: account-level analytics are read once per WABA.
        points.push(...current);
        accounts.push({ id, name: txt(metadata.name), currency: txt(metadata.currency) });
        accountOk = true;
        break;
      } catch {
        /* Never return a provider credential or an URL carrying one. */
      }
    }
    if (!accountOk) errors.push(`whatsapp_account_unavailable:${id}`);
  }
  return {
    points,
    accounts,
    boxes,
    errors,
    complete: errors.length === 0 && accounts.length === groups.size && groups.size > 0,
  };
}

async function campaignJobs(from: string, to: string) {
  const jobs: BroadcastJob[] = [];
  const base = (
    process.env.BROADCAST_REPORT_BASE_URL ||
    "https://chatwoot-campain-uploder-production-4bee.up.railway.app"
  ).replace(/\/+$/, "");
  const token = txt(process.env.CHATWOOT_API_TOKEN);
  let scanned = 0,
    unreadable = 0,
    total = 0;
  try {
    if (!token) throw new Error("not configured");
    for (let offset = 0; offset < 10000; offset += 50) {
      const params = new URLSearchParams({ from, to, offset: String(offset), limit: "50" });
      const data = await getJson(
        `${base}/api/reporting/broadcast?${params}`,
        { Authorization: `Bearer ${token}` },
        45000,
      );
      if (!Array.isArray(data.jobs)) throw new Error("Invalid campaign report");
      total = num(data.total);
      scanned = num(data.scanned);
      unreadable = num(data.unreadable);
      for (const raw of data.jobs) {
        if (!Array.isArray(raw.events)) throw new Error("Campaign recipient evidence absent");
        jobs.push({
          id: txt(raw.id),
          campaign: txt(raw.campaign),
          template: txt(raw.template),
          category: txt(raw.category),
          inboxId: txt(raw.inboxId),
          operator: txt(raw.operator),
          createdAt: txt(raw.createdAt),
          status: txt(raw.status),
          total: num(raw.total),
          accepted: num(raw.accepted),
          errors: num(raw.errors),
          skipped: num(raw.skipped),
          events: raw.events.map((e: Json) => ({
            jobId: txt(e.jobId),
            messageId: txt(e.messageId),
            phone: txt(e.phone),
            acceptedAt: txt(e.acceptedAt),
            date: txt(e.date),
            timeBasis: txt(e.timeBasis),
          })),
        });
      }
      if (jobs.length >= total) break;
      if (!data.jobs.length) throw new Error("Campaign pagination stopped early");
    }
    return {
      jobs,
      total,
      scanned,
      unreadable,
      complete: unreadable === 0 && jobs.length === total,
      error: "",
    };
  } catch {
    return {
      jobs,
      total,
      scanned,
      unreadable,
      complete: false,
      error: "campaign_reporting_unavailable_or_partial",
    };
  }
}

const partnerCache = new Map<string, { until: number; phones: Map<string, string[]> }>();
async function invoicePhones(invoices: InvoiceFact[]) {
  const key = invoices
    .map((i) => i.key)
    .sort()
    .join("|");
  const cached = partnerCache.get(key);
  if (cached && cached.until > Date.now()) return { phones: cached.phones, complete: true };
  const phones = new Map<string, string[]>();
  try {
    if (invoices.length > 5000) throw new Error("Choose a shorter period");
    const context = { allowed_company_ids: odooConfig().pnlCompanyIds };
    const moves: { id: number; name: string; partner_id: M2O; company_id: M2O }[] = [];
    for (let offset = 0; offset < invoices.length; offset += 500) {
      const names = [...new Set(invoices.slice(offset, offset + 500).map((i) => i.movement))];
      moves.push(
        ...(await searchRead<(typeof moves)[number]>(
          "account.move",
          [
            ["name", "in", names],
            ["state", "=", "posted"],
          ],
          ["id", "name", "partner_id", "company_id"],
          { context, policy: { attempts: 1, timeoutMs: 20000 } },
        )),
      );
    }
    const ids = [...new Set(moves.map((m) => m2oId(m.partner_id)).filter(Boolean))];
    const partners = ids.length
      ? await odooCall<{ id: number; phone?: string; mobile?: string }[]>(
          "res.partner",
          "read",
          [ids],
          { fields: ["id", "phone", "mobile"], context },
        )
      : [];
    const byPartner = new Map(
      partners.map((p) => [p.id, [txt(p.phone), txt(p.mobile)].filter(Boolean)]),
    );
    for (const m of moves)
      phones.set(`${m2oName(m.company_id)}\0${m.name}`, byPartner.get(m2oId(m.partner_id)) || []);
    if (partnerCache.size >= 5) partnerCache.delete(partnerCache.keys().next().value!);
    partnerCache.set(key, { until: Date.now() + 600000, phones });
    return { phones, complete: true };
  } catch {
    return { phones, complete: false };
  }
}

export async function marketingCostsReport(filters: GlobalFilters): Promise<MarketingCostsReport> {
  const key = JSON.stringify(filters);
  const prior = cache.get(key);
  if (prior && Date.now() - prior.at < 300000) return prior.pending;
  if (cache.size >= 10) cache.delete(cache.keys().next().value!);
  const pending = buildReport(filters);
  cache.set(key, { at: Date.now(), pending });
  pending.catch(() => cache.delete(key));
  return pending;
}

async function buildReport(filters: GlobalFilters) {
  const data = await getFiltered(filters);
  const from = filters.from || data.snapshot.adsDateMin || "2026-01-01";
  const to =
    filters.to ||
    data.snapshot.adsDateMax ||
    new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  const notApplicable = Boolean(filters.platform && filters.platform !== "meta");
  const scopeNarrowed = Boolean(
    filters.platform ||
    filters.course ||
    filters.mainCategory ||
    filters.source ||
    filters.company ||
    filters.salesTeam ||
    filters.salesperson ||
    filters.account ||
    filters.campaign ||
    filters.campaignKey ||
    filters.adset ||
    filters.adsetKey ||
    filters.ad ||
    filters.adKey,
  );
  const [wa, app, adCoverage] = await Promise.all([
    notApplicable
      ? Promise.resolve({
          points: [],
          accounts: [],
          boxes: [],
          errors: ["platform_scope_not_whatsapp"],
          complete: false,
        })
      : whatsappCosts(from, to),
    notApplicable
      ? Promise.resolve({
          jobs: [],
          total: 0,
          scanned: 0,
          unreadable: 0,
          complete: false,
          error: "platform_scope_not_whatsapp",
        })
      : campaignJobs(from, to),
    getAdSpendCoverage({ from, to, platform: filters.platform, account: filters.account }),
  ]);
  // Use current provider template categories, not the operator's editable label.
  const categories = new Map<string, string>();
  for (const inbox of wa.boxes)
    for (const t of Array.isArray(inbox.message_templates) ? inbox.message_templates : []) {
      if (t.name && t.category)
        categories.set(`${inbox.id}:${t.name}`, String(t.category).toUpperCase());
    }
  for (const job of app.jobs)
    job.category = categories.get(`${job.inboxId}:${job.template}`) || "UNKNOWN";
  const grouped = new Map<string, InvoiceFact>();
  for (const row of data.accounting) {
    const key = `${row.company}\0${row.movement}`;
    const invoice = grouped.get(key) || {
      key,
      movement: row.movement,
      company: row.company,
      invoiceDate: row.invoiceDate,
      reportingDate: accountingReportingDate(
        row,
        filters.dateBasis === "invoice" ? "invoice" : "payment",
      ),
      source: row.source,
      revenue: 0,
      creditNote: row.isCreditNote,
      phones: [],
    };
    invoice.revenue += row.usdPaid;
    grouped.set(key, invoice);
  }
  const invoices = [...grouped.values()];
  const phoneResult = app.jobs.length
    ? await invoicePhones(invoices)
    : { phones: new Map<string, string[]>(), complete: app.complete };
  for (const invoice of invoices) invoice.phones = phoneResult.phones.get(invoice.key) || [];
  const analysis = analyzeMarketingCosts(wa.points, app.jobs, invoices);
  const possibleCostOverlap = wa.points.some((p) => p.category.includes("LITE"));
  const adDays = new Map<string, number>();
  for (const ad of data.ads)
    if (ad.date) adDays.set(ad.date, (adDays.get(ad.date) || 0) + ad.spend);
  const totalAds = computeTotals(data).spend;
  return {
    from,
    to,
    generatedAt: new Date().toISOString(),
    timezone: "Asia/Riyadh",
    dateBasis: filters.dateBasis === "invoice" ? "invoice" : "payment",
    notApplicable,
    scopeNarrowed,
    ads: {
      spendUsd: totalAds,
      complete: adCoverage.complete,
      daily: [...adDays.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, spend]) => ({ date, spend })),
      platforms: [...new Set(data.ads.map((a) => a.platform))].map((platform) => ({
        platform,
        spend: data.ads.filter((a) => a.platform === platform).reduce((s, a) => s + a.spend, 0),
      })),
    },
    whatsapp: {
      complete: wa.complete,
      accounts: wa.accounts,
      errors: wa.errors,
      reportedCostUsd: wa.complete ? analysis.costUsd : null,
      ...analysis,
    },
    campaigns: {
      complete: app.complete,
      totalJobs: app.total,
      scannedJobs: app.scanned,
      unreadableJobs: app.unreadable,
      error: app.error,
      phoneCoverageComplete: phoneResult.complete,
      acceptedMeaning: "accepted_by_chatwoot_not_verified_delivery" as const,
    },
    combinedUsageUsd:
      wa.complete &&
      adCoverage.complete &&
      !scopeNarrowed &&
      !possibleCostOverlap &&
      analysis.costUsd !== null
        ? totalAds + analysis.costUsd
        : null,
    possibleCostOverlap,
    billing: {
      status: "not_connected" as const,
      chargedUsd: null,
      taxUsd: null,
      differenceUsd: null,
    },
  };
}

export type MarketingCostsReport = Awaited<ReturnType<typeof buildReport>>;

export function resetMarketingCostsCacheForTests() {
  cache.clear();
  partnerCache.clear();
}
