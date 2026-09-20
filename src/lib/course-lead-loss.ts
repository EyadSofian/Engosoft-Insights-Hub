import { normalizeCourseKey } from "./course-taxonomy";
import type { CrmRecordType } from "./types";

export interface CourseLeadLossSourceRow {
  course: string;
  recordType: CrmRecordType;
}

export interface CourseLeadLossRange {
  from: string;
  to: string;
}

export interface CourseLeadLossRow {
  key: string;
  course: string;
  label: string;
  leads: number;
  lost: number;
  lostLeads: number;
  lostOpportunities: number;
  lostRate: number | null;
  previousLeads: number;
  previousLost: number;
  leadDelta: number;
  leadDeltaRate: number | null;
}

export interface CourseLeadLossReport {
  definition: "creation_cohort";
  currentRange: CourseLeadLossRange;
  previousRange: CourseLeadLossRange | null;
  rows: CourseLeadLossRow[];
  totals: Omit<CourseLeadLossRow, "key" | "course" | "label">;
}

export interface CourseLostMovementRow {
  key: string;
  course: string;
  label: string;
  lost: number;
  lostLeads: number;
  lostOpportunities: number;
  share: number;
}

export interface CourseLostMovementReport {
  definition: "closed_in_period";
  range: CourseLeadLossRange;
  rows: CourseLostMovementRow[];
  totals: Pick<CourseLostMovementRow, "lost" | "lostLeads" | "lostOpportunities">;
}

const UNCLASSIFIED = "Unclassified";

const DISPLAY_NAMES: Record<string, string> = {
  Arch: "Architecture",
  Auto: "Automotive",
  CFM: "Facility Management",
  Elec: "Electrical",
  Infra: "Infrastructure",
  Interior: "Interior Design",
  Mech: "Mechanical",
  PMP: "Management (PMP)",
  Struc: "Structure",
  Web: "Website",
};

const identity = (course: string) => {
  const value = course.trim() || UNCLASSIFIED;
  return {
    key: normalizeCourseKey(value),
    course: value,
    label: DISPLAY_NAMES[value] ?? value,
  };
};

/** Lost movement grouped by course; the input must already be close-date filtered. */
export function buildCourseLostMovementReport(args: {
  lost: CourseLeadLossSourceRow[];
  range: CourseLeadLossRange;
}): CourseLostMovementReport {
  const grouped = new Map<string, Omit<CourseLostMovementRow, "share">>();
  for (const source of args.lost) {
    const value = identity(source.course);
    const row = grouped.get(value.key) ?? {
      ...value,
      lost: 0,
      lostLeads: 0,
      lostOpportunities: 0,
    };
    row.lost += 1;
    if (source.recordType === "lead") row.lostLeads += 1;
    else row.lostOpportunities += 1;
    grouped.set(value.key, row);
  }
  const lost = args.lost.length;
  const rows = [...grouped.values()]
    .map((row) => ({ ...row, share: lost > 0 ? (row.lost / lost) * 100 : 0 }))
    .sort((a, b) => b.lost - a.lost || a.label.localeCompare(b.label));
  return {
    definition: "closed_in_period",
    range: args.range,
    rows,
    totals: {
      lost,
      lostLeads: rows.reduce((sum, row) => sum + row.lostLeads, 0),
      lostOpportunities: rows.reduce((sum, row) => sum + row.lostOpportunities, 0),
    },
  };
}

interface Accumulator {
  key: string;
  course: string;
  label: string;
  leads: number;
  lost: number;
  lostLeads: number;
  lostOpportunities: number;
}

function cohort(
  active: CourseLeadLossSourceRow[],
  lost: CourseLeadLossSourceRow[],
): Map<string, Accumulator> {
  const rows = new Map<string, Accumulator>();
  const get = (course: string) => {
    const value = identity(course);
    let row = rows.get(value.key);
    if (!row) {
      row = { ...value, leads: 0, lost: 0, lostLeads: 0, lostOpportunities: 0 };
      rows.set(value.key, row);
    }
    return row;
  };

  for (const source of active) get(source.course).leads += 1;
  for (const source of lost) {
    const row = get(source.course);
    row.leads += 1;
    row.lost += 1;
    if (source.recordType === "lead") row.lostLeads += 1;
    else row.lostOpportunities += 1;
  }
  return rows;
}

const rate = (part: number, total: number) => (total > 0 ? (part / total) * 100 : null);

/**
 * The course table is a creation-cohort report. A Lost row is counted once in
 * Leads and once in Lost, so Lost is visibly a subset rather than a second
 * population. This deliberately does not use the Lost movement/close date.
 */
export function buildCourseLeadLossReport(args: {
  active: CourseLeadLossSourceRow[];
  lost: CourseLeadLossSourceRow[];
  previousActive?: CourseLeadLossSourceRow[];
  previousLost?: CourseLeadLossSourceRow[];
  currentRange: CourseLeadLossRange;
  previousRange?: CourseLeadLossRange | null;
}): CourseLeadLossReport {
  const current = cohort(args.active, args.lost);
  const previous = cohort(args.previousActive ?? [], args.previousLost ?? []);
  const keys = new Set([...current.keys(), ...previous.keys()]);
  const rows = [...keys]
    .map((key): CourseLeadLossRow => {
      const now = current.get(key);
      const before = previous.get(key);
      const base = now ?? before!;
      const leads = now?.leads ?? 0;
      const lost = now?.lost ?? 0;
      const previousLeads = before?.leads ?? 0;
      const previousLost = before?.lost ?? 0;
      return {
        key,
        course: base.course,
        label: base.label,
        leads,
        lost,
        lostLeads: now?.lostLeads ?? 0,
        lostOpportunities: now?.lostOpportunities ?? 0,
        lostRate: rate(lost, leads),
        previousLeads,
        previousLost,
        leadDelta: leads - previousLeads,
        leadDeltaRate: rate(leads - previousLeads, previousLeads),
      };
    })
    .sort((a, b) => b.leads - a.leads || b.lost - a.lost || a.label.localeCompare(b.label));

  const sums = rows.reduce(
    (total, row) => {
      total.leads += row.leads;
      total.lost += row.lost;
      total.lostLeads += row.lostLeads;
      total.lostOpportunities += row.lostOpportunities;
      total.previousLeads += row.previousLeads;
      total.previousLost += row.previousLost;
      return total;
    },
    {
      leads: 0,
      lost: 0,
      lostLeads: 0,
      lostOpportunities: 0,
      previousLeads: 0,
      previousLost: 0,
    },
  );

  return {
    definition: "creation_cohort",
    currentRange: args.currentRange,
    previousRange: args.previousRange ?? null,
    rows,
    totals: {
      ...sums,
      lostRate: rate(sums.lost, sums.leads),
      leadDelta: sums.leads - sums.previousLeads,
      leadDeltaRate: rate(sums.leads - sums.previousLeads, sums.previousLeads),
    },
  };
}
