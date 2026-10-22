import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), dimensions: vi.fn() }));
vi.mock("@/lib/lead-course-distribution.server", () => ({ loadCrmDateRows: mocks.rows }));
vi.mock("@/lib/crm-lost-movement.server", () => ({
  matchesLostMovementDimensions: mocks.dimensions,
}));
vi.mock("@/lib/odoo.server", () => ({
  odooConfig: () => ({
    url: "https://example.invalid",
    db: "test",
    login: "test",
    companyIds: [2, 3, 4],
  }),
}));

import { loadDirectLeadCohort } from "@/lib/crm-fresh-lost.server";
import type { Snapshot } from "@/lib/sheet-cache.server";

describe("live Lost-rate denominator", () => {
  it("counts one Odoo creation cohort and excludes source and segment referrals/broadcasts", async () => {
    mocks.dimensions.mockReturnValue(true);
    const row = (id: number, source: string, status: string, segment = "") => ({
      __odoo_id: String(id),
      __odoo_create_date_utc: "2026-09-02 10:00:00",
      "Record Type": "opportunity",
      "Business Status": status,
      Source: source,
      "Lead Segment": segment,
    });
    mocks.rows.mockResolvedValue([
      row(1, "Facebook", "open"),
      row(2, "Facebook", "lost"),
      row(3, "WhatsApp Broadcast", "lost"),
      row(4, "Facebook", "open", "WhatsApp Recommendation"),
      row(5, "Recommendation Sales", "lost"),
      row(6, "WhatsApp", "won"),
      { ...row(7, "Facebook", "lost"), __odoo_create_date_utc: "2026-08-31 20:59:59" },
      row(8, "Facebook", "archived"),
    ]);
    const result = await loadDirectLeadCohort(
      { from: "2026-09-01", to: "2026-09-22" },
      {} as Snapshot,
    );
    expect(result).toMatchObject({ total: 3, nonLost: 2, lost: 1 });
  });
});
