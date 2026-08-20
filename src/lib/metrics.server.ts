// Server-only compute layer: applies filters, produces aggregates.
//
// Division discipline: every ratio goes through `div()`, which returns `null`
// when the denominator is zero. `null` renders as an em dash. A metric must
// never surface as 0, NaN or Infinity because its denominator was empty — those
// read as real results and get acted on.
import {
  loadAllData,
  knownCourseFromText,
  normalizeName,
  normalizeSource,
  type Snapshot,
} from "./sheet-cache.server";
import { isOrganicSourceKey, PLATFORM_SOURCE_KEYS } from "./acquisition-channel";
import { UNATTRIBUTED_COURSE } from "./course-taxonomy";
import { archivedWinFilter, isArchivedWonStage } from "./archived-won";
import { approvedReportingEnd, REPORTING_WINDOW_START } from "./reporting-window";
import { accountingReportingDate } from "./accounting-policy";
import { PLATFORMS } from "./constants";
import { loadMetaLiveStatus } from "./meta-live-status.server";
import { fetchGoogleAdsCampaignStatus } from "./google-ads.server";
import { isOperationalStateCurrent } from "./campaign-status-policy";
import type {
  AdRow,
  AccountingRow,
  CampaignOperationalState,
  CourseAgg,
  CrmLeadRow,
  DataHealth,
  Deltas,
  ExecSummary,
  FunnelStep,
  GlobalFilters,
  Grouped,
  InvoicedRow,
  LostBreakdown,
  LostRow,
  Matrix,
  Maybe,
  PerfRow,
  Platform,
  TeamAgg,
  Totals,
  YoyResult,
} from "./types";

/* --- primitives ----------------------------------------------------------- */

export function div(a: number, b: number): Maybe {
  return b > 0 && isFinite(a / b) ? a / b : null;
}

const pctOf = (a: number, b: number): Maybe => {
  const r = div(a, b);
  return r === null ? null : r * 100;
};

/**
 * A row passes when no date window is active. Once a window IS active, a row
 * with no date must be EXCLUDED — otherwise undated rows leak all-time totals
 * into a filtered window, which is what previously reported ROAS at ~87×.
 */
function inRange(date: string, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** Sums a nullable metric across rows; stays `null` when no row reports it. */
function sumMaybe<T>(rows: T[], pick: (r: T) => number | null): Maybe {
  let total = 0;
  let seen = false;
  for (const r of rows) {
    const v = pick(r);
    if (v === null) continue;
    total += v;
    seen = true;
  }
  return seen ? total : null;
}

const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);

/** Source keys that identify each ad platform inside the CRM. */
const PLATFORM_SOURCES = PLATFORM_SOURCE_KEYS;

const UNKNOWN_ADSET = "__unknown_adset__";

interface PerformanceDimensionMeta {
  key: string;
  name: string;
  campaignKey: string;
  campaignName: string;
  adsetKey: string;
  adsetName: string;
  adKey: string;
}

type AttributedFact = Pick<
  CrmLeadRow | AccountingRow | LostRow,
  "campaignId" | "campaignKey" | "campaignName" | "adId" | "adName" | "adset"
>;

const dimensionPart = (value: string) => normalizeName(value) || "unknown";
const dimensionPair = (campaignKey: string, value: string) =>
  `${campaignKey || "no-campaign"}|${dimensionPart(value)}`;

/**
 * Stable campaign/ad-set/ad identities shared by filtering and aggregation.
 *
 * Platform exports carry the real ids. CRM and Accounting often carry only an
 * ad id/name, so those facts join to a platform identity only when the match is
 * unique. Ambiguous name-only facts stay in a separate synthetic bucket rather
 * than being merged into one of several same-named ads.
 */
class PerformanceDimensionIndex {
  private meta = new Map<string, PerformanceDimensionMeta>();
  private adByCampaignId = new Map<string, Set<string>>();
  private adByGlobalId = new Map<string, Set<string>>();
  private adByCampaignName = new Map<string, Set<string>>();
  private adsetByCampaignName = new Map<string, Set<string>>();
  private adsetByAd = new Map<string, string>();

  constructor(ads: AdRow[]) {
    for (const row of ads) this.learn(row);
  }

  private addCandidate(map: Map<string, Set<string>>, lookup: string, key: string) {
    if (!lookup || !key) return;
    let values = map.get(lookup);
    if (!values) {
      values = new Set();
      map.set(lookup, values);
    }
    values.add(key);
  }

  private unique(map: Map<string, Set<string>>, lookup: string): string {
    const values = map.get(lookup);
    return values?.size === 1 ? [...values][0] : "";
  }

  private campaign(row: Pick<AttributedFact, "campaignKey" | "campaignName">) {
    return {
      key: row.campaignKey,
      name: row.campaignName,
      campaignKey: row.campaignKey,
      campaignName: row.campaignName,
      adsetKey: "",
      adsetName: "",
      adKey: "",
    } satisfies PerformanceDimensionMeta;
  }

  private keysForAd(row: AdRow) {
    const accountPart = dimensionPart(row.accountId || row.account);
    const adsetKey = row.adset
      ? row.adsetId
        ? `adset:${row.platform}:${accountPart}:${row.adsetId}`
        : `adset-name:${row.campaignKey || "no-campaign"}:${dimensionPart(row.adset)}`
      : UNKNOWN_ADSET;
    const adKey = row.adId
      ? `ad:${row.platform}:${accountPart}:${row.adId}`
      : `ad-name:${row.campaignKey || "no-campaign"}:${dimensionPart(row.ad)}`;
    return { adsetKey, adKey };
  }

  private learn(row: AdRow) {
    const { adsetKey, adKey } = this.keysForAd(row);
    const adsetMeta: PerformanceDimensionMeta = {
      key: adsetKey,
      name: row.adset,
      campaignKey: row.campaignKey,
      campaignName: row.campaign,
      adsetKey,
      adsetName: row.adset,
      adKey: "",
    };
    const adMeta: PerformanceDimensionMeta = {
      key: adKey,
      name: row.ad,
      campaignKey: row.campaignKey,
      campaignName: row.campaign,
      adsetKey,
      adsetName: row.adset,
      adKey,
    };

    if (!this.meta.has(adsetKey)) this.meta.set(adsetKey, adsetMeta);
    if (!this.meta.has(adKey)) this.meta.set(adKey, adMeta);
    this.adsetByAd.set(adKey, adsetKey);

    if (row.adId) {
      this.addCandidate(this.adByCampaignId, dimensionPair(row.campaignKey, row.adId), adKey);
      this.addCandidate(this.adByGlobalId, dimensionPart(row.adId), adKey);
    }
    if (row.ad) {
      this.addCandidate(this.adByCampaignName, dimensionPair(row.campaignKey, row.ad), adKey);
    }
    if (row.adset) {
      this.addCandidate(
        this.adsetByCampaignName,
        dimensionPair(row.campaignKey, row.adset),
        adsetKey,
      );
    }
  }

  fromAd(row: AdRow, grain: Grain): PerformanceDimensionMeta {
    if (grain === "campaign") {
      return this.campaign({ campaignKey: row.campaignKey, campaignName: row.campaign });
    }
    const { adsetKey, adKey } = this.keysForAd(row);
    return (
      this.meta.get(grain === "adset" ? adsetKey : adKey) ?? {
        key: grain === "adset" ? adsetKey : adKey,
        name: grain === "adset" ? row.adset : row.ad,
        campaignKey: row.campaignKey,
        campaignName: row.campaign,
        adsetKey,
        adsetName: row.adset,
        adKey,
      }
    );
  }

  private adForFact(row: AttributedFact): PerformanceDimensionMeta {
    const byId = row.adId
      ? this.unique(this.adByCampaignId, dimensionPair(row.campaignKey, row.adId)) ||
        this.unique(this.adByGlobalId, dimensionPart(row.adId))
      : "";
    const byName = row.adName
      ? this.unique(this.adByCampaignName, dimensionPair(row.campaignKey, row.adName))
      : "";
    const hit = this.meta.get(byId || byName);
    if (hit) return hit;

    const adKey = row.adId
      ? `ad-unmatched-id:${row.campaignKey || "no-campaign"}:${dimensionPart(row.adId)}`
      : `ad-unmatched-name:${row.campaignKey || "no-campaign"}:${dimensionPart(row.adName)}`;
    return {
      key: adKey,
      name: row.adName,
      campaignKey: row.campaignKey,
      campaignName: row.campaignName,
      adsetKey: "",
      adsetName: row.adset,
      adKey,
    };
  }

  private adsetForFact(row: AttributedFact): PerformanceDimensionMeta {
    const ad = this.adForFact(row);
    const viaAd = this.adsetByAd.get(ad.key);
    const viaName = row.adset
      ? this.unique(this.adsetByCampaignName, dimensionPair(row.campaignKey, row.adset))
      : "";
    const hit = this.meta.get(viaAd || viaName);
    if (hit) return hit;

    const adsetKey = row.adset
      ? `adset-unmatched:${row.campaignKey || "no-campaign"}:${dimensionPart(row.adset)}`
      : UNKNOWN_ADSET;
    return {
      key: adsetKey,
      name: row.adset,
      campaignKey: row.campaignKey,
      campaignName: row.campaignName,
      adsetKey,
      adsetName: row.adset,
      adKey: "",
    };
  }

  fromFact(row: AttributedFact, grain: Grain): PerformanceDimensionMeta {
    if (grain === "campaign") return this.campaign(row);
    return grain === "adset" ? this.adsetForFact(row) : this.adForFact(row);
  }
}

/* --- filtering ------------------------------------------------------------ */

export interface FilteredData {
  ads: AdRow[];
  crm: CrmLeadRow[];
  invoiced: InvoicedRow[];
  accounting: AccountingRow[];
  lost: LostRow[];
  snapshot: Snapshot;
  applied: GlobalFilters;
  /** Ad accounts whose objective is not lead generation. */
  nonLeadAccounts: string[];
  includeNonLead: boolean;
  cpaBasis: "won" | "invoices";
  /** True when an ad dimension narrows the view. Revenue still comes from Accounting
   * — this only tells the UI that unattributed invoices were filtered out. */
  attributionScoped: boolean;
}

export type CourseAttributionSource = "source_mapping" | "campaign_name" | "crm_leads" | "";

/**
 * Course attribution for one daily ad row.
 *
 * **Only the campaign declares the course.** Engosoft names it there —
 * `pmp-23-12-25-sayed t`, `Automotive - Riyadh - 4/7/26 - CBO - sh`,
 * `cmrp-16/7/26-sayed-t` — and names ad sets and creatives freely underneath.
 *
 * This once ran ad-first, on the theory that a campaign may hold several
 * courses, which let a creative called `auto profile` move an entire PMP
 * campaign's spend into Automotive. Reversing the order fixed that case and left
 * the mechanism intact: with ad-set and ad names kept as a fallback for
 * campaigns that name no course, `Traffic-all-web-20/7/26` — a Traffic campaign
 * on the `Engo soft website` account — still charged $172 to Interior and $31 to
 * CFM, because its ad sets are named `interior` and `cfm`.
 *
 * That is not a mis-parse, it is the whole idea being wrong. Awareness campaigns
 * are segmented by topic, so their ad sets carry course words while the campaign
 * sells nothing: `IG-traffic-11/1/26-SAYED`, `FB-Engagement-7/1/26-SAYED`,
 * `Video views-11/1/26-S`, `Demand Gen - 2026-01-06-SAYED`. Every one of them
 * produced zero CRM leads and zero revenue, so the ad-level fallback could only
 * ever add cost to a course's CPL and ROAS, never results. Across the live
 * workbook it moved $800 that way, and nothing else — no campaign that genuinely
 * sells a course depends on it.
 *
 * So a campaign whose name declares nothing now falls through to the modal
 * course of its own CRM leads, which is evidence rather than a guess, and to
 * nothing at all when it has no leads either.
 */
