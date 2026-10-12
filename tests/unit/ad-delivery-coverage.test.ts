import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
  sync: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/database-pool.server", () => ({
  getSharedDatabasePool: () => ({
    query: async (sql: string) => ({
      rows: sql.includes("FROM dashboard_sync_state") ? fixture.sync : fixture.accounts,
    }),
  }),
}));

import { getAdSpendCoverage } from "@/lib/ad-delivery-coverage.server";

const account = (from: string | null, to: string | null) => ({
  dataset: "meta_ads",
  account_id: "act_123",
  account_name: "Example Meta Account",
  from_date: from,
  to_date: to,
});

describe("advertising spend coverage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    fixture.accounts = [];
    fixture.sync = [];
  });

  afterEach(() => vi.useRealTimers());

  it("accepts adjacent certified intervals, including a zero-spend account", async () => {
    fixture.accounts = [account("2026-09-01", "2026-09-26"), account("2026-09-27", "2026-09-30")];
    const result = await getAdSpendCoverage({
      from: "2026-09-01",
      to: "2026-09-30",
      platform: "meta",
      account: "act_123",
    });
    expect(result).toMatchObject({ complete: true, gaps: [] });
  });

  it("does not treat rows or an old fixed start date as proof of a fetched month", async () => {
    fixture.accounts = [account(null, null)];
    const result = await getAdSpendCoverage({
      from: "2026-08-01",
      to: "2026-08-31",
      platform: "meta",
    });
    expect(result.complete).toBe(false);
    expect(result.gaps).toContainEqual({
      platform: "meta",
      account: "Example Meta Account",
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("uses a fresh successful production sync only for its actual rolling window", async () => {
    fixture.accounts = [account("2026-09-01", "2026-10-11")];
    fixture.sync = [
      {
        dataset: "meta_ads",
        status: "success",
        synced_at: new Date("2026-10-12T11:00:00Z"),
        metadata: {
          since: "2026-10-05",
          until: "2026-10-12",
          workflowId: "imS2VrWslYHhnFNn",
          completed: true,
        },
      },
    ];
    const result = await getAdSpendCoverage({
      from: "2026-10-01",
      to: "2026-10-12",
      platform: "meta",
    });
    expect(result.complete).toBe(true);

    fixture.sync[0]!.metadata = {
      since: "2026-10-05",
      until: "2026-10-12",
      workflowId: "temporary-backfill",
    };
    const untrusted = await getAdSpendCoverage({
      from: "2026-10-01",
      to: "2026-10-12",
      platform: "meta",
    });
    expect(untrusted.gaps).toContainEqual({
      platform: "meta",
      account: "Example Meta Account",
      from: "2026-10-12",
      to: "2026-10-12",
    });
  });

  it("flags a selected Meta account absent from the verified inventory", async () => {
    fixture.accounts = [account("2026-09-01", "2026-09-30")];
    const result = await getAdSpendCoverage({
      from: "2026-09-01",
      to: "2026-09-30",
      platform: "meta",
      account: "missing account",
    });
    expect(result.complete).toBe(false);
  });

  it("flags dates before the TikTok reader's configured start even for one account", async () => {
    const result = await getAdSpendCoverage({
      from: "2025-12-01",
      to: "2025-12-31",
      platform: "tiktok",
      account: "Engo General",
    });
    expect(result.complete).toBe(false);
    expect(result.gaps).toContainEqual({
      platform: "tiktok",
      account: "all",
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });
});
