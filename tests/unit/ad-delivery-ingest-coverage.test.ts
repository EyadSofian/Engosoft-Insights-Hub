import { describe, expect, it } from "vitest";
import { completedAdCoverageClaim } from "@/lib/dashboard-db.server";

const meta = {
  workflowId: "imS2VrWslYHhnFNn",
  completed: true,
  since: "2026-10-05",
  until: "2026-10-12",
  accountCount: 2,
  accounts: [
    { id: "act_123", name: "Leads", currency: "USD" },
    { id: "act_456", name: "Website", currency: "USD" },
  ],
};

describe("completed advertising sync evidence", () => {
  it("accepts a completed production account inventory", () => {
    expect(completedAdCoverageClaim("meta_ads", meta)).toEqual({
      from: "2026-10-05",
      to: "2026-10-12",
      accounts: [
        { id: "act_123", name: "Leads" },
        { id: "act_456", name: "Website" },
      ],
    });
  });

  it("rejects temporary backfills and unfinished or partial account lists", () => {
    expect(completedAdCoverageClaim("meta_ads", { ...meta, workflowId: "temporary" })).toBeNull();
    expect(completedAdCoverageClaim("meta_ads", { ...meta, completed: false })).toBeNull();
    expect(completedAdCoverageClaim("meta_ads", { ...meta, accountCount: 3 })).toBeNull();
    expect(completedAdCoverageClaim("accounting", { ...meta, workflowId: undefined })).toBeNull();
    expect(
      completedAdCoverageClaim("meta_ads", {
        ...meta,
        accounts: [meta.accounts[0], meta.accounts[0]],
      }),
    ).toBeNull();
    expect(
      completedAdCoverageClaim("meta_ads", {
        ...meta,
        accounts: [{ ...meta.accounts[0], currency: "SAR" }],
      }),
    ).toBeNull();
  });

  it("checks the Snapchat account identifier separately", () => {
    expect(
      completedAdCoverageClaim("snap_ads", {
        ...meta,
        workflowId: "x9iHWEw7cE3ELqOp",
      }),
    ).toBeNull();
    expect(
      completedAdCoverageClaim("snap_ads", {
        workflowId: "x9iHWEw7cE3ELqOp",
        completed: true,
        since: "2026-10-11",
        until: "2026-10-12",
        accountCount: 1,
        accounts: [
          { id: "ca38be49-409a-4919-8ec1-da6237614309", name: "General", currency: "USD" },
        ],
      }),
    ).not.toBeNull();
  });
});
