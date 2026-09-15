import { describe, expect, it } from "vitest";
import { emptyMetrics, finalizeMetrics, type QualityMetrics } from "@/lib/closed-loop";
import { closedLoopKpis, type KpiInputs } from "@/lib/closed-loop-kpis";
import {
  acquisitionInScope,
  managementHealth,
  managementScopeFrom,
  reconcileRevenue,
  scopeSpend,
  type ManagementScope,
  type PlatformSpendInput,
} from "@/lib/management-scope";

const metrics = (overrides: Partial<QualityMetrics>): QualityMetrics =>
  finalizeMetrics({ ...emptyMetrics(), ...overrides });

/** Synthetic platform feed: every platform reports rows except ChatGPT, which is idle. */
const platforms = (overrides: Partial<Record<string, Partial<PlatformSpendInput>>> = {}): PlatformSpendInput[] =>
  (
    [
      { platform: "meta", spend: 1_000, adRows: 100, sourceHealthy: true, crmLeads: 300 },
      { platform: "snapchat", spend: 50, adRows: 10, sourceHealthy: true, crmLeads: 4 },
      { platform: "tiktok", spend: 400, adRows: 80, sourceHealthy: true, crmLeads: 90 },
      { platform: "google", spend: 30, adRows: 5, sourceHealthy: true, crmLeads: 1 },
      { platform: "chatgpt", spend: 0, adRows: 0, sourceHealthy: true, crmLeads: 0 },
    ] as PlatformSpendInput[]
  ).map((row) => ({ ...row, ...overrides[row.platform] }));

const kpisFor = (scope: ManagementScope, feed = platforms()): ReturnType<typeof closedLoopKpis> => {
  const spend = scopeSpend(scope, feed);
  const input: KpiInputs = {
    all: metrics({ leads: 500, crmMatched: 120, won: 6, revenue: 900 }),
    tracked: metrics({ leads: 120, crmMatched: 120, qualified: 10, won: 6, revenue: 900 }),
    totalSpend: 1_000,
    trackedSpend: 800,
    spendSynced: true,
    crmSynced: true,
    scope,
    metaEvents: 130,
    exactUniqueLeads: 118,
    exactUniqueWon: 6,
    exactCrmMatchesInScope: 120,
    scopeTotals: {
      spend,
      uniqueCrmLeads: 380,
      uniqueWonCustomers: 20,
      collectedRevenue: 4_000,
      scopeLabel: { en: scope.kind === "all" ? "All channels" : "Selected", ar: "" },
    },
  };
  return closedLoopKpis(input);
};