export function attributedAdCourse(
  row: AdRow,
  snapshot: Snapshot,
): { course: string; source: CourseAttributionSource; confidence: number } {
  if (row.courseHint) return { course: row.courseHint, source: "source_mapping", confidence: 1 };
  const campaignCourse = knownCourseFromText(row.campaign);
  if (campaignCourse) return { course: campaignCourse, source: "campaign_name", confidence: 1 };
  const meta = snapshot.campaigns.get(row.campaignKey);
  return {
    course: meta?.course ?? "",
    source: meta?.courseSource ?? "",
    confidence: meta?.courseDominance ?? 0,
  };
}

export async function getFiltered(f: GlobalFilters = {}): Promise<FilteredData> {
  const all = await loadAllData();
  const { accountingUsdPaid, fxRatesFromFilters } = await import("./fx-rates");
  const fxRates = fxRatesFromFilters(f);
  const {
    from,
    to,
    platform,
    channel,
    account,
    campaign,
    campaignKey: campaignKeyFilter,
    adset,
    adsetKey: adsetKeyFilter,
    ad,
    adKey: adKeyFilter,
    source,
    course,
    mainCategory,
    salesTeam,
    salesperson,
    company,
  } = f;
  const accountingDate = (row: AccountingRow): string =>
    accountingReportingDate(row, f.dateBasis === "invoice" ? "invoice" : "payment");

  const includeNonLead = f.includeNonLead === "1";
  const cpaBasis = f.cpaBasis === "invoices" ? "invoices" : "won";
  const sourceKey = source ? normalizeSource(source) : "";
  const attributionScoped = !!(
    platform ||
    channel ||
    account ||
    campaign ||
    campaignKeyFilter ||
    adset ||
    adsetKeyFilter ||
    ad ||
    adKeyFilter ||
    sourceKey
  );
  const dimensions = new PerformanceDimensionIndex(all.ads);

  // Account exists only on the platform facts. Cross-fact scoping is therefore
  // allowed only through an exact Campaign ID observed under that account. A
  // name-only row is excluded rather than guessed into the selected account.
  const accountCampaignIds = new Set(
    account
      ? all.ads
          .filter((row) => row.account === account && row.campaignId)
          .map((row) => row.campaignId)
      : [],
  );
  const matchesAccount = (campaignId: string): boolean =>
    !account || (!!campaignId && accountCampaignIds.has(campaignId));
  const matchesStableFact = (row: AttributedFact): boolean => {
    if (campaignKeyFilter && row.campaignKey !== campaignKeyFilter) return false;
    if (adsetKeyFilter && dimensions.fromFact(row, "adset").key !== adsetKeyFilter) return false;
    if (adKeyFilter && dimensions.fromFact(row, "ad").key !== adKeyFilter) return false;
    return true;
  };

  // Ads have no explicit course column. Names are checked from the most specific
  // dimension (ad) up to campaign, then the CRM modal-course fallback is used.
  const normalizedCourse = course ? normalizeName(course) : "";

  // CRM/invoice rows carry no platform column. A row belongs to a platform when
  // its campaign is one of that platform's campaigns, or when its source names
  // the platform (Snapchat leads exist in CRM well beyond Snap's 7-day spend).
  const platformCampaigns = new Set<string>();
  if (platform) {
    for (const a of all.ads) if (a.platform === platform) platformCampaigns.add(a.campaignKey);
  }
  const matchesPlatform = (campaignKey: string, srcKey: string): boolean => {
    if (channel === "organic") return isOrganicSourceKey(srcKey);
    if (!platform) return true;
    if (campaignKey && platformCampaigns.has(campaignKey)) return true;
    return PLATFORM_SOURCES[platform].includes(srcKey);
  };

  const ads = all.ads.filter((r) => {
    if (channel === "organic") return false;
    if (!inRange(r.date, from, to)) return false;
    if (platform && r.platform !== platform) return false;
    if (account && r.account !== account) return false;
    if (campaign && r.campaign !== campaign) return false;
    if (campaignKeyFilter && r.campaignKey !== campaignKeyFilter) return false;
    if (adset && r.adset !== adset) return false;
    if (adsetKeyFilter && dimensions.fromAd(r, "adset").key !== adsetKeyFilter) return false;
    if (ad && r.ad !== ad) return false;
    if (adKeyFilter && dimensions.fromAd(r, "ad").key !== adKeyFilter) return false;
    if (normalizedCourse && normalizeName(attributedAdCourse(r, all).course) !== normalizedCourse)
      return false;
    return true;
  });

  const crm = all.crm.filter((r) => {
    if (!inRange(r.createdAt, from, to)) return false;
    if (!matchesPlatform(r.campaignKey, r.sourceKey)) return false;
    if (!matchesAccount(r.campaignId)) return false;
    if (!matchesStableFact(r)) return false;
    if (campaign && r.campaignName !== campaign) return false;
    if (adset && r.adset !== adset) return false;
    if (ad && r.adName !== ad) return false;
    if (sourceKey && r.sourceKey !== sourceKey) return false;
    if (course && normalizeName(r.course) !== normalizeName(course)) return false;
    if (mainCategory && r.mainCategory !== mainCategory) return false;
    if (salesTeam && r.salesTeam !== salesTeam && r.subTeam !== salesTeam) return false;
    if (salesperson && r.salesperson !== salesperson) return false;
    return true;
  });

  const invoiced = all.invoiced.filter((r) => {
    if (!inRange(r.revenueDate, from, to)) return false;
    if (!matchesPlatform(r.campaignKey, r.sourceKey)) return false;
    if (!matchesAccount(r.campaignId)) return false;
    if (!matchesStableFact(r)) return false;
    if (campaign && r.campaignName !== campaign) return false;
    if (adset && r.adset !== adset) return false;
    if (ad && r.adName !== ad) return false;
    if (sourceKey && r.sourceKey !== sourceKey) return false;
    if (course && normalizeName(r.course) !== normalizeName(course)) return false;
    if (mainCategory && r.mainCategory !== mainCategory) return false;
    // `Sales Team` is filled on only ~16% of invoice lines, so a team filter
    // matches on salesperson too rather than discarding 84% of the revenue.
    if (salesTeam && r.salesTeam !== salesTeam && !teamHasPerson(all, salesTeam, r.salesperson))
      return false;
    if (salesperson && r.salesperson !== salesperson) return false;
    return true;
  });

  // Accounting rows carry direct campaign/ad/source dimensions when available,
  // with a legacy order bridge only for older workbooks.
  const accounting = all.accounting
    .filter((r) => {
      if (!inRange(accountingDate(r), from, to)) return false;
      if (company && r.company !== company) return false;
      if (!matchesPlatform(r.campaignKey, r.sourceKey)) return false;
      if (!matchesAccount(r.campaignId)) return false;
      if (!matchesStableFact(r)) return false;
      if (campaign && r.campaignName !== campaign) return false;
      if (adset && r.adset !== adset) return false;
      if (ad && r.adName !== ad) return false;
      if (sourceKey && r.sourceKey !== sourceKey) return false;
      if (course && normalizeName(r.course) !== normalizeName(course)) return false;
      if (mainCategory && r.mainCategory !== mainCategory) return false;
      // `فريق المبيعات` is sparse on paid invoice lines for the same reason it is
      // on order lines, so a team filter also matches through the salesperson.
      if (salesTeam && r.salesTeam !== salesTeam && !teamHasPerson(all, salesTeam, r.salesperson))
        return false;
      if (salesperson && r.salesperson !== salesperson) return false;
      return true;
    })
    .map((row) => {
      const usdPaid = accountingUsdPaid(row, fxRates);
      return { ...row, usdPaid, usdSales: usdPaid };
    });

  const lost = all.lost.filter((r) => {
    // Marketing analysis follows the lead cohort (creation date). The Lost page
    // can request the operational closure movement separately without mixing
    // old leads closed this month into this month's acquisition quality.
    const reportingDate =
      f.lostDateBasis === "closed" ? r.closeDate : archivedLostReportingDate(r, all);
    if (!inRange(reportingDate, from, to)) return false;
    if (!matchesPlatform(r.campaignKey, r.sourceKey)) return false;
    if (!matchesAccount(r.campaignId)) return false;
    if (!matchesStableFact(r)) return false;
    if (campaign && r.campaignName !== campaign) return false;
    if (adset && r.adset !== adset) return false;
    if (ad && r.adName !== ad) return false;
    if (sourceKey && r.sourceKey !== sourceKey) return false;
    if (course && normalizeName(r.course) !== normalizeName(course)) return false;
    if (mainCategory && r.mainCategory !== mainCategory) return false;
    if (salesTeam && r.salesTeam !== salesTeam) return false;
    if (salesperson && r.salesperson !== salesperson) return false;
    return true;
  });

  return {
    ads,
    crm,
    invoiced,
    accounting,
    lost,
    snapshot: all,
    applied: f,
    nonLeadAccounts: all.accounts.filter((a) => a.objective !== "leads").map((a) => a.name),
    includeNonLead,
    cpaBasis,
    attributionScoped,
  };
}

/** Maps a salesperson back to their team, for tabs that omit the team column. */
let personTeamCache: { snapshot: Snapshot; map: Map<string, string> } | null = null;
function teamHasPerson(all: Snapshot, team: string, person: string): boolean {
  if (!person) return false;
  if (personTeamCache?.snapshot !== all) {
    const map = new Map<string, string>();
    for (const c of all.crm) {
      if (c.salesperson && c.salesTeam && !map.has(c.salesperson))
        map.set(c.salesperson, c.salesTeam);
    }
    personTeamCache = { snapshot: all, map };
  }
  return personTeamCache.map.get(person) === team;
}

/** Default window: 1 January through the newest available source date. */
export async function getDefaultRange(): Promise<{ from: string; to: string }> {
  const all = await loadAllData();
  const latest =
    [all.adsDateMax, all.crmDateMax, all.revenueDateMax].filter(Boolean).sort().pop() ?? "";
  return { from: REPORTING_WINDOW_START, to: approvedReportingEnd(latest) };
}

/* --- close time ------------------------------------------------------------ */

/**
 * Mean days from lead creation to close, over leads that actually have a closing
 * date. In this sheet every one of those is a Won lead, so this reads as "time
 * to win". The sample size travels with the number and must always be shown.
 */
function closeStats(rows: CrmLeadRow[]): { avg: Maybe; sample: number } {
  let total = 0;
  let n = 0;
  for (const r of rows) {
    if (r.daysToClose === null || r.daysToClose < 0) continue;
    total += r.daysToClose;
    n++;
  }
  return { avg: div(total, n), sample: n };
}

/* --- lead population -------------------------------------------------------- */

