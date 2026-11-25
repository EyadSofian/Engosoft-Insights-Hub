import { describe, expect, it } from "vitest";
import { buildLeadOwnershipAudit } from "@/lib/lead-ownership-audit";

const row = (id: string, status = "lost", lossReason = "", salesperson = "") => ({
  id,
  status,
  lossReason,
  salesperson,
});
describe("current CRM ownership evidence", () => {
  it("partitions missing-current-owner records instead of treating them as untouched new leads", () => {
    const result = buildLeadOwnershipAudit([
      row("duplicate-ar", "lost", "ليد مكرر"),
      row("duplicate-en", "lost", "Duplicate", "—"),
      row("other-loss", "lost", "غير مهتم"),
      row("active", "lead"),
      row("open", "open"),
      row("won", "won"),
      row("assigned", "lost", "Duplicate", "Sales A"),
      row("duplicate-ar", "lost", "ليد مكرر"),
    ]);
    expect(result).toMatchObject({
      totalRecords: 7,
      currentOwnerMissing: 6,
      currentOwnerMissingLost: 3,
      currentOwnerMissingRecordedDuplicateLost: 2,
      currentOwnerMissingOtherLost: 1,
      currentOwnerMissingOpenOrLead: 2,
      currentOwnerMissingWon: 1,
      neverAssigned: null,
      neverContacted: null,
      lostBecauseUnassigned: null,
    });
    expect(result.interpretation.en).toContain("does not prove never-assigned");
  });
  it("does not infer a confirmed duplicate from blank names or potential identity matches", () => {
    expect(
      buildLeadOwnershipAudit([row("1"), row("2"), row("3", "lead", "Duplicate")]),
    ).toMatchObject({
      currentOwnerMissing: 3,
      currentOwnerMissingRecordedDuplicateLost: 0,
      currentOwnerMissingOtherLost: 2,
    });
  });
});