describe("all-channel vs Meta-only spend scope", () => {
  it("reads the global filter into one scope", () => {
    expect(managementScopeFrom({})).toEqual({ kind: "all" });
    expect(managementScopeFrom({ platform: "meta" })).toEqual({ kind: "platform", platform: "meta" });
    expect(managementScopeFrom({ platform: "tiktok" })).toEqual({ kind: "platform", platform: "tiktok" });
    expect(managementScopeFrom({ channel: "organic", platform: "meta" })).toEqual({ kind: "organic" });
    expect(managementScopeFrom({ platform: "unknown-network" })).toEqual({ kind: "all" });
  });

  it("sums every platform with a spend source for All channels, never Meta alone", () => {
    const all = scopeSpend({ kind: "all" }, platforms());
    const meta = scopeSpend({ kind: "platform", platform: "meta" }, platforms());
    expect(all.value).toBe(1_480);
    expect(all.status).toBe("ok");
    expect(meta.value).toBe(1_000);
    expect(all.value).not.toBe(meta.value);
    expect(all.includedPlatforms).toEqual(["meta", "snapchat", "tiktok", "google"]);
  });

  it("marks a platform with leads but no spend rows as unavailable, not as $0", () => {
    const feed = platforms({ tiktok: { adRows: 0, spend: 0 } });
    const all = scopeSpend({ kind: "all" }, feed);
    expect(all.status).toBe("partial");
    expect(all.unavailablePlatforms).toEqual(["tiktok"]);
    expect(all.byPlatform.find((row) => row.platform === "tiktok")?.spend).toBeNull();
    const tiktokOnly = scopeSpend({ kind: "platform", platform: "tiktok" }, feed);
    expect(tiktokOnly.value).toBeNull();
    expect(tiktokOnly.status).toBe("pending_sync");
  });

  it("treats an idle, healthy platform as a real zero and a failed connector as unavailable", () => {
    expect(scopeSpend({ kind: "all" }, platforms()).byPlatform.find((row) => row.platform === "chatgpt")?.state).toBe(
      "no_rows",
    );
    const failed = scopeSpend({ kind: "all" }, platforms({ chatgpt: { sourceHealthy: false } }));
    expect(failed.unavailablePlatforms).toContain("chatgpt");
  });

  it("gives organic no paid spend", () => {
    const organic = scopeSpend({ kind: "organic" }, platforms());
    expect(organic.value).toBeNull();
    expect(organic.status).toBe("not_applicable");
  });

  it("labels the Overview spend card with its scope and keeps Meta spend as its own figure", () => {
    const kpis = kpisFor({ kind: "all" });
    expect(kpis.adSpend!.value).toBe(1_480);
    expect(kpis.adSpend!.label.en).toContain("All channels");
    expect(kpis.adSpend!.contract?.platformScope).toBe("selected_scope");
    expect(kpis.metaSpend!.value).toBe(1_000);
    expect(kpis.metaSpend!.contract?.platformScope).toBe("meta_only_exact");
    // Exact ratios divide by Meta spend, never by all-channel spend.
    expect(kpis.roasAllSpend!.denominator!.value).toBe(1_000);
  });

  it("changes the management figures when Snapchat is selected and hides every Meta-only figure", () => {
    const kpis = kpisFor({ kind: "platform", platform: "snapchat" });
    expect(kpis.adSpend!.value).toBe(50);
    for (const key of ["metaSpend", "trackedSpend", "revenue", "won", "qualified", "roasAllSpend", "roasTracked", "crmMatchRate"]) {
      expect(kpis[key]!.status, key).toBe("not_available");
      expect(kpis[key]!.value, key).toBeNull();
    }
  });

  it("refuses a CPL or blended ROAS on a partial spend total", () => {
    const kpis = kpisFor({ kind: "all" }, platforms({ tiktok: { adRows: 0, spend: 0 } }));
    expect(kpis.adSpend!.coverageNote?.en).toContain("tiktok");
    expect(kpis.costPerCrmLead!.status).toBe("incomplete_source");
    expect(kpis.costPerCrmLead!.value).toBeNull();
    expect(kpis.blendedRoas!.status).toBe("incomplete_source");
  });

  it("never promotes an unknown-source conversation to Meta", () => {
    const meta: ManagementScope = { kind: "platform", platform: "meta" };
    expect(acquisitionInScope({ sourcePlatform: "unknown", entityType: "chatwoot_conversation" }, meta)).toBe(false);
    expect(acquisitionInScope({ sourcePlatform: "whatsapp", entityType: "chatwoot_conversation" }, meta)).toBe(false);
    expect(
      acquisitionInScope(
        { sourcePlatform: "whatsapp", entityType: "chatwoot_conversation", sourceType: "meta_whatsapp_referral" },
        meta,
      ),
    ).toBe(true);
    expect(acquisitionInScope({ sourcePlatform: "facebook", entityType: "meta_lead" }, meta)).toBe(true);
    expect(acquisitionInScope({ sourcePlatform: "unknown", entityType: "chatwoot_conversation" }, { kind: "all" })).toBe(true);
    expect(
      acquisitionInScope({ sourcePlatform: "tiktok", entityType: "landing_submission" }, { kind: "platform", platform: "tiktok" }),
    ).toBe(true);
  });
});

