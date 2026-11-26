import type { CrmLeadRow, LostRow } from "./types";
import { currentOwnerMissing } from "./lead-ownership-audit";

export interface TeamCourseLead {
  id: string;
  ownerKey: string;
  salesperson: string;
  team: string;
  course: string;
  contact: string;
  createdAt: string;
  status: "lead" | "open" | "won" | "lost";
  stage: string;
  recordType: "lead" | "opportunity";
  source: string;
}

export const teamCourseOwnerKey = (name: string) =>
  JSON.stringify([currentOwnerMissing(name) ? "" : name.trim()]);

/** Same filtered creation cohort as Teams; one Odoo id, one primary course.
 * Canonical Lost wins an accidental overlap; phone duplicates are not silently deleted.
 */
export function teamCourseLeadRecords(
  crm: readonly CrmLeadRow[],
  lost: readonly LostRow[],
  company?: string,
): TeamCourseLead[] {
  const records = new Map<string, TeamCourseLead>();
  const add = (row: CrmLeadRow | LostRow, isLost: boolean) => {
    if (!row.id || (company && row.company !== company)) return;
    const salesperson = currentOwnerMissing(row.salesperson) ? "" : row.salesperson.trim();
    records.set(row.id, {
      id: row.id,
      ownerKey: teamCourseOwnerKey(salesperson),
      salesperson,
      team: row.salesTeam?.trim() || "",
      course: row.course?.trim() || "غير محدد",
      contact: row.contact || "",
      createdAt: row.createdAt,
      status: isLost ? "lost" : (row as CrmLeadRow).isWon ? "won" : row.businessStatus,
      stage: ("cleanedStage" in row ? row.cleanedStage : "") || row.stage || "",
      recordType: row.recordType,
      source: row.source || "",
    });
  };
  for (const row of crm) add(row, false);
  for (const row of lost) add(row, true);
  return [...records.values()];
}

export interface TeamCourseMatrix {
  total: number;
  courses: { key: string; total: number }[];
  rows: {
    key: string;
    salesperson: string;
    displayName: string;
    teams: string[];
    counts: Record<string, number>;
    total: number;
  }[];
}

export function buildTeamCourseMatrix(
  records: readonly TeamCourseLead[],
  displayNameFor: (name: string) => string = (name) => name,
  roster: readonly { name: string; team?: string }[] = [],
): TeamCourseMatrix {
  const owners = new Map<string, TeamCourseMatrix["rows"][number]>();
  const courses = new Map<string, number>();
  const owner = (name: string, team: string) => {
    const key = teamCourseOwnerKey(name);
    let row = owners.get(key);
    if (!row) {
      const salesperson = currentOwnerMissing(name) ? "" : name.trim();
      row = {
        key,
        salesperson,
        displayName: salesperson ? displayNameFor(salesperson) : "",
        teams: [],
        counts: Object.create(null),
        total: 0,
      };
      owners.set(key, row);
    }
    if (team && !row.teams.includes(team)) row.teams.push(team);
    return row;
  };
  for (const person of roster) owner(person.name, person.team || "");
  for (const lead of records) {
    const row = owner(lead.salesperson, lead.team);
    row.counts[lead.course] = (row.counts[lead.course] || 0) + 1;
    row.total++;
    courses.set(lead.course, (courses.get(lead.course) || 0) + 1);
  }
  return {
    total: records.length,
    courses: [...courses]
      .map(([key, total]) => ({ key, total }))
      .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)),
    rows: [...owners.values()].sort(
      (a, b) =>
        Number(!a.salesperson) - Number(!b.salesperson) ||
        b.total - a.total ||
        a.displayName.localeCompare(b.displayName),
    ),
  };
}

export function teamCourseLeadPage(
  records: readonly TeamCourseLead[],
  ownerKey: string,
  course: string,
  offset: number,
  limit: number,
  odooBaseUrl: string,
) {
  const matching = records
    .filter((row) => row.ownerKey === ownerKey && row.course === course)
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
  const start = Math.max(0, Math.trunc(offset));
  const size = Math.min(100, Math.max(1, Math.trunc(limit)));
  return {
    total: matching.length,
    offset: start,
    limit: size,
    hasNext: start + size < matching.length,
    rows: matching.slice(start, start + size).map(({ ownerKey: _key, ...row }) => ({
      ...row,
      odooUrl: /^\d+$/.test(row.id)
        ? `${odooBaseUrl.replace(/\/$/, "")}/web#id=${encodeURIComponent(row.id)}&model=crm.lead&view_type=form`
        : null,
    })),
  };
}

export type TeamCourseLeadPage = ReturnType<typeof teamCourseLeadPage>;
