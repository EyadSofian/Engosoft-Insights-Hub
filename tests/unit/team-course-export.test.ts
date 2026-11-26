import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import {
  createTeamCourseCsv,
  createTeamCourseWorkbook,
  type TeamCourseExport,
} from "@/lib/team-course-export";
import { buildTeamCourseMatrix, teamCourseLeadRecords } from "@/lib/team-course-leads";

const records = teamCourseLeadRecords(
  [
    { id: "1", course: "PMP", salesperson: "Sales A", salesTeam: "Team A" },
    { id: "2", course: "PMP", salesperson: "Sales A", salesTeam: "Team A" },
    { id: "3", course: "CFM", salesperson: "Sales A", salesTeam: "Team A" },
    { id: "4", course: "CFM", salesperson: "Sales B", salesTeam: "Team B" },
    { id: "5", course: "CFM", salesperson: "", salesTeam: "" },
  ] as any,
  [],
);
const matrix = buildTeamCourseMatrix(records, (name) => name, [{ name: "Sales Zero" }]);
const input = (all = false): TeamCourseExport => ({
  matrix,
  rows: all ? matrix.rows : matrix.rows.filter((row) => row.salesperson === "Sales A"),
  filters: { from: "2026-11-10", to: "2026-11-20", platform: "meta" },
  lang: "en",
  search: all ? "" : "Sales A",
});

it("writes only visible salespeople with the selected dates and exact numeric CSV totals", () => {
  const csv = createTeamCourseCsv(input());
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const parsed = Papa.parse<Record<string, string>>(csv.slice(1), { header: true });
  expect(parsed.errors).toEqual([]);
  expect(parsed.data).toHaveLength(2);
  expect(parsed.data[0]).toMatchObject({
    Salesperson: "Sales A",
    Team: "Team A",
    From: "2026-11-10",
    To: "2026-11-20",
    CFM: "1",
    PMP: "2",
    Total: "3",
  });
  expect(parsed.data[1]).toMatchObject({
    Salesperson: "Visible row totals",
    CFM: "1",
    PMP: "2",
    Total: "3",
  });
  expect(csv).not.toContain("Sales B");
});
it("quotes CSV text, preserves Arabic and prevents formula injection in source labels", () => {
  const data = input();
  data.rows = [{ ...data.rows[0], displayName: '=SUM(1,2)\n"عميل"', teams: ["Team, A"] }];
  const parsed = Papa.parse<Record<string, string>>(createTeamCourseCsv(data).slice(1), {
    header: true,
  });
  expect(parsed.errors).toEqual([]);
  expect(parsed.data[0].Salesperson).toBe('\'=SUM(1,2)\n"عميل"');
  expect(parsed.data[0].Team).toBe("Team, A");
});
it("creates an editable, frozen workbook with cached formulas and complete filter provenance", async () => {
  const wb = createTeamCourseWorkbook(input(true));
  if (process.env.TEAM_COURSE_TEST_XLSX) await wb.xlsx.writeFile(process.env.TEAM_COURSE_TEST_XLSX);
  const copy = new ExcelJS.Workbook();
  await copy.xlsx.load(await wb.xlsx.writeBuffer());
  const sheet = copy.worksheets[0];
  expect(sheet.views[0]).toMatchObject({
    state: "frozen",
    xSplit: 2,
    ySplit: 7,
    rightToLeft: false,
  });
  expect(sheet.getCell("B2").value).toBe("2026-11-10 → 2026-11-20");
  expect(sheet.getCell("E8").value).toEqual({ formula: "SUM(C8:D8)", result: 3 });
  expect(sheet.getCell("E12").value).toEqual({ formula: "SUBTOTAL(109,E8:E11)", result: 5 });
  expect(sheet.getCell("C12").result).toBe(3);
  expect(sheet.getCell("D12").result).toBe(2);
  expect(sheet.getCell("E10").result).toBe(0);
  expect(sheet.getCell("A11").value).toBe("No current owner");
  expect(copy.worksheets[1].getColumn(1).values).toContain("platform");
  expect(copy.worksheets[1].getColumn(2).values).toContain("meta");
  expect(sheet.getCell("A8").font.name).toBe("Arial");
});
it("does not leak hidden-search rows and supports Arabic / all-time scope", async () => {
  const wb = createTeamCourseWorkbook({ ...input(), lang: "ar", filters: { range: "all" } });
  const sheet = wb.worksheets[0];
  expect(sheet.getCell("B2").value).toBe("كل الفترات");
  expect(sheet.getCell("A8").value).toBe("Sales A");
  expect(sheet.getCell("E9").result).toBe(3);
  expect(sheet.getCell("A9").value).toBe("إجمالي الصفوف المعروضة");
  expect(sheet.views[0].rightToLeft).toBe(true);
  expect(wb.worksheets[1].getColumn(2).values).toContain("Sales A");
});
it("handles an empty matrix without circular or invalid formula ranges", () => {
  const wb = createTeamCourseWorkbook({
    ...input(),
    matrix: { total: 0, rows: [], courses: [] },
    rows: [],
  });
  expect(wb.worksheets[0].getCell("C8").formula).toBe("SUM(0)");
  expect(wb.worksheets[0].getCell("C8").result).toBe(0);
});
