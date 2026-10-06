import { describe, expect, it } from "vitest";
import { MEDIA_PLANS } from "@/lib/media-plan";
import { linkedMediaPlanLeads, mediaPlanLeadMatch } from "@/lib/media-plan-lead-link";
import type { CourseLeadRecord } from "@/lib/lead-course-distribution.server";

const plan = MEDIA_PLANS["2026-10"];
const lead = (id: string, course: string, source = "Meta", verified = true) =>
  ({ id, course, source, verified }) as CourseLeadRecord;
const rows = [
  lead("1", "CFM"),
  lead("2", "PMP"),
  lead("3", "Interior"),
  lead("4", "Other", "Website"),
  lead("5", "CFM", "Website"),
  lead("6", "CFM", "Meta", false),
];

describe("media plan Odoo lead drilldown", () => {
  it("links course cards using verified Odoo Course Categories, not ad campaign names", () => {
    expect(mediaPlanLeadMatch(plan, "cfm")).toBe("course_category");
    expect(linkedMediaPlanLeads(plan, "cfm", rows).map((row) => row.id)).toEqual(["1", "5"]);
    expect(linkedMediaPlanLeads(plan, "interior", rows).map((row) => row.id)).toEqual(["3"]);
  });

  it("links website activity only through the Odoo Source field", () => {
    expect(mediaPlanLeadMatch(plan, "website")).toBe("source");
    expect(linkedMediaPlanLeads(plan, "website", rows).map((row) => row.id)).toEqual(["4", "5"]);
  });

  it("does not invent individual leads for manual goals", () => {
    expect(mediaPlanLeadMatch(plan, "youtube")).toBe("unavailable");
    expect(linkedMediaPlanLeads(plan, "youtube", rows)).toEqual([]);
  });
});
