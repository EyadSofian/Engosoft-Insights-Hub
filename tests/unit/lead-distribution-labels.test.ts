import { describe, expect, it } from "vitest";
import { COURSE_CODES } from "@/lib/course-taxonomy";
import {
  courseDisplayName,
  groupDisplayName,
  lifecycleDisplayName,
  recordTypeDisplayName,
  specialtyDisplayName,
  stageDisplayName,
} from "@/lib/lead-distribution-labels";
import { NAVIGATION_SECTIONS } from "@/lib/navigation";

const hasLatin = (value: string) => /[A-Za-z]/.test(value);
const hasArabic = (value: string) => /\p{Script=Arabic}/u.test(value);

describe("lead distribution language consistency", () => {
  it("localizes every known course code without changing its underlying key", () => {
    for (const course of COURSE_CODES) {
      expect(hasArabic(courseDisplayName(course, true)), course).toBe(true);
      expect(hasLatin(courseDisplayName(course, true)), course).toBe(false);
      expect(courseDisplayName(course, false)).toBe(course);
    }
  });

  it("localizes every specialty and stage used in the current CRM view", () => {
    const specialties = [
      "Facility management",
      "Automotive",
      "Interior",
      "Management",
      "Maintenance",
      "BIM",
      "Electrical",
      "Mechanical",
      "Other",
      "Civil / structure",
      "Architecture",
      "Civil / infrastructure",
      "تحتاج مراجعة",
    ];
    const stages = [
      "Long Follow Up",
      "New",
      "Open",
      "Preparation",
      "Quotation Sent",
      "Won",
      "Lost",
    ];
    for (const specialty of specialties) {
      expect(hasLatin(specialtyDisplayName(specialty, true)), specialty).toBe(false);
      expect(hasArabic(specialtyDisplayName(specialty, false)), specialty).toBe(false);
    }
    for (const stage of stages) {
      expect(hasLatin(stageDisplayName(stage, true)), stage).toBe(false);
      expect(hasArabic(stageDisplayName(stage, false)), stage).toBe(false);
    }
    expect(groupDisplayName("غير محدد", "course", false)).toBe("Unspecified course");
  });

  it("keeps navigation, lifecycle and record-type labels in the chosen language", () => {
    const nav = NAVIGATION_SECTIONS.find((section) => section.id === "sales-crm")!;
    expect(hasLatin(nav.label.ar)).toBe(false);
    expect(hasArabic(nav.label.en)).toBe(false);
    for (const item of nav.items) {
      expect(hasLatin(item.tabLabel!.ar)).toBe(false);
      expect(hasArabic(item.tabLabel!.en)).toBe(false);
    }
    for (const bucket of ["lead_active", "lead_lost", "lead_other", "opportunity"] as const) {
      expect(hasLatin(lifecycleDisplayName(bucket, true))).toBe(false);
      expect(hasArabic(lifecycleDisplayName(bucket, false))).toBe(false);
    }
    expect(recordTypeDisplayName("lead", true)).toBe("عميل محتمل");
    expect(recordTypeDisplayName("opportunity", false)).toBe("Opportunity");
  });
});
