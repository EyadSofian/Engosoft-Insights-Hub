export type MediaPlanStatus = "approved" | "draft";

export interface MediaPlanCourseTarget {
  /** Stable editor id. Custom courses are allowed for future monthly plans. */
  key: string;
  label: string;
  targetLeads: number;
  targetCpl: number;
  owners: string[];
  /** Extra campaign/course-name fragments used when linking live delivery. */
  matchTerms?: string[];
}

export interface MediaPlanActivityBudget {
  key: string;
  label: string;
  budgetUsd: number;
  matchTerms?: string[];
}

export interface MonthlyMediaPlan {
  month: string;
  status: MediaPlanStatus;
  basisMonth?: string;
  leadTarget: number;
  paidLeadTarget: number;
  organicWebinarLeadTarget: number;
  leadGenerationBudgetUsd: number;
  salesTargetUsd: number;
  courses: MediaPlanCourseTarget[];
  additionalActivities: MediaPlanActivityBudget[];
}

const AUGUST_COURSES: MediaPlanCourseTarget[] = [
  { key: "cfm", label: "CFM", targetLeads: 1_000, targetCpl: 7, owners: ["Sayed"] },
  {
    key: "interior",
    label: "Interior / Decor",
    targetLeads: 1_000,
    targetCpl: 3.5,
    owners: ["Shazly", "Sayed"],
  },
  { key: "pmp", label: "PMP", targetLeads: 500, targetCpl: 6, owners: ["Sayed"] },
  { key: "cmrp", label: "CMRP", targetLeads: 500, targetCpl: 5, owners: ["Sayed"] },
  {
    key: "bim",
    label: "BIM",
    targetLeads: 500,
    targetCpl: 3.5,
    owners: ["Shazly", "Sayed"],
  },
  {
    key: "automotive",
    label: "Automotive",
    targetLeads: 500,
    targetCpl: 3.5,
    owners: ["Shazly"],
  },
];

const ADDITIONAL_ACTIVITIES: MediaPlanActivityBudget[] = [
  {
    key: "website",
    label: "Website campaigns",
    budgetUsd: 3_000,
    matchTerms: ["web", "website", "web con", "web sign", "signup"],
  },
  { key: "webinar", label: "Webinar promotion", budgetUsd: 500, matchTerms: ["webinar"] },
  { key: "youtube", label: "YouTube", budgetUsd: 250, matchTerms: ["youtube"] },
  {
    key: "branding",
    label: "Social media branding",
    budgetUsd: 250,
    matchTerms: ["branding", "awareness"],
  },
];

const basePlan = (
  month: string,
  status: MediaPlanStatus,
  basisMonth?: string,
): MonthlyMediaPlan => ({
  month,
  status,
  basisMonth,
  leadTarget: 5_000,
  paidLeadTarget: 4_000,
  organicWebinarLeadTarget: 1_000,
  leadGenerationBudgetUsd: 20_000,
  salesTargetUsd: 150_000,
  courses: AUGUST_COURSES.map((row) => ({ ...row, owners: [...row.owners] })),
  additionalActivities: ADDITIONAL_ACTIVITIES.map((row) => ({
    ...row,
    matchTerms: row.matchTerms ? [...row.matchTerms] : [],
  })),
});

/**
 * August is the approved source plan. September intentionally starts as a
 * visible draft copied from that baseline until management publishes revised
 * targets; the UI never presents copied numbers as approved September facts.
 */
export const MEDIA_PLANS: Record<string, MonthlyMediaPlan> = {
  "2026-08": basePlan("2026-08", "approved"),
  "2026-09": basePlan("2026-09", "draft", "2026-08"),
};

export const mediaPlanMonths = (): string[] =>
  Object.keys(MEDIA_PLANS).sort((a, b) => b.localeCompare(a));

export function mediaPlanForMonth(month?: string): MonthlyMediaPlan {
  const selected = (month && MEDIA_PLANS[month]) || MEDIA_PLANS[mediaPlanMonths()[0]];
  return {
    ...selected,
    courses: selected.courses.map((row) => ({
      ...row,
      owners: [...row.owners],
      matchTerms: row.matchTerms ? [...row.matchTerms] : undefined,
    })),
    additionalActivities: selected.additionalActivities.map((row) => ({
      ...row,
      matchTerms: row.matchTerms ? [...row.matchTerms] : [],
    })),
  };
}

export function plannedCourseBudget(row: MediaPlanCourseTarget): number {
  return row.targetLeads * row.targetCpl;
}

const normalized = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Maps live dashboard course labels to the six course targets in the plan. */
export function mediaPlanCourseKey(value: string): MediaPlanCourseTarget["key"] | null {
  const key = normalized(value);
  if (/\bcfm\b|facility management/.test(key)) return "cfm";
  if (/\bcmrp\b|maintenance/.test(key)) return "cmrp";
  if (/\binterior\b|\bdecor\b/.test(key)) return "interior";
  if (/\bpmp\b/.test(key)) return "pmp";
  if (/\bbim\b/.test(key)) return "bim";
  if (/\bautomotive\b|\bauto\b/.test(key)) return "automotive";
  return null;
}

/** Match both the six canonical courses and future editor-added course aliases. */
export function matchMediaPlanCourse(
  targets: MediaPlanCourseTarget[],
  ...values: string[]
): MediaPlanCourseTarget | null {
  for (const value of values) {
    if (!value) continue;
    const canonical = mediaPlanCourseKey(value);
    if (canonical) {
      const target = targets.find((row) => row.key === canonical);
      if (target) return target;
    }

    const candidate = normalized(value);
    if (!candidate) continue;
    for (const target of targets) {
      const terms = [target.key, target.label, ...(target.matchTerms ?? [])]
        .map(normalized)
        .filter(Boolean);
      if (
        terms.some(
          (term) =>
            candidate === term ||
            candidate.includes(` ${term} `) ||
            candidate.startsWith(`${term} `) ||
            candidate.endsWith(` ${term}`),
        )
      ) {
        return target;
      }
    }
  }
  return null;
}