describe("acquisition events are not unique leads", () => {
  it("names the event count as events and reports unique CRM leads separately", () => {
    const kpis = kpisFor({ kind: "all" });
    expect(kpis.leads!.label.en).toBe("Acquisition events");
    expect(kpis.leads!.label.en.toLowerCase()).not.toContain("customer");
    expect(kpis.leads!.definition.en).toContain("not a count of customers");
    expect(kpis.leads!.value).toBe(500);
    expect(kpis.uniqueCrmLeads!.value).toBe(380);
    expect(kpis.uniqueCrmLeads!.contract?.grain).toContain("unique CRM record");
    expect(kpis.exactAttributedLeads!.value).toBe(118);
    expect(kpis.exactUniqueWon!.value).toBe(6);
    expect(kpis.uniqueWonCustomers!.value).toBe(20);
  });

  it("measures the CRM match rate as events over events in the same scope", () => {
    const kpi = kpisFor({ kind: "all" }).crmMatchRate!;
    expect(kpi.numerator!.value).toBe(120);
    expect(kpi.denominator!.value).toBe(500);
    expect(kpi.numerator!.label.en).toContain("Events");
    expect(kpi.denominator!.label.en).toContain("events");
  });
});

describe("revenue reconciles to Accounting", () => {
  it("adds attributed and unattributed back to the Accounting total", () => {
    const result = reconcileRevenue("payment_date", [
      { usd: 100.105, attribution: "exact" },
      { usd: 50.2, attribution: "inferred" },
      { usd: 849.7, attribution: "none" },
      { usd: -30, attribution: "exact" },
    ]);
    expect(result.totalAccountingRevenue).toBe(970.01);
    expect(
      Math.round((result.exactAttributedRevenue + result.inferredAttributedRevenue + result.unattributedRevenue) * 100) /
        100,
    ).toBe(result.totalAccountingRevenue);
    expect(result.exactCoverage).toBeCloseTo((70.105 / 970.005) * 100, 3);
  });

  it("keeps payment-date collections and cohort revenue on different, labelled bases", () => {
    const kpis = kpisFor({ kind: "all" });
    expect(kpis.collectedRevenue!.contract?.dateBasis).toBe("payment_date");
    expect(kpis.revenue!.contract?.dateBasis).toBe("lead_created_cohort_all_payment_dates");
    expect(kpis.revenue!.label.en).toContain("Cohort");
    expect(kpis.roasAllSpend!.label.en).toContain("Cohort");
    expect(kpis.blendedRoas!.label.en).toContain("not attributed");
  });
});

describe("health indicators name what is missing", () => {
  it("flags incomplete spend sync, missing platform spend and a stale link graph", () => {
    const indicators = managementHealth({
      scope: { kind: "all" },
      window: { from: "2026-09-01", to: "2026-09-15" },
      spend: scopeSpend({ kind: "all" }, platforms({ tiktok: { adRows: 0, spend: 0 } })),
      metaAdsSyncedThrough: "2026-09-14",
      closedLoopRefreshedAt: null,
      closedLoopStatus: "failed",
      crmSyncedAt: null,
      exactShareOfEvents: 20,
      events: 500,
    }).map((row) => row.key);
    expect(indicators).toEqual(
      expect.arrayContaining([
        "spend_sync_incomplete",
        "platform_spend_missing",
        "crm_sync_incomplete",
        "attribution_coverage_incomplete",
      ]),
    );
  });

  it("says exact attribution is unavailable off Meta instead of warning about coverage", () => {
    const keys = managementHealth({
      scope: { kind: "platform", platform: "google" },
      window: { from: "2026-09-01", to: "2026-09-15" },
      spend: scopeSpend({ kind: "platform", platform: "google" }, platforms()),
      metaAdsSyncedThrough: "2026-09-15",
      closedLoopRefreshedAt: "2026-09-15T10:00:00Z",
      closedLoopStatus: "ok",
      crmSyncedAt: "2026-09-15T09:00:00Z",
      exactShareOfEvents: 0,
      events: 10,
    }).map((row) => row.key);
    expect(keys).toContain("exact_attribution_not_available");
    expect(keys).not.toContain("attribution_coverage_incomplete");
    expect(keys).not.toContain("spend_sync_incomplete");
  });
});
