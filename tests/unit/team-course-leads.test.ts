import { describe, expect, it } from "vitest";
import {
  buildTeamCourseMatrix,
  teamCourseLeadPage,
  teamCourseLeadRecords,
  teamCourseOwnerKey,
} from "@/lib/team-course-leads";
import type { CrmLeadRow, LostRow } from "@/lib/types";

const lead = (
  id: string,
  course = "PMP",
  salesperson = "Sales A",
  extra: Partial<CrmLeadRow> = {},
) =>
  ({
    id,
    course,
    salesperson,
    company: "Egypt",
    salesTeam: "Team A",
    contact: `Contact ${id}`,
    createdAt: "2026-11-26",
    stage: "New",
    businessStatus: "lead",
    recordType: "lead",
    source: "Facebook",
    ...extra,
  }) as CrmLeadRow;

describe("salesperson/course lead matrix", () => {
  it("reconciles every course, row and cell against the exact drill-down population", () => {
    const records = teamCourseLeadRecords(
      [
        lead("1"),
        lead("2", "CFM"),
        lead("3", "PMP", "Sales B"),
        lead("4", "CFM", "Sales A", { isWon: true, salesTeam: "Team B" }),
      ],
      [{ ...lead("5", "PMP", "Sales A"), businessStatus: "lost" } as LostRow],
    );
    const matrix = buildTeamCourseMatrix(records, (name) => name + " Display", [
      { name: "Sales Zero", team: "Team A" },
    ]);
    expect(matrix.total).toBe(5);
    expect(matrix.rows.reduce((sum, row) => sum + row.total, 0)).toBe(matrix.total);
    expect(matrix.courses.reduce((sum, col) => sum + col.total, 0)).toBe(matrix.total);
    const a = matrix.rows.find((row) => row.salesperson === "Sales A")!;
    expect(a.total).toBe(4);
    expect(a.teams).toEqual(["Team A", "Team B"]);
    expect(a.displayName).toBe("Sales A Display");
    expect(matrix.rows.find((row) => row.salesperson === "Sales Zero")?.total).toBe(0);
    for (const row of matrix.rows)
      for (const col of matrix.courses) {
        const page = teamCourseLeadPage(records, row.key, col.key, 0, 100, "https://odoo.test");
        expect(page.total).toBe(row.counts[col.key] || 0);
      }
  });
  it("counts each Odoo id once, keeps distinct phone duplicates and counts only the primary course", () => {
    const a = lead("1", "PMP", "Sales A", { phone: "0123456789", courses: "PMP, CFM" });
    const records = teamCourseLeadRecords(
      [a, a, { ...a, id: "2" }],
      [{ ...a, businessStatus: "lost", lossReason: "Duplicate" } as LostRow],
    );
    expect(records).toHaveLength(2);
    expect(records.find((row) => row.id === "1")?.status).toBe("lost");
    expect(buildTeamCourseMatrix(records).courses).toEqual([{ key: "PMP", total: 2 }]);
  });
  it("keeps missing owners and primary courses explicit and does not merge display-name collisions", () => {
    const records = teamCourseLeadRecords(
      [lead("1", "", "—"), lead("2", "CFM", "Full Name One"), lead("3", "CFM", "Full Name Two")],
      [],
    );
    const matrix = buildTeamCourseMatrix(records, () => "Same display name");
    expect(matrix.rows).toHaveLength(3);
    expect(matrix.rows.at(-1)?.salesperson).toBe("");
    expect(matrix.rows.at(-1)?.counts["غير محدد"]).toBe(1);
    expect(teamCourseOwnerKey("—")).toBe(teamCourseOwnerKey(""));
  });
  it("does not truncate courses or pages, and makes only valid Odoo record links", () => {
    const records = teamCourseLeadRecords(
      Array.from({ length: 117 }, (_, index) => lead(String(index + 1))),
      [],
    );
    const ids: string[] = [];
    for (let offset = 0; offset < records.length; offset += 50) {
      const page = teamCourseLeadPage(
        records,
        teamCourseOwnerKey("Sales A"),
        "PMP",
        offset,
        50,
        "https://odoo.test/",
      );
      expect(page.total).toBe(117);
      expect(page.hasNext).toBe(offset + 50 < 117);
      ids.push(...page.rows.map((row) => row.id));
      expect(page.rows[0].odooUrl).toMatch(
        /^https:\/\/odoo.test\/web#id=\d+&model=crm.lead&view_type=form$/,
      );
    }
    expect(new Set(ids).size).toBe(117);
    expect(
      buildTeamCourseMatrix(
        teamCourseLeadRecords(
          Array.from({ length: 30 }, (_, n) => lead(String(n), `Course ${n}`)),
          [],
        ),
      ).courses,
    ).toHaveLength(30);
    expect(
      teamCourseLeadPage(
        teamCourseLeadRecords([lead("not-an-odoo-id")], []),
        teamCourseOwnerKey("Sales A"),
        "PMP",
        0,
        50,
        "https://odoo.test",
      ).rows[0].odooUrl,
    ).toBeNull();
  });
  it("applies a selected company without importing other-company records", () => {
    expect(
      teamCourseLeadRecords(
        [lead("1"), lead("2", "CFM", "Sales A", { company: "KSA" })],
        [],
        "KSA",
      ).map((row) => row.id),
    ).toEqual(["2"]);
  });
});