export function matchMediaPlanActivity(
  activities: MediaPlanActivityBudget[],
  ...values: string[]
): MediaPlanActivityBudget | null {
  for (const value of values) {
    const candidate = normalized(value);
    if (!candidate) continue;
    for (const activity of activities) {
      const terms = [activity.key, activity.label, ...(activity.matchTerms ?? [])]
        .map(normalized)
        .filter(Boolean);
      if (
        terms.some(
          (term) =>
            candidate === term ||
            candidate.includes(` ${term} `) ||
            candidate.startsWith(`${term} `) ||
            candidate.endsWith(` ${term}`),
        )
      ) {
        return activity;
      }
    }
  }
  return null;
}

export function nextMediaPlanMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) return "";
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

const validMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const boundedNumber = (value: unknown, label: string, max = 1_000_000_000): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`${label} must be a number between 0 and ${max}.`);
  }
  return parsed;
};
const shortText = (value: unknown, label: string, max: number, required = true): string => {
  const parsed = typeof value === "string" ? value.trim() : "";
  if ((required && !parsed) || parsed.length > max) {
    throw new Error(`${label} must be ${required ? "1–" : "at most "}${max} characters.`);
  }
  return parsed;
};
const stringList = (value: unknown, label: string, limit: number): string[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return [...new Set(value.map((item) => shortText(item, label, 100)).filter(Boolean))].slice(
    0,
    limit,
  );
};

/** Validate and detach a plan received from either PostgreSQL or the editor. */
export function normalizeMonthlyMediaPlan(value: unknown): MonthlyMediaPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Media plan must be an object.");
  }
  const raw = value as Record<string, unknown>;
  const month = shortText(raw.month, "month", 7);
  if (!validMonth(month)) throw new Error("month must be YYYY-MM.");
  const basisMonth = shortText(raw.basisMonth, "basisMonth", 7, false);
  if (basisMonth && !validMonth(basisMonth)) throw new Error("basisMonth must be YYYY-MM.");
  const status = raw.status === "approved" ? "approved" : raw.status === "draft" ? "draft" : null;
  if (!status) throw new Error("status must be draft or approved.");

  if (!Array.isArray(raw.courses) || raw.courses.length === 0 || raw.courses.length > 40) {
    throw new Error("courses must contain between 1 and 40 rows.");
  }
  const courseKeys = new Set<string>();
  const courses = raw.courses.map((entry, index): MediaPlanCourseTarget => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Course ${index + 1} must be an object.`);
    }
    const row = entry as Record<string, unknown>;
    const key = shortText(row.key, `Course ${index + 1} key`, 64).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) {
      throw new Error(`Course ${index + 1} key may only use letters, numbers, - and _.`);
    }
    if (courseKeys.has(key)) throw new Error(`Duplicate course key: ${key}.`);
    courseKeys.add(key);
    return {
      key,
      label: shortText(row.label, `Course ${index + 1} label`, 100),
      targetLeads: boundedNumber(row.targetLeads, `Course ${index + 1} target leads`, 10_000_000),
      targetCpl: boundedNumber(row.targetCpl, `Course ${index + 1} target CPL`, 1_000_000),
      owners: stringList(row.owners, `Course ${index + 1} owners`, 20),
      matchTerms: Array.isArray(row.matchTerms)
        ? stringList(row.matchTerms, `Course ${index + 1} match terms`, 20)
        : [],
    };
  });

  if (!Array.isArray(raw.additionalActivities) || raw.additionalActivities.length > 20) {
    throw new Error("additionalActivities must be an array with at most 20 rows.");
  }
  const activityKeys = new Set<string>();
  const additionalActivities = raw.additionalActivities.map(
    (entry, index): MediaPlanActivityBudget => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Activity ${index + 1} must be an object.`);
      }
      const row = entry as Record<string, unknown>;
      const key = shortText(row.key, `Activity ${index + 1} key`, 64).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) {
        throw new Error(`Activity ${index + 1} key may only use letters, numbers, - and _.`);
      }
      if (activityKeys.has(key)) throw new Error(`Duplicate activity key: ${key}.`);
      activityKeys.add(key);
      return {
        key,
        label: shortText(row.label, `Activity ${index + 1} label`, 100),
        budgetUsd: boundedNumber(row.budgetUsd, `Activity ${index + 1} budget`, 100_000_000),
        matchTerms: Array.isArray(row.matchTerms)
          ? stringList(row.matchTerms, `Activity ${index + 1} match terms`, 20)
          : [],
      };
    },
  );

  const paidLeadTarget = boundedNumber(raw.paidLeadTarget, "paidLeadTarget", 10_000_000);
  const organicWebinarLeadTarget = boundedNumber(
    raw.organicWebinarLeadTarget,
    "organicWebinarLeadTarget",
    10_000_000,
  );
  return {
    month,
    status,
    ...(basisMonth ? { basisMonth } : {}),
    // This total is derived so the three plan headlines can never disagree.
    leadTarget: paidLeadTarget + organicWebinarLeadTarget,
    paidLeadTarget,
    organicWebinarLeadTarget,
    leadGenerationBudgetUsd: boundedNumber(
      raw.leadGenerationBudgetUsd,
      "leadGenerationBudgetUsd",
      100_000_000,
    ),
    salesTargetUsd: boundedNumber(raw.salesTargetUsd, "salesTargetUsd", 1_000_000_000),
    courses,
    additionalActivities,
  };
}
