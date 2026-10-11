import { describe, expect, it } from "vitest";
import {
  buildLeadSourceMatrix,
  matrixSource,
  UNSPECIFIED_SOURCE,
} from "../../src/lib/lead-source-matrix";

describe("lead source by course matrix", () => {
  it("reconciles both axes and excludes only Snapchat", () => {
    const matrix = buildLeadSourceMatrix([
      { source: "snapchat", course: "CFM" },
      { source: "Snapchat", course: "PMP" },
      { source: "Recommendation", course: "CFM" },
      { source: "Recommendation", course: "PMP" },
      { source: "Website", course: "CFM" },
      { source: "", course: "" },
    ]);
    expect(matrix.total).toBe(6);
    expect(matrix.withoutSnapchat).toBe(4);
    expect(matrix.unspecifiedSource).toBe(1);
    expect(matrix.rows.reduce((sum, row) => sum + row.count, 0)).toBe(matrix.total);
    expect(Object.values(matrix.courseTotals).reduce((sum, count) => sum + count, 0)).toBe(
      matrix.total,
    );
    for (const row of matrix.rows) {
      expect(Object.values(row.cells).reduce((sum, count) => sum + count, 0)).toBe(row.count);
    }
    expect(matrix.rows.find((row) => row.source === "Recommendation")?.count).toBe(2);
    expect(matrix.rows.find((row) => row.source === UNSPECIFIED_SOURCE)?.count).toBe(1);
  });

  it("keeps WhatsApp and broadcasts separate and does not guess unrelated sources", () => {
    expect(matrixSource("WhatsApp")).toBe("WhatsApp");
    expect(matrixSource("WhatsApp Broadcast")).toBe("WhatsApp Broadcast");
    expect(matrixSource("referral")).toBe("referral");
    expect(matrixSource("Recommended From Customer")).toBe("Recommendation");
    expect(matrixSource("Recommendation Sales")).toBe("Recommendation");
  });
});
