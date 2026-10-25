import { describe, expect, it } from "vitest";
import {
  addMediaPlanLifecycle,
  emptyMediaPlanLifecycle,
  mediaPlanLifecycleTotal,
  mediaPlanOpportunityActual,
} from "@/lib/media-plan-lifecycle";
import { deliverableStatus } from "@/lib/media-plan-delivery";
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
    expect(mediaPlanOpportunityActual(total)).toBe(2);
  });

  it("bases the course headline and pace badge on opportunities, not mixed CRM records", () => {
    const cfm = { leadActive: 2, leadLost: 48, leadOther: 0, opportunities: 372, opportunityLost: 120 };
    const pmp = { leadActive: 19, leadLost: 31, leadOther: 0, opportunities: 528, opportunityLost: 168 };
    const cmrp = { leadActive: 5, leadLost: 0, leadOther: 0, opportunities: 275, opportunityLost: 0 };
    const elapsed = 22 / 31;

    expect(mediaPlanOpportunityActual(cfm)).toBe(372);
    expect(deliverableStatus(mediaPlanOpportunityActual(cfm), 648, elapsed, true)).toBe("behind");
    expect(mediaPlanOpportunityActual(pmp)).toBe(528);
    expect(deliverableStatus(mediaPlanOpportunityActual(pmp), 864, elapsed, true)).toBe("behind");
    expect(mediaPlanOpportunityActual(cmrp)).toBe(275);
    expect(deliverableStatus(mediaPlanOpportunityActual(cmrp), 288, elapsed, true)).toBe("ahead");
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
