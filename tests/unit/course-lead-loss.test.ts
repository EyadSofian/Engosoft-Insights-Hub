import { describe, expect, it } from "vitest";
import { buildCourseLeadLossReport, buildCourseLostMovementReport } from "@/lib/course-lead-loss";

const active = (course: string, recordType: "lead" | "opportunity" = "opportunity") => ({
  course,
  recordType,
});

describe("course Lost movement", () => {
  it("groups the close-date population by course and preserves the type split", () => {
    const report = buildCourseLostMovementReport({
      lost: [
        { course: "Auto", recordType: "lead" },
        { course: "Auto", recordType: "opportunity" },
        { course: "PMP", recordType: "opportunity" },
      ],
      range: { from: "2026-09-01", to: "2026-09-20" },
    });
    expect(report.totals).toEqual({ lost: 3, lostLeads: 1, lostOpportunities: 2 });
    expect(report.rows[0]).toMatchObject({
      key: "auto",
      label: "Automotive",
      lost: 2,
      lostLeads: 1,
      lostOpportunities: 1,
    });
  });
});

describe("course lead/loss creation cohort", () => {
  const report = buildCourseLeadLossReport({
    active: [active("Auto"), active("Auto"), active(""), active("BIM")],
    lost: [active("Auto", "lead"), active("Auto"), active("BIM")],
    previousActive: [active("Auto"), active("BIM"), active("BIM")],
    previousLost: [active("Auto")],
    currentRange: { from: "2026-09-01", to: "2026-09-17" },
    previousRange: { from: "2026-08-01", to: "2026-08-17" },
  });

  it("counts Lost inside Leads rather than as a second population", () => {
    const auto = report.rows.find((row) => row.course === "Auto")!;
    expect(auto).toMatchObject({
      label: "Automotive",
      leads: 4,
      lost: 2,
      lostLeads: 1,
      lostOpportunities: 1,
      lostRate: 50,
      previousLeads: 2,
      leadDelta: 2,
      leadDeltaRate: 100,
    });
  });

  it("keeps uncategorised records visible so the table reconciles", () => {
    expect(report.rows.find((row) => row.course === "Unclassified")?.leads).toBe(1);
    expect(report.totals.leads).toBe(7);
    expect(report.totals.lost).toBe(3);
  });

  it("carries a course that existed only in the previous period", () => {
    const reportWithOldOnly = buildCourseLeadLossReport({
      active: [],
      lost: [],
      previousActive: [active("CFM")],
      currentRange: { from: "2026-09-01", to: "2026-09-17" },
      previousRange: { from: "2026-08-01", to: "2026-08-17" },
    });
    expect(reportWithOldOnly.rows[0]).toMatchObject({
      label: "Facility Management",
      leads: 0,
      previousLeads: 1,
      leadDelta: -1,
    });
  });
});
