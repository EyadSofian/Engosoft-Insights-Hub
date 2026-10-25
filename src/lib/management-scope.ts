import type { Platform } from "./types";

/**
 * The platform scope every Marketing Overview figure is computed in.
 *
 * The global filter chooses All channels, one paid platform, or Organic. Two
 * engines serve the Overview and each answers only what it can prove:
 *
 *   metrics.server   spend for every paid platform with a spend source, CRM
 *                    leads/won by creation date, Accounting collections by
 *                    payment date — all narrowed by the same platform filter.
 *   closed-loop      exact acquisition → CRM → revenue links. Provider-ID
 *                    attribution exists only for Meta, so these figures exist
 *                    in the All and Meta scopes and are `not_available` for
 *                    Snapchat, TikTok, Google, ChatGPT and Organic.
 *
 * Nothing here labels Meta-only numbers as all-channel numbers.
 */

export type ManagementScope =
  { kind: "all" } | { kind: "platform"; platform: Platform } | { kind: "organic" };

export function managementScopeFrom(filters: {
  platform?: string;
  channel?: string;
}): ManagementScope {
  if (filters.channel === "organic") return { kind: "organic" };
  const platform = filters.platform;
  if (
    platform === "meta" ||
    platform === "snapchat" ||
    platform === "tiktok" ||
    platform === "google" ||
    platform === "chatgpt"
  )
    return { kind: "platform", platform };
  return { kind: "all" };
}

export function scopeKey(scope: ManagementScope): string {
  return scope.kind === "platform" ? `platform:${scope.platform}` : scope.kind;
}

/** Exact closed-loop attribution (provider lead ID → CRM → sale order) exists for Meta only. */
export function exactAttributionAvailable(scope: ManagementScope): boolean {
  return scope.kind === "all" || (scope.kind === "platform" && scope.platform === "meta");
}

const META_SOURCE_PLATFORMS = new Set([
  "facebook",
  "instagram",
  "messenger",
  "audience_network",
  "meta",
]);

/**
 * Whether an acquisition event belongs to the scope. An event whose platform is
 * unknown belongs to All only: an unknown source is never promoted to Meta.
 * WhatsApp counts as Meta only with Meta referral evidence (click-to-WhatsApp),
 * never because the conversation happened on WhatsApp.
 */
export function acquisitionInScope(
  fact: { sourcePlatform: string; entityType: string; sourceType?: string },
  scope: ManagementScope,
): boolean {
  if (scope.kind === "all") return true;
  const platform = fact.sourcePlatform;
  if (scope.kind === "organic") return platform === "direct" || platform === "organic";
  if (scope.platform === "meta") {
    return (
      fact.entityType === "meta_lead" ||
      META_SOURCE_PLATFORMS.has(platform) ||
      Boolean(fact.sourceType?.startsWith("meta_"))
    );
  }
  return platform === scope.platform;
}

export type PlatformSpendState = "available" | "no_rows" | "source_unavailable" | "not_applicable";

export interface PlatformSpendInput {
  platform: Platform;
  spend: number;
  adRows: number;
  /** False when the connector for this platform failed or is not configured. */
  sourceHealthy: boolean;
  /** CRM leads the platform produced in the window, to decide whether a missing spend source matters. */
  crmLeads: number;
}

export interface ScopeSpend {
  value: number | null;
  status: "ok" | "partial" | "not_applicable" | "pending_sync";
  byPlatform: {
    platform: Platform;
    spend: number | null;
    state: PlatformSpendState;
    crmLeads: number;
  }[];
  includedPlatforms: Platform[];
  /** Platforms in the scope whose spend is unknown although they produced leads or their source failed. */
  unavailablePlatforms: Platform[];
}

/**
 * Spend for the scope, platform by platform. A platform with no ad rows is
 * known-zero only when its source is healthy and it produced no leads; with
 * leads but no rows (TikTok before its spend source existed) the spend is
 * unknown, and the total is marked `partial` rather than presented as complete.
 */
