import { describe, expect, it } from "vitest";
import {
  addMediaPlanLifecycle,
  emptyMediaPlanLifecycle,
  mediaPlanLifecycleTotal,
} from "@/lib/media-plan-lifecycle";
import { mediaPlanRecordMatches } from "@/lib/media-plan-lead-link";
import type { CourseLeadRecord } from "@/lib/lead-course-distribution.server";

describe("media plan Odoo lifecycle", () => {
  it("keeps archived Lost leads out of the opportunity denominator", () => {
    const total = emptyMediaPlanLifecycle();
    addMediaPlanLifecycle(total, { recordType: "lead", businessStatus: "lead" });
    addMediaPlanLifecycle(total, { recordType: "lead", businessStatus: "lost" });
    addMediaPlanLifecycle(total, { recordType: "opportunity", businessStatus: "open" });
    addMediaPlanLifecycle(total, { recordType: "opportunity", businessStatus: "lost" });
    expect(total).toEqual({ leadActive: 1, leadLost: 1, leadOther: 0, opportunities: 2, opportunityLost: 1 });
    expect(mediaPlanLifecycleTotal(total)).toBe(4);
  });

  it("opens Lost lead and Lost opportunity records in separate drill-downs", () => {
    const lostLead = { recordType: "lead", stage: "Lost" } as CourseLeadRecord;
    const lostOpportunity = { recordType: "opportunity", stage: "Lost" } as CourseLeadRecord;
    expect(mediaPlanRecordMatches(lostLead, "lead_lost")).toBe(true);
    expect(mediaPlanRecordMatches(lostLead, "opportunity", true)).toBe(false);
    expect(mediaPlanRecordMatches(lostOpportunity, "lead_lost")).toBe(false);
    expect(mediaPlanRecordMatches(lostOpportunity, "opportunity", true)).toBe(true);
  });
});