/** Every archived CRM row, deduplicated by Odoo id. */
export function archivedCrmLeads(data: FilteredData): LostRow[] {
  const seen = new Set<string>();
  return data.lost.filter((row, index) => {
    const key = row.id || `row:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Reporting date for the archived population.
 *
 * Marketing Lost reporting follows the lead's Odoo creation date so the loss is
 * attributed to the acquisition cohort that produced it. Close Date remains
 * available for the separate operational movement report.
 */
export function archivedLostReportingDate(
  row: LostRow,
  _source: { health: import("./types").DataHealth },
): string {
  return row.createdAt;
}

const isArchivedWon = (row: LostRow): boolean => isArchivedWonStage(row.stage);

/**
 * The authoritative Lost population.
 *
 * CRM stage text never participates. The handful of archived rows still marked
 * Won remain valid leads/denominator rows but cannot also be losses.
 */
export function authoritativeLostLeads(data: FilteredData): LostRow[] {
  return archivedCrmLeads(data).filter((row) => !isArchivedWon(row));
}

/**
 * Does this archived row count as a win? See `archived-won.ts` for the rule and
 * for the campaign that exposed its absence.
 */
export function archivedWinCounter(data: FilteredData): (row: LostRow) => boolean {
  return archivedWinFilter(data.crm);
}

/* --- totals ---------------------------------------------------------------- */

export function computeTotals(data: FilteredData): Totals {
  const { ads, crm, invoiced, accounting, cpaBasis } = data;

  const spend = sum(ads, (a) => a.spend);
  const spendMeta = sum(
    ads.filter((a) => a.platform === "meta"),
    (a) => a.spend,
  );
  const spendSnap = sum(
    ads.filter((a) => a.platform === "snapchat"),
    (a) => a.spend,
  );
  const spendTikTok = sum(
    ads.filter((a) => a.platform === "tiktok"),
    (a) => a.spend,
  );
  const spendGoogle = sum(
    ads.filter((a) => a.platform === "google"),
    (a) => a.spend,
  );
  const nonLeadSpend = sum(
    ads.filter((a) => a.objective !== "leads"),
    (a) => a.spend,
  );
  // Management's approved formulas use the complete paid-media bill. Traffic
  // spend stays visible as a diagnostic, but is not silently removed from CPL,
  // CPA, ROAS or ACOS.
  const efficiencySpend = spend;

  const impressions = sum(ads, (a) => a.impressions);
  const clicksAll = sum(ads, (a) => a.clicksAll);
  const linkClicks = sumMaybe(ads, (a) => a.linkClicks);
  const platformLeads = sumMaybe(ads, (a) => a.platformLeads);

  // Link CTR is only defined over impressions from platforms that report link
  // clicks, so Snapchat impressions are excluded from its denominator.
  const linkImpressions = sum(
    ads.filter((a) => a.linkClicks !== null),
    (a) => a.impressions,
  );

  const allArchived = archivedCrmLeads(data);
  const archived = allArchived.filter((row) => !isArchivedWon(row));
  const archivedWon = allArchived.length - archived.length;
  const crmLeads = crm.length;
  const totalLeads = crmLeads + allArchived.length;
  // Archived rows keep their campaign columns, so a paid lead that was later
  // archived as lost still belongs in the paid denominator.
  const leadsFromCampaign =
    crm.filter((c) => c.fromCampaign).length +
    allArchived.filter((l) => !!l.campaignName || !!l.campaignId).length;
  const won =
    crm.filter((c) => c.isWon).length + allArchived.filter(archivedWinCounter(data)).length;
  const lostInCrm = 0;
  const lost = archived.length;
  // Close time stays on CRM rows: archived rows carry no closing date, and
  // padding the sample with zeros would drag the average toward nothing.
  const { avg: avgCloseDays, sample: closeSample } = closeStats(crm);

  // Money has exactly one primary source: Accounting.USD Paid, dated by
  // Payment Date. Sales orders never define recognised revenue.
  const accountingRevenue = sum(accounting, (r) => r.usdPaid);
  const orderRevenue = sum(invoiced, (r) => r.usdSales);
  const revenue = accountingRevenue;
  const adCampaignKeys = new Set(data.ads.map((a) => a.campaignKey).filter(Boolean));
  const attributedRevenue = sum(
    accounting.filter((r) => r.campaignKey && adCampaignKeys.has(r.campaignKey)),
    (r) => r.usdPaid,
  );
  const attributedOrderRevenue = sum(
    invoiced.filter((r) => r.campaignKey && adCampaignKeys.has(r.campaignKey)),
    (r) => r.usdSales,
  );
  const unmatchedRevenue = sum(
    accounting.filter((r) => !r.orderMatched),
    (r) => r.usdPaid,
  );
  // The Accounting sheet is at product-line grain. Only a real Move identifies
  // an invoice; falling back to line count would multiply invoices that contain
  // more than one product and make CPA/AOV silently wrong.
  const orders = new Set(
    accounting
      .filter((r) => !r.isCreditNote)
      .map((r) => r.movement)
      .filter(Boolean),
  ).size;
  const invoicedOrders =
    new Set(invoiced.map((r) => r.orderRef).filter(Boolean)).size || invoiced.length;

  const cpaWon = div(efficiencySpend, won);
  const cpaInvoices = div(efficiencySpend, orders);

  return {
    spend,
    spendMeta,
    spendSnap,
    spendTikTok,
    spendGoogle,
    nonLeadSpend,
    efficiencySpend,
    impressions,
    clicksAll,
    linkClicks,
    ctrAll: pctOf(clicksAll, impressions),
    ctrLink: linkClicks === null ? null : pctOf(linkClicks, linkImpressions),
    cpm: (() => {
      const r = div(spend, impressions);
      return r === null ? null : r * 1000;
    })(),
    cpc: div(spend, clicksAll),
    platformLeads,

    crmLeads,
    archivedLeads: allArchived.length,
    totalLeads,
    leadsFromCampaign,
    leadsOther: totalLeads - leadsFromCampaign,
    won,
    lost,
    lostInCrm,
    lostArchived: lost,
    archivedWon,
    conversionRate: pctOf(won, totalLeads),
    lostRate: pctOf(lost, totalLeads),
    avgCloseDays,
    closeSample,

    revenue,
    accountingRevenue,
    orderRevenue,
    attributedRevenue,
    attributedOrderRevenue,
    unmatchedRevenue,
    orders,
    invoicedOrders,
    avgOrder: div(revenue, orders),
    revenuePerLead: div(revenue, totalLeads),

    // Approved CPL: total ad spend ÷ leads reported by Meta/Snap.
    cpl: platformLeads === null ? null : div(spend, platformLeads),
    platformCpl: platformLeads === null ? null : div(spend, platformLeads),
    // The honest paid CPL: only leads that actually carry a campaign.
    attributedCpl: div(spend, leadsFromCampaign),
    cpa: cpaWon,
    cpaWon,
    cpaInvoices,
    roas: div(revenue, efficiencySpend),
    attributedRoas: div(attributedRevenue, efficiencySpend),
    acos: (() => {
      const r = div(efficiencySpend, revenue);
      return r === null ? null : r * 100;
    })(),
    attributedAcos: (() => {
      const r = div(efficiencySpend, attributedRevenue);
      return r === null ? null : r * 100;
    })(),
  };
}

/* --- performance rows (campaign / ad set / ad) ------------------------------ */

export type Grain = "campaign" | "adset" | "ad";

interface Bucket {
  key: string;
  name: string;
  campaignKey: string;
  campaignName: string;
  adsetKey: string;
  adsetName: string;
  adKey: string;
  platforms: Set<Platform>;
  objective: import("./types").CampaignObjective;
  course: string;
  courseInferred: boolean;
  adsetOrigin?: import("./types").AdSetOrigin;
  spend: number;
  impressions: number;
  clicksAll: number;
  linkClicks: number | null;
  platformLeads: number | null;
  crmLeads: number;
  won: number;
  lost: number;
  revenue: number;
  invoiceRefs: Set<string>;
  salesOrderRefs: Set<string>;
  closeTotal: number;
  closeSample: number;
  spendDates: Set<string>;
  revenueByDate: Map<string, number>;
}

/** Above this share of revenue landing outside the spend window, ratios lie. */
const PARTIAL_SPEND_THRESHOLD = 0.3;

export function computePerf(data: FilteredData, grain: Grain): PerfRow[] {
  const buckets = new Map<string, Bucket>();
  const dimensions = new PerformanceDimensionIndex(data.snapshot.ads);

  const touch = (dimension: PerformanceDimensionMeta): Bucket => {
    let b = buckets.get(dimension.key);
    if (!b) {
      b = {
        key: dimension.key,
        name: dimension.name,
        campaignKey: dimension.campaignKey,
        campaignName: dimension.campaignName,
        adsetKey: dimension.adsetKey,
        adsetName: dimension.adsetName,
        adKey: dimension.adKey,
        platforms: new Set(),
        objective: "leads",
        course: "",
        courseInferred: false,
        spend: 0,
        impressions: 0,
        clicksAll: 0,
        linkClicks: null,
        platformLeads: null,
        crmLeads: 0,
        won: 0,
        lost: 0,
        revenue: 0,
        invoiceRefs: new Set(),
        salesOrderRefs: new Set(),
        closeTotal: 0,
        closeSample: 0,
        spendDates: new Set(),
        revenueByDate: new Map(),
      };
      buckets.set(dimension.key, b);
    }
    if (!b.name && dimension.name) b.name = dimension.name;
    if (!b.campaignKey && dimension.campaignKey) b.campaignKey = dimension.campaignKey;
    if (!b.campaignName && dimension.campaignName) b.campaignName = dimension.campaignName;
    if (!b.adsetKey && dimension.adsetKey) b.adsetKey = dimension.adsetKey;
    if (!b.adsetName && dimension.adsetName) b.adsetName = dimension.adsetName;
    if (!b.adKey && dimension.adKey) b.adKey = dimension.adKey;
    return b;
  };

  for (const a of data.ads) {
    const dimension = dimensions.fromAd(a, grain);
    if (!dimension.key) continue;
    const b = touch(dimension);
    b.platforms.add(a.platform);
    if (a.objective !== "leads") b.objective = a.objective;
    b.spend += a.spend;
    b.impressions += a.impressions;
    b.clicksAll += a.clicksAll;
    if (a.date && a.spend > 0) b.spendDates.add(a.date);
    if (a.linkClicks !== null) b.linkClicks = (b.linkClicks ?? 0) + a.linkClicks;
    if (a.platformLeads !== null) b.platformLeads = (b.platformLeads ?? 0) + a.platformLeads;
    if (grain === "campaign") {
      const meta = data.snapshot.campaigns.get(a.campaignKey);
      if (meta?.course && !b.course) {
        b.course = meta.course;
        b.courseInferred = true;
      }
    }
  }

  // Unresolved ad-set rows go into an explicit bucket with real totals rather
  // than being dropped, which would make the column silently under-count.
  for (const c of data.crm) {
    const dimension = dimensions.fromFact(c, grain);
    if (!dimension.key || (grain === "campaign" && !c.fromCampaign)) continue;
    if (grain !== "campaign" && !c.adName && !c.adId) continue;
    const b = touch(dimension);
    b.crmLeads++;
    if (c.isWon) b.won++;
    if (c.daysToClose !== null && c.daysToClose >= 0) {
      b.closeTotal += c.daysToClose;
      b.closeSample++;
    }
    if (grain === "adset" && !b.adsetOrigin) b.adsetOrigin = c.adsetOrigin;
    if (!b.course && c.course) b.course = c.course;
  }

  // Lost counts and their denominators come exclusively from the authoritative
  // archived population. CRM stage text never increments this counter.
  const archivedWin = archivedWinCounter(data);
  for (const l of archivedCrmLeads(data)) {
    const dimension = dimensions.fromFact(l, grain);
    if (!dimension.key || (grain === "campaign" && !l.campaignKey)) continue;
    if (grain !== "campaign" && !l.adName && !l.adId) continue;
    const b = touch(dimension);
    b.crmLeads++;
    if (archivedWin(l)) b.won++;
    else if (!isArchivedWon(l)) b.lost++;
    if (!b.course && l.course) b.course = l.course;
  }

  // Revenue on every performance row is paid Accounting revenue. Campaign
  // dimensions are direct when available and use the legacy order bridge only
  // during migration.
  for (const s of data.accounting) {
    const dimension = dimensions.fromFact(s, grain);
    if (!dimension.key || (grain === "campaign" && !s.campaignKey)) continue;
    if (grain !== "campaign" && !s.adName && !s.adId) continue;
    const b = touch(dimension);
    b.revenue += s.usdPaid;
    if (s.movement && !s.isCreditNote) b.invoiceRefs.add(s.movement);
    const revenueDate = accountingReportingDate(s, data.applied.dateBasis ?? "payment");
    if (revenueDate)
      b.revenueByDate.set(revenueDate, (b.revenueByDate.get(revenueDate) ?? 0) + s.usdPaid);
  }

  // Full Invoiced Orders remain advisory, but their distinct order references
  // are useful operational context beside the authoritative paid invoices.
  for (const order of data.invoiced) {
    const dimension = dimensions.fromFact(order, grain);
    if (!dimension.key || (grain === "campaign" && !order.campaignKey)) continue;
    if (grain !== "campaign" && !order.adName && !order.adId) continue;
    const b = touch(dimension);
    if (order.orderRef) b.salesOrderRefs.add(order.orderRef);
  }

  const rows: PerfRow[] = [];
  for (const b of buckets.values()) {
    const linkImpressions = b.linkClicks === null ? 0 : b.impressions;

    // A row whose revenue mostly predates its spend data cannot support a ratio.
    const spendDays = [...b.spendDates].sort();
    const spendDateMin = spendDays[0] ?? "";
    const spendDateMax = spendDays[spendDays.length - 1] ?? "";
    let insideRevenue = 0;
    for (const [date, amount] of b.revenueByDate) {
      if (spendDateMin && date >= spendDateMin && date <= spendDateMax) insideRevenue += amount;
    }
    const spendCoverage = b.revenue > 0 && spendDateMin ? insideRevenue / b.revenue : null;
    const partialSpend =
      b.spend > 0 &&
      b.revenue > 0 &&
      spendCoverage !== null &&
      spendCoverage < 1 - PARTIAL_SPEND_THRESHOLD;

    rows.push({
      spendDateMin,
      spendDateMax,
      partialSpend,
      spendCoverage,
      key: b.key,
      name: b.key === UNKNOWN_ADSET ? "" : b.name || "—",
      campaignKey: b.campaignKey,
      campaignName: b.campaignName,
      adsetKey: b.adsetKey,
      adsetName: b.adsetName,
      adKey: b.adKey,
      platforms: [...b.platforms],
      course: b.course,
      courseInferred: b.courseInferred,
      adsetOrigin: b.key === UNKNOWN_ADSET ? "unknown" : b.adsetOrigin,
      objective: b.objective,
      spend: b.spend,
      impressions: b.impressions,
      clicksAll: b.clicksAll,
      linkClicks: b.linkClicks,
      ctrAll: pctOf(b.clicksAll, b.impressions),
      ctrLink: b.linkClicks === null ? null : pctOf(b.linkClicks, linkImpressions),
      cpm: (() => {
        const r = div(b.spend, b.impressions);
        return r === null ? null : r * 1000;
      })(),
      cpc: div(b.spend, b.clicksAll),
      platformLeads: b.platformLeads,
      crmLeads: b.crmLeads,
      won: b.won,
      lost: b.lost,
      conversionRate: pctOf(b.won, b.crmLeads),
      lostRate: pctOf(b.lost, b.crmLeads),
      revenue: b.revenue,
      invoices: b.invoiceRefs.size,
      salesOrders: b.salesOrderRefs.size,
      revenuePerLead: div(b.revenue, b.crmLeads),
      cpl: b.platformLeads === null ? null : div(b.spend, b.platformLeads),
      cpa: data.cpaBasis === "invoices" ? div(b.spend, b.invoiceRefs.size) : div(b.spend, b.won),
      roas: div(b.revenue, b.spend),
      acos: (() => {
        const r = div(b.spend, b.revenue);
        return r === null ? null : r * 100;
      })(),
      avgCloseDays: div(b.closeTotal, b.closeSample),
      closeSample: b.closeSample,
    });
  }

  return rows.sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);
}

export const UNKNOWN_ADSET_KEY = UNKNOWN_ADSET;

/* --- spotlights ------------------------------------------------------------ */

/**
 * Spotlights must be decision-grade, so a row qualifies only when its spend is
 * material against the period's total and its spend data actually covers the
 * period its revenue came from. Without the first guard a $125 campaign wins on
 * a rounding error; without the second, a campaign with 5 days of cost and 7
 * months of revenue reports a fictional 18× return.
 */
function materialSpend(rows: PerfRow[], floor: number): number {
  const total = rows.reduce((s, r) => s + r.spend, 0);
  return Math.max(floor, total * 0.01);
}

function decisionGrade(rows: PerfRow[], floor: number): PerfRow[] {
  const min = materialSpend(rows, floor);
  return rows.filter((r) => r.spend >= min && r.objective === "leads" && !r.partialSpend);
}

export function bestCampaign(rows: PerfRow[], minSpend = 100): PerfRow | null {
  let eligible = decisionGrade(rows, minSpend).filter((r) => r.revenue > 0);
  if (!eligible.length)
    eligible = rows.filter((r) => r.spend > 0 && r.revenue > 0 && !r.partialSpend);
  if (!eligible.length) return null;
  return eligible.reduce((a, b) => ((b.roas ?? 0) > (a.roas ?? 0) ? b : a));
}

/**
 * A leak is money that did not come back, so rows are ranked by unrecovered
 * spend (spend − revenue) and must actually be under water. Ranking by a
 * spend/ROAS blend instead nominates the biggest *profitable* campaign, which
 * is the opposite of the question being asked.
 */
export function moneyLeak(rows: PerfRow[], minSpend = 100): PerfRow | null {
  const graded = decisionGrade(rows, minSpend);
  const underwater = graded.filter((r) => r.roas === null || r.roas < 1);
  const pool = underwater.length ? underwater : graded;
  if (!pool.length) return null;
  const unrecovered = (r: PerfRow) => r.spend - r.revenue;
  return pool.reduce((worst, r) => (unrecovered(r) > unrecovered(worst) ? r : worst));
}

/** Cheapest CPL, gated on real volume so a two-lead campaign can't win. */
export function bestCPL(rows: PerfRow[], minLeads = 20, minSpend = 50): PerfRow | null {
  let eligible = rows.filter(
    (r) =>
      r.cpl !== null &&
      r.spend >= minSpend &&
      (r.platformLeads ?? 0) >= minLeads &&
      r.objective === "leads" &&
      !r.partialSpend,
  );
  if (!eligible.length)
    eligible = rows.filter((r) => r.cpl !== null && (r.platformLeads ?? 0) >= 5 && !r.partialSpend);
  if (!eligible.length) return null;
  return eligible.reduce((a, b) => ((b.cpl ?? Infinity) < (a.cpl ?? Infinity) ? b : a));
}

export function topLeaks(rows: PerfRow[], n = 5): PerfRow[] {
  return rows
    .filter((r) => r.spend > 0 && !r.partialSpend && (r.roas === null || r.roas < 1))
    .sort((a, b) => b.spend - b.revenue - (a.spend - a.revenue))
    .slice(0, n);
}

function campaignActivityIdentity(row: PerfRow): string {
  return `${row.platforms.slice().sort().join("|")}:${row.key}`;
}

/**
 * Keep the most expensive campaigns first without allowing a high-volume
 * platform to push every smaller source out of the alert. Each represented
 * platform gets one row before the remaining slots are filled by spend.
 */
function platformBalancedRows(rows: PerfRow[], limit: number): PerfRow[] {
  const sorted = [...rows].sort((a, b) => b.spend - a.spend);
  const selected: PerfRow[] = [];
  const seen = new Set<string>();

  for (const platform of PLATFORMS) {
    const row = sorted.find((candidate) => candidate.platforms.includes(platform));
    if (!row) continue;
    const identity = campaignActivityIdentity(row);
    if (seen.has(identity)) continue;
    selected.push(row);
    seen.add(identity);
  }

  for (const row of sorted) {
    if (selected.length >= limit) break;
    const identity = campaignActivityIdentity(row);
    if (seen.has(identity)) continue;
    selected.push(row);
    seen.add(identity);
  }

  // Representation decides who survives the cut; spend decides the reading
  // order. Otherwise a $7 row reserved for a small platform sits above a $45
  // one and the list looks unsorted.
  return selected.slice(0, limit).sort((a, b) => b.spend - a.spend);
}

/**
 * Operational "running now" signal.
 *
 * The official campaign switch comes from the platform APIs. Google Ads is
 * read directly by this server; Meta, Snapchat and TikTok use the shared live
 * status collector. Recent spend is reporting context only.
 */
export async function computeRecentCampaignActivity(
  filters: GlobalFilters,
  current: FilteredData,
): Promise<import("./types").CampaignActivity> {
  const empty: import("./types").CampaignActivity = {
    window: null,
    platformWindows: {},
    definition: "official_status",
    source: "daily_proxy",
    generatedAt: "",
    platformHealth: [],
    delivery: {},
    period: {},
    rows: [],
    best: null,
    worst: null,
    zeroResult: [],
    atRisk: [],
    lifetime: {},
  };
  // Organic is an Odoo source classification, not an ad platform. Do not call
  // Meta/Google status APIs for this view: there is no delivery state to show,
  // and doing so would add latency and paid API work to an unrelated filter.
  if (filters.channel === "organic") return empty;
  const history = await getFiltered({ ...filters, from: undefined, to: undefined, range: "all" });
  const lifetimeRows = new Map(computePerf(history, "campaign").map((row) => [row.key, row]));
  const eligibleCampaignKeys = new Set([
    ...history.ads.map((row) => row.campaignKey),
    ...history.crm.map((row) => row.campaignKey),
    ...history.accounting.map((row) => row.campaignKey),
  ]);
  const selectedPlatforms = filters.platform ? [filters.platform] : PLATFORMS;
  const platformWindows: Partial<Record<Platform, { from: string; to: string }>> = {};
  const delivery: Record<string, CampaignOperationalState> = {};
  const period: Record<string, import("./types").CampaignPeriodSummary> = {};
  const rows: PerfRow[] = [];

  if (current.applied.from && current.applied.to) {
    for (const platform of selectedPlatforms) {
      platformWindows[platform] = {
        from: current.applied.from,
        to: current.applied.to,
      };
    }
  }

  const operationalRow = (state: CampaignOperationalState): PerfRow => {
    const life = lifetimeRows.get(state.campaignKey);
    const campaign = history.snapshot.campaigns.get(state.campaignKey);
    const day = state.checkedAt.slice(0, 10);
    return {
      key: state.campaignKey,
      name: state.name,
      campaignKey: state.campaignKey,
      campaignName: state.name,
      adsetKey: "",
      adsetName: "",
      adKey: "",
      platforms: [state.platform],
      course: life?.course || campaign?.course || "",
      courseInferred: life?.courseInferred ?? campaign?.courseSource === "crm_leads",
      objective: life?.objective || campaign?.objective || "unknown",
      spend: state.spend24h,
      impressions: state.impressions24h,
      clicksAll: state.clicks24h,
      linkClicks: null,
      ctrAll: pctOf(state.clicks24h, state.impressions24h),
      ctrLink: null,
      cpm: state.impressions24h > 0 ? (state.spend24h / state.impressions24h) * 1000 : null,
      cpc: div(state.spend24h, state.clicks24h),
      platformLeads: state.platformLeads24h,
      crmLeads: 0,
      won: 0,
      lost: 0,
      conversionRate: null,
      lostRate: null,
      revenue: 0,
      invoices: 0,
      salesOrders: 0,
      revenuePerLead: null,
      cpl: state.platformLeads24h === null ? null : div(state.spend24h, state.platformLeads24h),
      cpa: null,
      roas: null,
      acos: null,
      avgCloseDays: null,
      closeSample: 0,
      spendDateMin: state.spend24h > 0 ? day : "",
      spendDateMax: state.spend24h > 0 ? day : "",
      partialSpend: false,
      spendCoverage: null,
    };
  };

  const deeperDimensionFilter = !!(
    filters.adset ||
    filters.adsetKey ||
    filters.ad ||
    filters.adKey ||
    filters.source ||
    filters.course ||
    filters.mainCategory ||
    filters.salesTeam ||
    filters.salesperson
  );
  const acceptsState = (state: CampaignOperationalState): boolean => {
    if (!selectedPlatforms.includes(state.platform)) return false;
    if (filters.account && state.account !== filters.account) return false;
    if (filters.campaign && state.name !== filters.campaign) return false;
    if (filters.campaignKey && state.campaignKey !== filters.campaignKey) return false;
    if (deeperDimensionFilter && !eligibleCampaignKeys.has(state.campaignKey)) return false;
    return state.deliveryState === "active";
  };

  // Spend never decides whether a campaign is Active. Google is deliberately
  // read direct here so its OAuth authority cannot drift from the reporting API.
  const [live, googleDirect] = await Promise.all([
    loadMetaLiveStatus(),
    fetchGoogleAdsCampaignStatus(),
  ]);
  const collectorStates: CampaignOperationalState[] = (live?.campaigns ?? [])
    .filter((state) => state.platform !== "google")
    .map((state) => ({
      ...state,
      campaignKey: `id:${state.campaignId}`,
    }));
  const directStates = googleDirect.health.ok
    ? [...collectorStates, ...googleDirect.campaigns]
    : [
        ...collectorStates,
        ...(live?.campaigns ?? [])
          .filter((state) => state.platform === "google")
          .map((state) => ({ ...state, campaignKey: `id:${state.campaignId}` })),
      ];
  const fallbackStates = history.snapshot.campaignStates;
  const usingDirectState = !!(live || googleDirect.health.ok);
  const statePool = usingDirectState ? directStates : fallbackStates;
  const now = Date.now();
  // A stale recovery row used to resurrect campaigns long after the team had
  // closed them. Require a recent platform check and actual delivery eligibility
  // before a campaign can enter any Active count or risk alert.
  const currentStates = statePool.filter((state) => isOperationalStateCurrent(state, now));
  const officialStates = currentStates.filter(acceptsState);
  const rawPlatformHealth = (() => {
    const collectorHealth = (live?.platformHealth ?? []).filter(
      (entry) => entry.platform !== "google",
    );
    return [...collectorHealth, googleDirect.health];
  })();
  const platformHealth = usingDirectState
    ? rawPlatformHealth.map((entry) => ({
        ...entry,
        active: entry.ok
          ? currentStates.filter((state) => state.platform === entry.platform).length
          : 0,
      }))
    : PLATFORMS.map((platform) => ({
        platform,
        ok: currentStates.some((state) => state.platform === platform),
        active: currentStates.filter((state) => state.platform === platform).length,
        total: fallbackStates.filter((state) => state.platform === platform).length,
        message: "",
        checkedAt: fallbackStates.find((state) => state.platform === platform)?.checkedAt || "",
      }));
  const stateSource = googleDirect.health.ok
    ? "platform_direct"
    : live
      ? "n8n_live"
      : fallbackStates.length
        ? "google_snapshot"
        : "daily_proxy";

  // The campaign switch ignores the date filter; only these business figures
  // follow it. This is the central distinction the UI communicates.
  const periodRows = computePerf(current, "campaign");
  const periodByKey = new Map<string, PerfRow>();
  const periodByName = new Map<string, PerfRow>();
  const periodAnyByKey = new Map<string, PerfRow>();
  const periodAnyByName = new Map<string, PerfRow>();
  for (const row of periodRows) {
    periodAnyByKey.set(row.key, row);
    periodAnyByName.set(normalizeName(row.name), row);
    for (const platform of row.platforms) {
      periodByKey.set(`${platform}|${row.key}`, row);
      periodByName.set(`${platform}|${normalizeName(row.name)}`, row);
    }
  }

  const activeCrmLeadsByKey = new Map<string, number>();
  const activeCrmLeadsByName = new Map<string, number>();
  for (const lead of current.crm) {
    if (!lead.fromCampaign) continue;
    if (lead.campaignKey) {
      activeCrmLeadsByKey.set(
        lead.campaignKey,
        (activeCrmLeadsByKey.get(lead.campaignKey) ?? 0) + 1,
      );
    }
    const name = normalizeName(lead.campaignName);
    if (name) activeCrmLeadsByName.set(name, (activeCrmLeadsByName.get(name) ?? 0) + 1);
  }

  for (const original of officialStates) {
    const inPeriod =
      periodByKey.get(`${original.platform}|${original.campaignKey}`) ||
      periodByName.get(`${original.platform}|${normalizeName(original.name)}`) ||
      periodAnyByKey.get(original.campaignKey) ||
      periodAnyByName.get(normalizeName(original.name));
    const campaignKey = inPeriod?.key || original.campaignKey;
    const state: CampaignOperationalState = {
      ...original,
      campaignKey,
      spend24h: inPeriod?.spend ?? 0,
      impressions24h: inPeriod?.impressions ?? 0,
      clicks24h: inPeriod?.clicksAll ?? 0,
      platformLeads24h: inPeriod?.platformLeads ?? null,
    };
    delivery[campaignKey] = state;
    const crmLeads =
      activeCrmLeadsByKey.get(campaignKey) ??
      activeCrmLeadsByKey.get(original.campaignKey) ??
      activeCrmLeadsByName.get(normalizeName(original.name)) ??
      0;
    period[campaignKey] = {
      spend: inPeriod?.spend ?? 0,
      crmLeads,
      lostArchived: inPeriod?.lost ?? 0,
      won: inPeriod?.won ?? 0,
      invoices: inPeriod?.invoices ?? 0,
      salesOrders: inPeriod?.salesOrders ?? 0,
      revenue: inPeriod?.revenue ?? 0,
      roas: inPeriod?.roas ?? null,
    };
    rows.push(inPeriod ?? operationalRow(state));
  }

  if (!rows.length) {
    return {
      ...empty,
      source: stateSource,
      generatedAt:
        googleDirect.health.checkedAt || live?.generatedAt || fallbackStates[0]?.checkedAt || "",
      platformHealth,
      delivery,
      period,
      platformWindows,
    };
  }

  const spendingRows = rows.filter((row) => row.spend > 0);
  const decisionRows: PerfRow[] = [];
  for (const platform of selectedPlatforms) {
    const platformRows = spendingRows.filter((row) => row.platforms.includes(platform));
    const platformSpend = platformRows.reduce((total, row) => total + row.spend, 0);
    const materialFloor = Math.max(5, Math.min(25, platformSpend * 0.1));
    decisionRows.push(...platformRows.filter((row) => row.spend >= materialFloor));
  }

  const zeroResult = decisionRows
    .filter(
      (row) =>
        (row.platformLeads ?? 0) <= 0 &&
        row.crmLeads <= 0 &&
        row.won <= 0 &&
        row.invoices <= 0 &&
        row.salesOrders <= 0 &&
        row.revenue <= 0,
    )
    .sort((a, b) => b.spend - a.spend);

  const neverSold = (row: PerfRow): boolean => {
    const life = lifetimeRows.get(row.key);
    // No history row means no evidence of failure. Staying silent beats
    // accusing a campaign the join could not resolve.
    if (!life) return false;
    return life.won <= 0 && life.invoices <= 0 && life.salesOrders <= 0 && life.revenue <= 0;
  };
  const atRisk = decisionRows.filter(neverSold).sort((a, b) => b.spend - a.spend);
  const atRiskKeys = new Set(atRisk.map((row) => row.key));
  /** Money this campaign consumed that never came back, over its whole life. */
  const unrecovered = (row: PerfRow): number => {
    const life = lifetimeRows.get(row.key);
    return (life?.spend ?? row.spend) - (life?.revenue ?? row.revenue);
  };

  // A campaign that has never collected a pound cannot be the best performer,
  // however busy its last 24 hours look.
  const bestPool = decisionRows.filter(
    (row) =>
      !atRiskKeys.has(row.key) &&
      ((row.platformLeads ?? 0) > 0 || row.crmLeads > 0 || row.revenue > 0),
  );
  const best =
    [...bestPool].sort((a, b) => {
      const lifeA = lifetimeRows.get(a.key);
      const lifeB = lifetimeRows.get(b.key);
      // Money collected now, then money collected ever, then pipeline. Ranking
      // by CRM Won first crowned a campaign holding one unpaid deal over one
      // that had actually banked thousands.
      return (
        b.revenue - a.revenue ||
        (lifeB?.revenue ?? 0) - (lifeA?.revenue ?? 0) ||
        b.won - a.won ||
        (b.platformLeads ?? 0) - (a.platformLeads ?? 0)
      );
    })[0] ?? null;
  const worstPool = decisionRows.filter((row) => row !== best);
  const worst =
    [...worstPool].sort((a, b) => {
      // A campaign that has never returned anything outranks one merely having
      // a slow 24 hours, however large that campaign's recent spend is.
      const riskDelta = (atRiskKeys.has(b.key) ? 1 : 0) - (atRiskKeys.has(a.key) ? 1 : 0);
      return riskDelta || unrecovered(b) - unrecovered(a);
    })[0] ?? null;

  const rankedActive = [...rows].sort((a, b) => {
    const lifeA = lifetimeRows.get(a.key);
    const lifeB = lifetimeRows.get(b.key);
    return (
      b.spend - a.spend ||
      (lifeB?.revenue ?? 0) - (lifeA?.revenue ?? 0) ||
      a.name.localeCompare(b.name)
    );
  });
  // The headline count and detail list must describe the same population.
  // Never cut this list to a UI-friendly sample: every Active campaign belongs.
  const selectedRows = rankedActive;
  const selectedZeroResult = platformBalancedRows(zeroResult, 12);
  const selectedAtRisk = platformBalancedRows(atRisk, 12);
  const lifetime: Record<string, import("./types").CampaignLifetime> = {};
  for (const row of [...selectedRows, ...selectedZeroResult, ...selectedAtRisk, best, worst]) {
    if (!row || lifetime[row.key]) continue;
    const life = lifetimeRows.get(row.key);
    if (!life) continue;
    lifetime[row.key] = {
      spend: life.spend,
      platformLeads: life.platformLeads,
      crmLeads: life.crmLeads,
      won: life.won,
      invoices: life.invoices,
      salesOrders: life.salesOrders,
      revenue: life.revenue,
      roas: life.roas,
      firstSpendDate: life.spendDateMin,
      lastSpendDate: life.spendDateMax,
    };
  }

  return {
    window: (() => {
      const windows = Object.values(platformWindows);
      if (!windows.length) return null;
      return {
        from: windows.reduce(
          (min, window) => (window.from < min ? window.from : min),
          windows[0].from,
        ),
        to: windows.reduce((max, window) => (window.to > max ? window.to : max), windows[0].to),
      };
    })(),
    platformWindows,
    definition: "official_status",
    source: stateSource,
    generatedAt:
      googleDirect.health.checkedAt ||
      live?.generatedAt ||
      Object.values(delivery).reduce(
        (max, state) => (state.checkedAt > max ? state.checkedAt : max),
        "",
      ),
    platformHealth:
      platformHealth.length > 0
        ? platformHealth
        : PLATFORMS.map((platform) => ({
            platform,
            ok: fallbackStates.some((state) => state.platform === platform),
            active: fallbackStates.filter((state) => state.platform === platform).length,
            total: fallbackStates.filter((state) => state.platform === platform).length,
            message: "",
            checkedAt: fallbackStates.find((state) => state.platform === platform)?.checkedAt || "",
          })),
    delivery,
    period,
    rows: selectedRows,
    best,
    worst,
    zeroResult: selectedZeroResult,
    atRisk: selectedAtRisk,
    lifetime,
  };
}

/* --- funnel & trend -------------------------------------------------------- */

export function computeFunnel(t: Totals): FunnelStep[] {
  return [
    { key: "impressions", value: t.impressions },
    { key: "clicks", value: t.clicksAll },
    { key: "platform_leads", value: t.platformLeads, note: "meta_only" },
    // CRM holds leads from UChat, WhatsApp, referrals and other sources with no
    // matching spend feed, so this stage can legitimately exceed the one above.
    { key: "crm_leads", value: t.totalLeads, note: "includes_unpaid_sources" },
    { key: "won", value: t.won },
  ];
}

export function dailyTrend(
  data: FilteredData,
): { date: string; spend: number; revenue: number; leads: number; won: number }[] {
  const map = new Map<string, { spend: number; revenue: number; leads: number; won: number }>();
  const at = (d: string) => {
    let e = map.get(d);
    if (!e) {
      e = { spend: 0, revenue: 0, leads: 0, won: 0 };
      map.set(d, e);
    }
    return e;
  };
  for (const a of data.ads) if (a.date) at(a.date).spend += a.spend;
  // Always the accounting series, whatever the filter — one revenue definition.
  for (const row of data.accounting) {
    const revenueDate = accountingReportingDate(row, data.applied.dateBasis ?? "payment");
    if (revenueDate) at(revenueDate).revenue += row.usdPaid;
  }
  for (const c of data.crm) {
    if (!c.createdAt) continue;
    const e = at(c.createdAt);
    e.leads++;
    if (c.isWon) e.won++;
  }
  const archivedWinOnDay = archivedWinCounter(data);
  for (const l of archivedCrmLeads(data)) {
    const date = archivedLostReportingDate(l, data.snapshot);
    if (!date) continue;
    at(date).leads++;
    if (archivedWinOnDay(l)) at(date).won++;
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, ...v }));
}

/* --- courses --------------------------------------------------------------- */

export function computeCourses(data: FilteredData, prev?: FilteredData): CourseAgg[] {
  const map = new Map<string, CourseAgg & { closeTotal: number }>();
  const get = (course: string, cat: string) => {
    const key = normalizeName(course);
    let a = map.get(key);
    if (!a) {
      a = {
        key,
        name: course,
        campaignKey: "",
        campaignName: "",
        adsetKey: "",
        adsetName: "",
        adKey: "",
        platforms: [],
        course,
        courseInferred: false,
        objective: "leads",
        mainCategory: cat,
        spend: 0,
        impressions: 0,
        clicksAll: 0,
        linkClicks: null,
        ctrAll: null,
        ctrLink: null,
        cpm: null,
        cpc: null,
        platformLeads: null,
        crmLeads: 0,
        won: 0,
        lost: 0,
        conversionRate: null,
        lostRate: null,
        revenue: 0,
        invoices: 0,
        salesOrders: 0,
        revenuePerLead: null,
        cpl: null,
        cpa: null,
        roas: null,
        acos: null,
        avgCloseDays: null,
        closeSample: 0,
        closeTotal: 0,
        spendDateMin: "",
        spendDateMax: "",
        partialSpend: false,
        spendCoverage: null,
        orders: 0,
        avgOrder: null,
        prevRevenue: 0,
        revenueDelta: null,
      };
      map.set(key, a);
    }
    if (!a.mainCategory && cat) a.mainCategory = cat;
    return a;
  };

  const invoiceRefs = new Map<string, Set<string>>();
  for (const sale of data.accounting) {
    // Paid lines that name no course are still money, and the course breakdown
    // has to reconcile to the headline total. They used to be named after their
    // product, which invented courses called "[841] 20% on specific products";
    // dropping them instead opened a $453 gap between this table and
    // `computeTotals`. They get one honest shared bucket.
    const a = get(sale.course || UNATTRIBUTED_COURSE, sale.mainCategory);
    a.revenue += sale.usdPaid;
    const ref = sale.movement;
    if (ref) {
      let s = invoiceRefs.get(a.key);
      if (!s) {
        s = new Set();
        invoiceRefs.set(a.key, s);
      }
      s.add(ref);
    }
  }

  const salesOrderRefs = new Map<string, Set<string>>();
  for (const sale of data.invoiced) {
    if (!sale.orderRef) continue;
    // Same bucket the paid lines use, so a discount order is counted once and
    // in one place instead of under a course named after its own product.
    const a = get(sale.course || UNATTRIBUTED_COURSE, sale.mainCategory);
    let refs = salesOrderRefs.get(a.key);
    if (!refs) {
      refs = new Set();
      salesOrderRefs.set(a.key, refs);
    }
    refs.add(sale.orderRef);
  }

  for (const c of data.crm) {
    if (!c.course) continue;
    const a = get(c.course, c.mainCategory);
    a.crmLeads++;
    if (c.isWon) a.won++;
    if (c.daysToClose !== null && c.daysToClose >= 0) {
      a.closeTotal += c.daysToClose;
      a.closeSample++;
    }
  }

  const archivedWinForCourse = archivedWinCounter(data);
  for (const l of archivedCrmLeads(data)) {
    if (!l.course) continue;
    const a = get(l.course, l.mainCategory);
    a.crmLeads++;
    if (archivedWinForCourse(l)) a.won++;
    else if (!isArchivedWon(l)) a.lost++;
  }

  // Ad/ad-set/campaign names are more precise than campaign-level lead inference.
  // Creating the course here keeps spend-only campaigns visible before a CRM or
  // invoice outcome exists.
  for (const ad of data.ads) {
    const attribution = attributedAdCourse(ad, data.snapshot);
    if (!attribution.course) continue;
    const a = get(attribution.course, "");
    a.spend += ad.spend;
    a.impressions += ad.impressions;
    a.clicksAll += ad.clicksAll;
    if (ad.platformLeads !== null) a.platformLeads = (a.platformLeads ?? 0) + ad.platformLeads;
    a.courseInferred = true;
  }

  if (prev) {
    for (const sale of prev.accounting) {
      if (!sale.course) continue;
      const a = map.get(normalizeName(sale.course));
      if (a) a.prevRevenue += sale.usdPaid;
    }
  }

  for (const a of map.values()) {
    a.invoices = invoiceRefs.get(a.key)?.size ?? 0;
    a.salesOrders = salesOrderRefs.get(a.key)?.size ?? 0;
    // Backward-compatible alias used by older course consumers.
    a.orders = a.invoices;
    a.avgOrder = div(a.revenue, a.invoices);
    a.conversionRate = pctOf(a.won, a.crmLeads);
    a.lostRate = pctOf(a.lost, a.crmLeads);
    a.roas = div(a.revenue, a.spend);
    a.acos = (() => {
      const r = div(a.spend, a.revenue);
      return r === null ? null : r * 100;
    })();
    a.cpl = a.platformLeads === null ? null : div(a.spend, a.platformLeads);
    a.cpa = div(a.spend, a.won);
    a.ctrAll = pctOf(a.clicksAll, a.impressions);
    a.cpm = (() => {
      const r = div(a.spend, a.impressions);
      return r === null ? null : r * 1000;
    })();
    a.cpc = div(a.spend, a.clicksAll);
    a.revenuePerLead = div(a.revenue, a.crmLeads);
    a.avgCloseDays = div(a.closeTotal, a.closeSample);
    a.revenueDelta = a.prevRevenue > 0 ? ((a.revenue - a.prevRevenue) / a.prevRevenue) * 100 : null;
  }

  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

/* --- teams & people --------------------------------------------------------- */

export function computeTeams(data: FilteredData): TeamAgg[] {
  interface Acc {
    agg: TeamAgg;
    closeTotal: number;
    orderRefs: Set<string>;
    people: Map<string, { agg: TeamAgg; closeTotal: number; orderRefs: Set<string> }>;
  }
  const teams = new Map<string, Acc>();

  const blank = (name: string, parent?: string): TeamAgg => ({
    key: name,
    name,
    parent,
    crmLeads: 0,
    won: 0,
    lost: 0,
    conversionRate: null,
    lostRate: null,
    revenue: 0,
    orders: 0,
    avgOrder: null,
    revenuePerLead: null,
    avgCloseDays: null,
    closeSample: 0,
  });

  const getTeam = (name: string) => {
    let t = teams.get(name);
    if (!t) {
      t = { agg: blank(name), closeTotal: 0, orderRefs: new Set(), people: new Map() };
      teams.set(name, t);
    }
    return t;
  };

  for (const c of data.crm) {
    const teamName = c.salesTeam || "—";
    const t = getTeam(teamName);
    t.agg.crmLeads++;
    if (c.isWon) t.agg.won++;
    if (c.daysToClose !== null && c.daysToClose >= 0) {
      t.closeTotal += c.daysToClose;
      t.agg.closeSample++;
    }

    const person = c.salesperson || "—";
    let p = t.people.get(person);
    if (!p) {
      p = { agg: blank(person, teamName), closeTotal: 0, orderRefs: new Set() };
      t.people.set(person, p);
    }
    p.agg.crmLeads++;
    if (c.isWon) p.agg.won++;
    if (c.daysToClose !== null && c.daysToClose >= 0) {
      p.closeTotal += c.daysToClose;
      p.agg.closeSample++;
    }
  }

  const archivedWinForTeam = archivedWinCounter(data);
  for (const l of archivedCrmLeads(data)) {
    const teamName = l.salesTeam || "—";
    const t = getTeam(teamName);
    const win = archivedWinForTeam(l);
    const loss = !isArchivedWon(l);
    t.agg.crmLeads++;
    if (win) t.agg.won++;
    else if (loss) t.agg.lost++;
    const person = l.salesperson || "—";
    let p = t.people.get(person);
    if (!p) {
      p = { agg: blank(person, teamName), closeTotal: 0, orderRefs: new Set() };
      t.people.set(person, p);
    }
    p.agg.crmLeads++;
    if (win) p.agg.won++;
    else if (loss) p.agg.lost++;
  }

  // Paid accounting rows carry salesperson/team and are the authoritative
  // revenue source. Missing team names are resolved through the CRM roster.
  const personTeam = new Map<string, string>();
  for (const c of data.crm) {
    if (c.salesperson && c.salesTeam && !personTeam.has(c.salesperson))
      personTeam.set(c.salesperson, c.salesTeam);
  }

  for (const sale of data.accounting) {
    const person = sale.salesperson;
    const teamName = sale.salesTeam || (person ? personTeam.get(person) : "") || "—";
    const t = getTeam(teamName);
    t.agg.revenue += sale.usdPaid;
    const ref = sale.movement;
    if (ref) t.orderRefs.add(ref);
    if (person) {
      let p = t.people.get(person);
      if (!p) {
        p = { agg: blank(person, teamName), closeTotal: 0, orderRefs: new Set() };
        t.people.set(person, p);
      }
      p.agg.revenue += sale.usdPaid;
      if (ref) p.orderRefs.add(ref);
    }
  }

  const finish = (a: TeamAgg, closeTotal: number, orders: number) => {
    a.orders = orders;
    a.conversionRate = pctOf(a.won, a.crmLeads);
    a.lostRate = pctOf(a.lost, a.crmLeads);
    a.avgOrder = div(a.revenue, orders);
    a.revenuePerLead = div(a.revenue, a.crmLeads);
    a.avgCloseDays = div(closeTotal, a.closeSample);
    return a;
  };

  const out: TeamAgg[] = [];
  for (const t of teams.values()) {
    const people = [...t.people.values()]
      .map((p) => finish(p.agg, p.closeTotal, p.orderRefs.size))
      .sort((a, b) => b.revenue - a.revenue || b.crmLeads - a.crmLeads);
    const agg = finish(t.agg, t.closeTotal, t.orderRefs.size);
    agg.people = people;
    out.push(agg);
  }
  return out.sort((a, b) => b.revenue - a.revenue || b.crmLeads - a.crmLeads);
}

/* --- grouping helpers ------------------------------------------------------- */

export function groupBy<T>(
  rows: T[],
  key: (r: T) => string,
  value: (r: T) => number = () => 1,
): Grouped[] {
  const m = new Map<string, Grouped>();
  let total = 0;
  for (const r of rows) {
    const k = key(r) || "—";
    let e = m.get(k);
    if (!e) {
      e = { label: k, value: 0, count: 0, share: 0 };
      m.set(k, e);
    }
    const v = value(r);
    e.value += v;
    e.count += 1;
    total += v;
  }
  const out = [...m.values()].sort((a, b) => b.value - a.value);
  for (const e of out) e.share = total > 0 ? (e.value / total) * 100 : 0;
  return out;
}

function matrix<T>(
  rows: T[],
  rowKey: (r: T) => string,
  colKey: (r: T) => string,
  topRows = 12,
  topCols = 10,
): Matrix {
  const rowTotalsMap = new Map<string, number>();
  const colTotalsMap = new Map<string, number>();
  const cellMap = new Map<string, number>();
  for (const r of rows) {
    const rk = rowKey(r) || "—";
    const ck = colKey(r) || "—";
    rowTotalsMap.set(rk, (rowTotalsMap.get(rk) ?? 0) + 1);
    colTotalsMap.set(ck, (colTotalsMap.get(ck) ?? 0) + 1);
    const k = rk + "\u0000" + ck;
    cellMap.set(k, (cellMap.get(k) ?? 0) + 1);
  }
  const rowNames = [...rowTotalsMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topRows)
    .map(([k]) => k);
  const colNames = [...colTotalsMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topCols)
    .map(([k]) => k);
  const cells = rowNames.map((rk) => colNames.map((ck) => cellMap.get(rk + "\u0000" + ck) ?? 0));
  return {
    rows: rowNames,
    cols: colNames,
    cells,
    rowTotals: rowNames.map((rk) => rowTotalsMap.get(rk) ?? 0),
    colTotals: colNames.map((ck) => colTotalsMap.get(ck) ?? 0),
    total: rows.length,
  };
}

/* --- lost ------------------------------------------------------------------- */

/**
 * Every Lost breakdown and rate uses the same authoritative archived
 * population. Active CRM stage text is intentionally absent from this path.
 */
export function computeLost(data: FilteredData): LostBreakdown {
  const rows = authoritativeLostLeads(data);
  const labels = data.snapshot.sourceLabels;
  const monthOf = (d: string) => (d ? d.slice(0, 7) : "—");
  return {
    byReason: groupBy(rows, (r) => r.lossReason || "—"),
    byCourse: groupBy(rows, (r) => r.course || "—"),
    byMonth: groupBy(rows, (r) => monthOf(archivedLostReportingDate(r, data.snapshot))).sort(
      (a, b) => a.label.localeCompare(b.label),
    ),
    byTeam: groupBy(rows, (r) => r.salesTeam || "—"),
    bySalesperson: groupBy(rows, (r) => r.salesperson || "—"),
    bySource: groupBy(rows, (r) => labels.get(r.sourceKey) ?? r.source ?? "—"),
    byCampaign: groupBy(rows, (r) => r.campaignName || "—"),
    reasonByTeam: matrix(
      rows,
      (r) => r.lossReason || "—",
      (r) => r.salesTeam || "—",
    ),
    reasonByCourse: matrix(
      rows,
      (r) => r.lossReason || "—",
      (r) => r.course || "—",
    ),
    total: rows.length,
    crmLostCount: 0,
  };
}

/* --- lead origin ------------------------------------------------------------ */

export interface OriginCohort {
  key: "campaign" | "other";
  leads: number;
  won: number;
  lost: number;
  conversionRate: Maybe;
  lostRate: Maybe;
  revenue: number;
  avgCloseDays: Maybe;
  closeSample: number;
}

export function computeLeadOrigin(data: FilteredData): {
  cohorts: OriginCohort[];
  otherBySource: Grouped[];
} {
  // Archived lost leads belong to a cohort too, otherwise this card reports a
  // near-zero lost count while the Lost page reports hundreds.
  const archived = archivedCrmLeads(data);
  const archivedWin = archivedWinCounter(data);
  const build = (
    key: "campaign" | "other",
    rows: CrmLeadRow[],
    archivedRows: LostRow[],
    revenue: number,
  ): OriginCohort => {
    const { avg, sample } = closeStats(rows);
    const leads = rows.length + archivedRows.length;
    const won = rows.filter((r) => r.isWon).length + archivedRows.filter(archivedWin).length;
    const lost = archivedRows.filter((row) => !isArchivedWon(row)).length;
    return {
      key,
      leads,
      won,
      lost,
      conversionRate: pctOf(won, leads),
      lostRate: pctOf(lost, leads),
      revenue,
      avgCloseDays: avg,
      closeSample: sample,
    };
  };

  const hasCampaign = (l: LostRow) => !!l.campaignName || !!l.campaignId;
  const fromCampaign = data.crm.filter((c) => c.fromCampaign);
  const other = data.crm.filter((c) => !c.fromCampaign);
  const archivedFromCampaign = archived.filter(hasCampaign);
  const archivedOther = archived.filter((l) => !hasCampaign(l));
  const campaignRevenue = sum(
    data.accounting.filter((row) => !!row.campaignKey),
    (row) => row.usdPaid,
  );
  const otherRevenue = sum(
    data.accounting.filter((row) => !row.campaignKey),
    (row) => row.usdPaid,
  );
  const labels = data.snapshot.sourceLabels;

  return {
    cohorts: [
      build("campaign", fromCampaign, archivedFromCampaign, campaignRevenue),
      build("other", other, archivedOther, otherRevenue),
    ],
    otherBySource: groupBy(
      [
        ...other.map((c) => ({ sourceKey: c.sourceKey, source: c.source })),
        ...archivedOther.map((l) => ({ sourceKey: l.sourceKey, source: l.source })),
      ],
      (r) => labels.get(r.sourceKey) ?? r.source ?? "—",
    ),
  };
}

/* --- periods ---------------------------------------------------------------- */

/**
 * True when the previous window sits inside the range the sheet actually covers.
 *
 * The default year-to-date window is 200 days, so its predecessor starts in
 * mid-2025 — where this sheet holds 109 stray invoice rows and nothing else.
 * Comparing against that produced a "+5,959%" revenue delta on the Overview:
 * arithmetically correct, completely meaningless. When the previous window
 * predates complete data, no delta is shown at all.
 */
export async function isPreviousComparable(
  prev: { from: string; to: string } | null,
): Promise<boolean> {
  if (!prev) return false;
  const all = await loadAllData();
  // Ads and CRM define where the dataset genuinely begins; the invoiced tab has
  // a thin 2025 tail that would otherwise vouch for a period it cannot support.
  const starts = [all.adsDateMin, all.crmDateMin].filter(Boolean);
  if (!starts.length) return false;
  const coverageStart = starts.sort().pop()!;
  return prev.from >= coverageStart;
}

export function previousPeriod(from?: string, to?: string): { from: string; to: string } | null {
  if (!from || !to) return null;
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return null;
  const days = Math.round((b - a) / 86_400_000) + 1;
  const prevTo = new Date(a - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

export function computeDeltas(now: Totals, prev: Totals): Deltas {
  const out: Deltas = {};
  (Object.keys(now) as (keyof Totals)[]).forEach((k) => {
    const a = prev[k];
    const b = now[k];
    if (typeof a !== "number" || typeof b !== "number") return;
    // A growth % against a zero baseline is not a fact, it's a divide by zero.
    if (a === 0) return;
    out[k] = ((b - a) / Math.abs(a)) * 100;
  });
  return out;
}

/* --- year over year ---------------------------------------------------------- */

export async function computeYoy(currentYear?: number): Promise<YoyResult> {
  const all = await loadAllData();
  const latest =
    [all.adsDateMax, all.crmDateMax, all.revenueDateMax].filter(Boolean).sort().pop() ?? "";
  const year = currentYear ?? (latest ? +latest.slice(0, 4) : new Date().getUTCFullYear());
  const prevYear = year - 1;

  const inYear = (d: string, y: number) => !!d && d.slice(0, 4) === String(y);
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

  const spendOf = (y: number, m?: string) =>
    sum(
      all.ads.filter((a) => inYear(a.date, y) && (!m || a.date.slice(5, 7) === m)),
      (a) => a.spend,
    );
  const revenueOf = (y: number, m?: string) =>
    sum(
      all.accounting.filter((row) => {
        const d = accountingReportingDate(row, "payment");
        return inYear(d, y) && (!m || d.slice(5, 7) === m);
      }),
      (row) => row.usdPaid,
    );
  const leadsOf = (y: number, m?: string) =>
    all.crm.filter((c) => inYear(c.createdAt, y) && (!m || c.createdAt.slice(5, 7) === m)).length +
    all.lost.filter((l) => {
      const d = archivedLostReportingDate(l, all);
      return inYear(d, y) && (!m || d.slice(5, 7) === m);
    }).length;
  const wonOf = (y: number, m?: string) =>
    all.crm.filter(
      (c) => c.isWon && inYear(c.createdAt, y) && (!m || c.createdAt.slice(5, 7) === m),
    ).length;

  // Availability is source-specific. A complete historical accounting/ads
  // import must remain reportable even when no historical CRM snapshot exists;
  // absent CRM must never be presented as zero leads or zero Won.
  const MIN_PRIOR_ROWS = 100;
  const priorCounts = {
    ads: all.ads.filter((a) => inYear(a.date, prevYear)).length,
    crm: all.crm.filter((c) => inYear(c.createdAt, prevYear)).length,
    accounting: all.accounting.filter((row) =>
      inYear(accountingReportingDate(row, "payment"), prevYear),
    ).length,
  };
  const metricAvailability = {
    spend: priorCounts.ads >= MIN_PRIOR_ROWS,
    revenue: priorCounts.accounting >= MIN_PRIOR_ROWS,
    leads: priorCounts.crm >= MIN_PRIOR_ROWS,
    won: priorCounts.crm >= MIN_PRIOR_ROWS,
  };
  const available = Object.values(metricAvailability).some(Boolean);

  // Growth is only emitted when the prior year is comparable at all, so no
  // consumer of this payload can render a percentage the data cannot support.
  const growthOf = (current: number, previous: number, metricAvailable: boolean): Maybe =>
    metricAvailable && previous > 0 ? ((current - previous) / previous) * 100 : null;

  const series = (fn: (y: number, m?: string) => number, metricAvailable: boolean) =>
    months.map((m) => {
      const current = fn(year, m);
      const previous = fn(prevYear, m);
      return {
        key: `${year}-${m}`,
        current,
        previous,
        delta: current - previous,
        growth: growthOf(current, previous, metricAvailable),
      };
    });

  const ytdCut = latest ? latest.slice(5) : "12-31";
  const ytd = (fn: (y: number) => number, name: string, metricAvailable: boolean) => {
    const current = fn(year);
    const previous = fn(prevYear);
    return {
      metric: name,
      current,
      previous,
      growth: growthOf(current, previous, metricAvailable),
    };
  };
  const ytdSpend = (y: number) =>
    sum(
      all.ads.filter((a) => inYear(a.date, y) && a.date.slice(5) <= ytdCut),
      (a) => a.spend,
    );
  const ytdRevenue = (y: number) =>
    sum(
      all.accounting.filter((row) => {
        const d = accountingReportingDate(row, "payment");
        return inYear(d, y) && d.slice(5) <= ytdCut;
      }),
      (row) => row.usdPaid,
    );
  const ytdLeads = (y: number) =>
    all.crm.filter((c) => inYear(c.createdAt, y) && c.createdAt.slice(5) <= ytdCut).length +
    all.lost.filter((l) => {
      const d = archivedLostReportingDate(l, all);
      return inYear(d, y) && d.slice(5) <= ytdCut;
    }).length;
  const ytdWon = (y: number) =>
    all.crm.filter((c) => c.isWon && inYear(c.createdAt, y) && c.createdAt.slice(5) <= ytdCut)
      .length;

  const courseKeys = new Set(all.accounting.map((row) => row.course).filter(Boolean));
  const byCourse = [...courseKeys]
    .map((course) => {
      const current = sum(
        all.accounting.filter(
          (row) => row.course === course && inYear(accountingReportingDate(row, "payment"), year),
        ),
        (row) => row.usdPaid,
      );
      const previous = sum(
        all.accounting.filter(
          (row) =>
            row.course === course && inYear(accountingReportingDate(row, "payment"), prevYear),
        ),
        (row) => row.usdPaid,
      );
      return {
        key: course,
        metric: "revenue",
        current,
        previous,
        delta: current - previous,
        growth: growthOf(current, previous, metricAvailability.revenue),
      };
    })
    .sort((a, b) => b.current - a.current);

  return {
    available,
    metricAvailability,
    currentYear: year,
    previousYear: prevYear,
    reason: available ? undefined : "no_prior_year",
    spend: series(spendOf, metricAvailability.spend),
    revenue: series(revenueOf, metricAvailability.revenue),
    leads: series(leadsOf, metricAvailability.leads),
    won: series(wonOf, metricAvailability.won),
    byCourse,
    ytd: [
      ytd(ytdSpend, "spend", metricAvailability.spend),
      ytd(ytdRevenue, "revenue", metricAvailability.revenue),
      ytd(ytdLeads, "leads", metricAvailability.leads),
      ytd(ytdWon, "won", metricAvailability.won),
    ],
  };
}

/* --- exec summary ------------------------------------------------------------ */

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const money2 = (n: Maybe) =>
  n === null
    ? "—"
    : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctStr = (n: Maybe, d = 1) => (n === null ? "—" : n.toFixed(d) + "%");
const roasStr = (n: Maybe) => (n === null ? "—" : n.toFixed(2) + "×");
const delta = (n?: number) => (n === undefined ? "—" : (n >= 0 ? "+" : "") + n.toFixed(0) + "%");

/**
 * Deterministic bilingual manager summary. No LLM — this must be reproducible
 * and identical for the same data.
 */
export function execSummary(
  t: Totals,
  rows: PerfRow[],
  deltas: Deltas,
  range: { from?: string; to?: string },
  health: DataHealth,
): ExecSummary {
  const best = bestCampaign(rows);
  const leak = moneyLeak(rows);
  const cheap = bestCPL(rows);
  const window = range.from && range.to ? `${range.from} → ${range.to}` : "";

  const en: string[] = [];
  const ar: string[] = [];

  en.push(
    `Between ${window} you spent ${money(t.spend)}. The clean lead population is ${t.totalLeads.toLocaleString("en-US")}: ${t.crmLeads.toLocaleString("en-US")} non-lost CRM rows plus ${t.archivedLeads.toLocaleString("en-US")} archived rows from Lost Analysis (${t.lost.toLocaleString("en-US")} Lost${t.archivedWon > 0 ? ` + ${t.archivedWon.toLocaleString("en-US")} Won` : ""}). ${t.won.toLocaleString("en-US")} closed (${pctStr(t.conversionRate)}).`,
  );
  ar.push(
    `خلال الفترة ${window} بلغ الإنفاق ${money(t.spend)}. إجمالي العملاء النظيف ${t.totalLeads.toLocaleString("en-US")}: عدد ${t.crmLeads.toLocaleString("en-US")} من CRM بعد استبعاد Stage=Lost، مضافاً إليهم ${t.archivedLeads.toLocaleString("en-US")} صفاً مؤرشفاً من Lost Analysis (${t.lost.toLocaleString("en-US")} Lost${t.archivedWon > 0 ? ` + ${t.archivedWon.toLocaleString("en-US")} Won` : ""}). أُغلق ${t.won.toLocaleString("en-US")} بنسبة ${pctStr(t.conversionRate)}.`,
  );

  if (t.lostArchived > 0) {
    const wonNoteEn =
      t.archivedWon > 0
        ? ` ${t.archivedWon} archived rows are still marked Won in Odoo: they count as leads and as wins, never as losses.`
        : "";
    const wonNoteAr =
      t.archivedWon > 0
        ? ` وهناك ${t.archivedWon} صفاً مؤرشفاً ما زالت حالته Won في أودو، فيُحتسب ضمن العملاء وضمن الصفقات الرابحة، ولا يُحتسب ضياعاً.`
        : "";
    en.push(
      `All ${t.lostArchived.toLocaleString("en-US")} lost deals come from Lost Analysis; CRM stage Lost is excluded from every metric and stage chart.${wonNoteEn}`,
    );
    ar.push(
      `كل الصفقات الضائعة وعددها ${t.lostArchived.toLocaleString("en-US")} مأخوذة من Lost Analysis فقط، وتم استبعاد Stage=Lost من CRM من كل المؤشرات والرسوم.${wonNoteAr}`,
    );
  }

  en.push(
    `Collected revenue was ${money(t.revenue)} from Accounting.USD Paid by Payment Date, giving a primary ROAS of ${roasStr(t.roas)}. ${money(t.attributedRevenue)} of that paid revenue traces to a campaign in this window. Sales orders are not used as recognised revenue.`,
  );
  ar.push(
    `الإيراد المحصَّل ${money(t.revenue)} من عمود USD Paid في تبويب Accounting حسب تاريخ الدفع، والعائد الأساسي ${roasStr(t.roas)}. ومنه ${money(t.attributedRevenue)} مرتبط بحملة داخل نفس الفترة. أوامر البيع لا تُستخدم كإيراد محاسبي.`,
  );

  if (health.platformsWithoutSpendTab.length > 0) {
    const list = health.platformsWithoutSpendTab
      .map((p) => `${p.platform} (${p.leads.toLocaleString("en-US")})`)
      .join("، ");
    en.push(
      `WARNING — spend is incomplete: ${list} produced leads in the CRM but have no spend tab in the workbook. Their cost is missing from CPL, CPA, ROAS and ACOS, so every one of those reads better than reality until the tab exists.`,
    );
    ar.push(
      `تحذير — الإنفاق ناقص: ${list} أنتجت عملاء في النظام ولا يوجد لها تبويب إنفاق في الملف. تكلفتها غائبة عن CPL و CPA و ROAS و ACOS، فكل هذه المؤشرات تبدو أفضل من الحقيقة إلى أن يُضاف التبويب.`,
    );
  }

  en.push(
    `CPL is ${money2(t.cpl)} = total spend ÷ ${t.platformLeads?.toLocaleString("en-US") ?? "—"} platform-reported leads; CPA is ${money2(t.cpa)} = total spend ÷ won deals; ACOS is ${pctStr(t.acos)}.`,
  );
  ar.push(
    `تكلفة العميل المحتمل ${money2(t.cpl)} = إجمالي الإنفاق ÷ ${t.platformLeads?.toLocaleString("en-US") ?? "—"} lead من منصات الإعلانات، وتكلفة الصفقة ${money2(t.cpa)} = الإنفاق ÷ Won، ونسبة الإنفاق إلى الإيراد ${pctStr(t.acos)}.`,
  );

  if (t.nonLeadSpend > 0) {
    en.push(
      `${money(t.nonLeadSpend)} ran on traffic or unnamed accounts. It remains included because management requested every efficiency formula to use total ad spend.`,
    );
    ar.push(
      `من هذا الإنفاق ${money(t.nonLeadSpend)} على حسابات زيارات أو حسابات بلا اسم، لكنه يظل داخلاً في الحساب لأن معادلات الإدارة تستخدم إجمالي الإنفاق الإعلاني كاملاً.`,
    );
  }

  if (best) {
    en.push(
      `Best campaign: ${best.name} — ${money(best.spend)} returned ${money(best.revenue)} (${roasStr(best.roas)}).`,
    );
    ar.push(
      `أفضل حملة: ${best.name} — أنفقت ${money(best.spend)} وأعادت ${money(best.revenue)} (${roasStr(best.roas)}).`,
    );
  }

  if (leak && (leak.roas === null || leak.roas < 1)) {
    en.push(
      `Biggest leak: ${leak.name} — ${money(leak.spend)} spent for ${money(leak.revenue)} back (${roasStr(leak.roas)}). Worth pausing or reworking the creative.`,
    );
    ar.push(
      `أكبر إهدار: ${leak.name} — أنفقت ${money(leak.spend)} ولم تُعد سوى ${money(leak.revenue)} (${roasStr(leak.roas)}). يُفضّل إيقافها أو تغيير الإعلان.`,
    );
  }

  if (cheap) {
    en.push(
      `Cheapest platform-reported leads came from ${cheap.name} at ${money2(cheap.cpl)} across ${cheap.platformLeads ?? 0} leads.`,
    );
    ar.push(
      `أرخص leads المبلغ عنها من المنصة جاءت من ${cheap.name} بتكلفة ${money2(cheap.cpl)} على ${cheap.platformLeads ?? 0} lead.`,
    );
  }

  if (t.avgCloseDays !== null) {
    en.push(
      `Deals take ${t.avgCloseDays.toFixed(1)} days to close on average, measured over ${t.closeSample.toLocaleString("en-US")} closed leads.`,
    );
    ar.push(
      `متوسط زمن إغلاق الصفقة ${t.avgCloseDays.toFixed(1)} يوماً، محسوباً على ${t.closeSample.toLocaleString("en-US")} صفقة مغلقة.`,
    );
  }

  if (health.leadsWithoutSpendSource > 0) {
    const unpriced = health.unpricedSources
      .slice(0, 6)
      .map((source) => source.label)
      .join(", ");
    en.push(
      `Note: ${health.leadsWithoutSpendSource.toLocaleString("en-US")} leads arrived from sources with no matching spend (${unpriced || "unclassified"}), so blended CPL can read cheaper than paid CPL alone.`,
    );
    ar.push(
      `ملاحظة: وصل ${health.leadsWithoutSpendSource.toLocaleString("en-US")} عميلاً من مصادر بلا إنفاق مطابق (${unpriced || "غير مصنفة"})، لذلك قد تظهر تكلفة العميل الإجمالية أقل من تكلفة العميل المدفوع.`,
    );
  }

  if (typeof deltas.spend === "number") {
    en.push(`Spend is ${delta(deltas.spend)} versus the previous period.`);
    ar.push(`الإنفاق ${delta(deltas.spend)} مقارنة بالفترة السابقة.`);
  }

  return { en: en.join(" "), ar: ar.join(" ") };
}

export function distinctValues<T>(rows: T[], key: (r: T) => string): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = key(r);
    if (v && v.trim()) set.add(v.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export type { DataHealth };