export function scopeSpend(
  scope: ManagementScope,
  platforms: readonly PlatformSpendInput[],
): ScopeSpend {
  if (scope.kind === "organic") {
    return {
      value: null,
      status: "not_applicable",
      byPlatform: [],
      includedPlatforms: [],
      unavailablePlatforms: [],
    };
  }
  const inScope = platforms.filter(
    (row) => scope.kind === "all" || row.platform === scope.platform,
  );
  const byPlatform = inScope.map((row) => {
    const state: PlatformSpendState =
      row.adRows > 0
        ? "available"
        : !row.sourceHealthy || row.crmLeads > 0
          ? "source_unavailable"
          : "no_rows";
    return {
      platform: row.platform,
      spend: state === "source_unavailable" ? null : row.spend,
      state,
      crmLeads: row.crmLeads,
    };
  });
  const includedPlatforms = byPlatform
    .filter((row) => row.state === "available")
    .map((row) => row.platform);
  const unavailablePlatforms = byPlatform
    .filter((row) => row.state === "source_unavailable")
    .map((row) => row.platform);
  const total = byPlatform.reduce((sum, row) => sum + (row.spend ?? 0), 0);
  if (scope.kind === "platform" && unavailablePlatforms.length) {
    return {
      value: null,
      status: "pending_sync",
      byPlatform,
      includedPlatforms,
      unavailablePlatforms,
    };
  }
  return {
    value: Math.round(total * 100) / 100,
    status: unavailablePlatforms.length ? "partial" : "ok",
    byPlatform,
    includedPlatforms,
    unavailablePlatforms,
  };
}

export type RevenueAttribution = "exact" | "inferred" | "none";

export interface RevenueReconciliation {
  /** What population and date basis every part below shares. */
  basis: "payment_date" | "lead_cohort";
  totalAccountingRevenue: number;
  exactAttributedRevenue: number;
  inferredAttributedRevenue: number;
  unattributedRevenue: number;
  /** (exact + inferred) ÷ total, 0–100. */
  attributionCoverage: number | null;
  exactCoverage: number | null;
  lines: number;
}

/**
 * Splits one Accounting population by attribution. Attribution decides who is
 * credited, never how much money exists: the parts always add back to the
 * Accounting total for the same basis.
 */
export function reconcileRevenue(
  basis: RevenueReconciliation["basis"],
  lines: readonly { usd: number; attribution: RevenueAttribution }[],
): RevenueReconciliation {
  let total = 0;
  let exact = 0;
  let inferred = 0;
  for (const line of lines) {
    total += line.usd;
    if (line.attribution === "exact") exact += line.usd;
    else if (line.attribution === "inferred") inferred += line.usd;
  }
  const r2 = (value: number) => Math.round(value * 100) / 100;
  const totalRounded = r2(total);
  const exactRounded = r2(exact);
  const inferredRounded = r2(inferred);
  return {
    basis,
    totalAccountingRevenue: totalRounded,
    exactAttributedRevenue: exactRounded,
    inferredAttributedRevenue: inferredRounded,
    // Derived from the rounded parts so the four figures add up exactly on screen.
    unattributedRevenue: r2(totalRounded - exactRounded - inferredRounded),
    attributionCoverage: total ? ((exact + inferred) / total) * 100 : null,
    exactCoverage: total ? (exact / total) * 100 : null,
    lines: lines.length,
  };
}

export type HealthSeverity = "info" | "warning" | "critical";

export interface ManagementHealthIndicator {
  key:
    | "spend_sync_incomplete"
    | "platform_spend_missing"
    | "crm_sync_incomplete"
    | "attribution_coverage_incomplete"
    | "exact_attribution_not_available"
    | "revenue_fx_basis";
  severity: HealthSeverity;
  message: { en: string; ar: string };
  detail?: Record<string, unknown>;
}

