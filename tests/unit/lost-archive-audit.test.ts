import { describe, expect, it } from "vitest";
import {
  buildLostArchiveAudit,
  reasonCategory,
  summarizeArchive,
} from "../../src/lib/lost-archive-audit";

const row = (
  month: string,
  verdict: string,
  reason: string,
  extra: Record<string, string> = {},
) => ({
  __sheet_month: month,
  Validate: verdict,
  "Lost Reason": reason,
  "Course Categories": "Facility Management",
  Salesperson: "Mona",
  "Closed Date": "2026-10-03",
  "Created on": "2025-01-01",
  "Campaign Name": "CFM Campaign",
  ...extra,
});

describe("Lost Archive audit", () => {
  it("normalizes bilingual reasons without treating No as a new lead", () => {
    expect(reasonCategory("Not Interested")).toBe("غير مهتم");
    expect(reasonCategory("غير مهتم")).toBe("غير مهتم");
    expect(reasonCategory("No Answer")).toBe("لا يرد / تعذّر الوصول");
    expect(reasonCategory("ليد مكرر")).toBe("مكرر");
    const report = summarizeArchive([
      row("Oct", "Yes", "Not Interested"),
      row("Oct", "No", "No Answer"),
    ]);
    expect(report).toMatchObject({ total: 2, approved: 1, review: 1, reviewPct: 50 });
  });

  it("keeps the three primary month tabs separate and ignores validation-tab rows", () => {
    const rows = [
      row("Aug", "No", "ليد مكرر"),
      row("Sep", "Yes", "Not Interested"),
      row("Oct", "No", "No Answer", { "Closed Date": "", "Created on": "", "Campaign Name": "" }),
      row("Oct Validation", "No", "No Answer"),
    ];
    const result = buildLostArchiveAudit(rows, {
      month: "2026-10",
      status: "success",
      syncedAt: "2026-10-25T10:00:00Z",
    });
    expect(result.rowCount).toBe(3);
    expect(result.selected).toMatchObject({
      total: 1,
      review: 1,
      missingClosedDate: 1,
      missingCreatedDate: 1,
      missingCampaign: 1,
    });
    expect(result.months.map((month) => month.total)).toEqual([1, 1, 1]);
  });

  it("applies course and salesperson filters only within the selected month", () => {
    const rows = [
      row("Oct", "No", "No Answer"),
      row("Oct", "Yes", "Not Interested", { Salesperson: "Ali" }),
      row("Sep", "Yes", "Not Interested", { Salesperson: "Ali" }),
    ];
    const result = buildLostArchiveAudit(rows, {
      month: "2026-10",
      salesperson: "Ali",
      status: "success",
      syncedAt: "",
    });
    expect(result.selected).toMatchObject({ total: 1, review: 0, approved: 1 });
    expect(result.all.total).toBe(3);
  });

  it("explains Other with aggregated raw reasons without exposing personal contact values", () => {
    const result = summarizeArchive([
      row("Oct", "Yes", "Needs a different schedule"),
      row("Oct", "No", "Needs a different schedule"),
      row("Oct", "Yes", "Customer phone 01012345678"),
      row("Oct", "Yes", ""),
    ]);
    expect(result.reasons.find((reason) => reason.name === "أسباب أخرى")?.total).toBe(3);
    expect(result.otherReasons).toContainEqual({ name: "Needs a different schedule", count: 2 });
    expect(result.otherReasons).toContainEqual({ name: "سبب فردي غير قابل للعرض", count: 1 });
    expect(result.otherReasons.some((reason) => reason.name.includes("01012345678"))).toBe(false);
  });
});
