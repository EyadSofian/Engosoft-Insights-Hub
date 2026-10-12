import { describe, expect, it } from "vitest";
import { aggregateAdAccounts } from "@/lib/ad-account-aggregation";
import type { AdRow } from "@/lib/types";

const ad = (values: Partial<AdRow>): AdRow =>
  ({
    platform: "meta",
    date: "2026-09-01",
    account: "Engosoft 2021",
    accountId: "act_1",
    objective: "leads",
    campaign: "Campaign",
    campaignId: "campaign_1",
    campaignKey: "campaign_1",
    adset: "Ad set",
    adsetId: "adset_1",
    ad: "Ad",
    adId: "ad_1",
    spend: 0,
    impressions: 0,
    clicksAll: 0,
    linkClicks: null,
    platformLeads: null,
    viewCompletions: null,
    syncedAt: "2026-10-01T00:00:00Z",
    ...values,
  }) as AdRow;

describe("ad account aggregation", () => {
  it("totals only the supplied filtered rows and separates identical names on different platforms", () => {
    const accounts = aggregateAdAccounts([
      ad({ spend: 20, platformLeads: 2 }),
      ad({ date: "2026-09-02", spend: 30, platformLeads: null }),
      ad({ platform: "snapchat", accountId: "snap_1", spend: 5, platformLeads: 1 }),
    ]);

    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ platform: "meta", spend: 50, platformLeads: 2 });
    expect(accounts[1]).toMatchObject({ platform: "snapchat", spend: 5, platformLeads: 1 });
    expect(accounts.reduce((total, account) => total + account.spend, 0)).toBe(55);
  });
});