/** Health lines for the Overview. Each one names what is missing instead of hiding it. */
export function managementHealth(input: {
  scope: ManagementScope;
  window: { from: string; to: string };
  spend: ScopeSpend;
  metaAdsSyncedThrough: string;
  closedLoopRefreshedAt: string | null;
  closedLoopStatus: string;
  crmSyncedAt: string | null;
  exactShareOfEvents: number | null;
  events: number;
}): ManagementHealthIndicator[] {
  const out: ManagementHealthIndicator[] = [];
  const metaInScope =
    input.scope.kind === "all" ||
    (input.scope.kind === "platform" && input.scope.platform === "meta");
  if (
    metaInScope &&
    (!input.metaAdsSyncedThrough || input.metaAdsSyncedThrough < input.window.to)
  ) {
    out.push({
      key: "spend_sync_incomplete",
      severity: "warning",
      message: {
        en: `Meta spend is synced through ${input.metaAdsSyncedThrough || "an unknown date"}; the window ends ${input.window.to}.`,
        ar: `صرف Meta متزامن حتى ${input.metaAdsSyncedThrough || "تاريخ غير معروف"}، والفترة تنتهي ${input.window.to}.`,
      },
      detail: { syncedThrough: input.metaAdsSyncedThrough, windowTo: input.window.to },
    });
  }
  if (input.spend.unavailablePlatforms.length) {
    out.push({
      key: "platform_spend_missing",
      severity: "critical",
      message: {
        en: `Spend is unavailable for ${input.spend.unavailablePlatforms.join(", ")}; the spend total excludes it and ratios on it are not complete.`,
        ar: `الصرف غير متاح لـ ${input.spend.unavailablePlatforms.join("، ")}؛ إجمالي الصرف لا يشمله والنسب عليه غير مكتملة.`,
      },
      detail: { platforms: input.spend.unavailablePlatforms },
    });
  }
  if (!input.closedLoopRefreshedAt || input.closedLoopStatus !== "ok") {
    out.push({
      key: "crm_sync_incomplete",
      severity: "warning",
      message: {
        en: `The CRM/sales link graph last finished with status "${input.closedLoopStatus || "never"}".`,
        ar: `آخر تحديث لربط CRM والمبيعات انتهى بالحالة "${input.closedLoopStatus || "لم يتم"}".`,
      },
      detail: { status: input.closedLoopStatus, finishedAt: input.closedLoopRefreshedAt },
    });
  } else if (input.crmSyncedAt && input.crmSyncedAt > input.closedLoopRefreshedAt) {
    out.push({
      key: "crm_sync_incomplete",
      severity: "info",
      message: {
        en: "CRM synced after the last link-graph refresh; the newest CRM changes appear after the next refresh.",
        ar: "تمت مزامنة CRM بعد آخر تحديث للربط؛ أحدث تغييرات CRM تظهر بعد التحديث القادم.",
      },
      detail: {
        crmSyncedAt: input.crmSyncedAt,
        closedLoopRefreshedAt: input.closedLoopRefreshedAt,
      },
    });
  }
  if (!exactAttributionAvailable(input.scope)) {
    out.push({
      key: "exact_attribution_not_available",
      severity: "info",
      message: {
        en: "Exact ad-to-revenue attribution exists only for Meta; the attributed figures below are not available for this selection.",
        ar: "الإسناد الدقيق من الإعلان للإيراد متاح لـ Meta فقط؛ الأرقام المُسندة غير متاحة لهذا الاختيار.",
      },
    });
  } else if (
    input.events > 0 &&
    input.exactShareOfEvents !== null &&
    input.exactShareOfEvents < 50
  ) {
    out.push({
      key: "attribution_coverage_incomplete",
      severity: "warning",
      message: {
        en: `Only ${input.exactShareOfEvents.toFixed(1)}% of acquisition events carry exact attribution; attributed figures cover that share only.`,
        ar: `${input.exactShareOfEvents.toFixed(1)}% فقط من أحداث الاستحواذ لها إسناد دقيق؛ الأرقام المُسندة تغطي هذه النسبة فقط.`,
      },
      detail: { exactShareOfEvents: input.exactShareOfEvents, events: input.events },
    });
  }
  return out;
}
