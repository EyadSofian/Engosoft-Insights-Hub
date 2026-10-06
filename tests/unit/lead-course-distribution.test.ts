import { describe, expect, it } from "vitest";
import { classifyLeadCourse, leadStage, UNCLASSIFIED_SPECIALTY } from "@/lib/lead-course-distribution";

describe("CRM Course Categories attribution", () => {
  it("maps verified Odoo categories to the intended course and specialty", () => {
    expect(classifyLeadCourse("Facility Management")).toMatchObject({ course: "CFM", specialty: "Facility management", verified: true });
    expect(classifyLeadCourse("Management")).toMatchObject({ course: "PMP", specialty: "Management", verified: true });
    expect(classifyLeadCourse("Technical / Mechanical")).toMatchObject({ course: "Mech", specialty: "Mechanical", verified: true });
    expect(classifyLeadCourse("Technical / BIM MEP / Coordinator")).toMatchObject({ course: "BIM", specialty: "BIM", verified: true });
  });

  it("keeps unknown or missing categories visible for review", () => {
    expect(classifyLeadCourse("")).toMatchObject({ verified: false, specialty: UNCLASSIFIED_SPECIALTY });
    expect(classifyLeadCourse("New Odoo Specialty")).toMatchObject({ course: "New Odoo Specialty", verified: false });
  });

  it("does not label archived Lost leads by their preserved old stage", () => {
    expect(leadStage("lost", "Open")).toBe("Lost");
    expect(leadStage("open", "Long Follow Up")).toBe("Long Follow Up");
  });
});
