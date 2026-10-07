import { describe, expect, it } from "vitest";
import {
  classifyLeadCourse,
  leadLifecycleBucket,
  leadStage,
  UNCLASSIFIED_SPECIALTY,
} from "@/lib/lead-course-distribution";

describe("CRM Course Categories attribution", () => {
  it("maps verified Odoo categories to the intended course and specialty", () => {
    expect(classifyLeadCourse("Facility Management")).toMatchObject({
      course: "CFM",
      specialty: "Facility management",
      verified: true,
    });
    expect(classifyLeadCourse("Management")).toMatchObject({
      course: "PMP",
      specialty: "Management",
      verified: true,
    });
    expect(classifyLeadCourse("Technical / Mechanical")).toMatchObject({
      course: "Mech",
      specialty: "Mechanical",
      verified: true,
    });
    expect(classifyLeadCourse("Technical / BIM MEP / Coordinator")).toMatchObject({
      course: "BIM",
      specialty: "BIM",
      verified: true,
    });
  });

  it("keeps unknown or missing categories visible for review", () => {
    expect(classifyLeadCourse("")).toMatchObject({
      verified: false,
      specialty: UNCLASSIFIED_SPECIALTY,
    });
    expect(classifyLeadCourse("New Odoo Specialty")).toMatchObject({
      course: "New Odoo Specialty",
      verified: false,
    });
  });

  it("does not label archived Lost leads by their preserved old stage", () => {
    expect(leadStage("lost", "Open")).toBe("Lost");
    expect(leadStage("open", "Long Follow Up")).toBe("Long Follow Up");
  });

  it("keeps fresh-lead outcomes separate from opportunity stages", () => {
    const fixture = [
      { type: "lead", stage: "New", count: 1 },
      { type: "lead", stage: "Lost", count: 23 },
      { type: "opportunity", stage: "New", count: 11 },
      { type: "opportunity", stage: "Preparation", count: 11 },
      { type: "opportunity", stage: "Open", count: 89 },
      { type: "opportunity", stage: "Quotation Sent", count: 2 },
      { type: "opportunity", stage: "Lost", count: 29 },
      { type: "opportunity", stage: "Won", count: 3 },
      { type: "opportunity", stage: "Long Follow Up", count: 4 },
    ];
    const byBucket = new Map<string, number>();
    for (const row of fixture) {
      const bucket = leadLifecycleBucket(row.type, row.stage);
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + row.count);
    }
    expect(byBucket.get("lead_active")).toBe(1);
    expect(byBucket.get("lead_lost")).toBe(23);
    expect(byBucket.get("opportunity")).toBe(149);
    expect([...byBucket.values()].reduce((sum, count) => sum + count, 0)).toBe(173);
    expect(leadLifecycleBucket("lead", "Archived")).toBe("lead_other");
    expect(leadLifecycleBucket("opportunity", "Lost")).toBe("opportunity");
  });
});
