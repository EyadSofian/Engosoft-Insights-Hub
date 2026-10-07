import { canonicalCourseValue, isKnownCourse } from "./course-taxonomy";

export const UNCLASSIFIED_COURSE = "غير محدد";
export const UNCLASSIFIED_SPECIALTY = "تحتاج مراجعة";

const SPECIALTY_BY_COURSE: Record<string, string> = {
  Arch: "Architecture",
  Auto: "Automotive",
  BIM: "BIM",
  CFM: "Facility management",
  CMRP: "Maintenance",
  Elec: "Electrical",
  Infra: "Civil / infrastructure",
  Interior: "Interior",
  Mech: "Mechanical",
  PMP: "Management",
  Safety: "Safety",
  Steel: "Civil / structure",
  Struc: "Civil / structure",
};

/** Only Odoo's Course Categories field can assign a reporting course. */
export function classifyLeadCourse(rawCategory: string) {
  const raw = rawCategory.trim();
  const verified = Boolean(raw) && isKnownCourse(raw);
  const course = verified ? canonicalCourseValue(raw) : raw || UNCLASSIFIED_COURSE;
  return {
    course,
    specialty: verified ? (SPECIALTY_BY_COURSE[course] ?? course) : UNCLASSIFIED_SPECIALTY,
    verified,
  };
}

export function leadStage(status: string, actualStage: string) {
  if (status === "lost") return "Lost";
  if (status === "archived") return "Archived";
  return actualStage.trim() || "Unspecified stage";
}

export type LeadLifecycleBucket = "lead_active" | "lead_lost" | "lead_other" | "opportunity";

/** Mutually exclusive current CRM states. Opportunity stages are a breakdown, not extra leads. */
export function leadLifecycleBucket(recordType: string, stage: string): LeadLifecycleBucket {
  if (recordType === "opportunity") return "opportunity";
  if (stage === "Lost") return "lead_lost";
  if (stage === "Archived") return "lead_other";
  return "lead_active";
}
