// Read the supplied workbook, prove exact identity and totals, and produce a
// clean roster export. Never edits the original or carries its broken formulas.
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { targetIndexForMonth } from "../src/lib/sales-targets.ts";
import { normalizePersonName } from "../src/lib/person-name.ts";

const [source, output] = process.argv.slice(2);
if (!source || !output)
  throw new Error(
    "Usage: node --experimental-strip-types scripts/analyze-november-targets.mjs input.xlsx output.xlsx",
  );
const bytes = await readFile(source);
const hash = createHash("sha256").update(bytes).digest("hex");
const original = new ExcelJS.Workbook();
await original.xlsx.load(bytes);
const sheet = original.getWorksheet("Sheet1");
if (!sheet || sheet.getCell("B1").text !== "Target November (USD)")
  throw new Error("Unexpected workbook/month; refusing import.");
const { byName, duplicates } = targetIndexForMonth("2026-11");
if (duplicates.length) throw new Error("Ambiguous published employee identity.");
let unit = "";
const records = [];
const seen = new Set();
const problems = [];
for (let rowNumber = 1; rowNumber <= 28; rowNumber++) {
  const row = sheet.getRow(rowNumber);
  const rawName = row.getCell(1).text.trim();
  if (rawName === "Bahaa's Unit" || rawName === "Asmaa's Unit") {
    unit = rawName;
    continue;
  }
  const target = row.getCell(2).value;
  const team = row.getCell(3).text.trim();
  if (!rawName || typeof target !== "number" || typeof row.getCell(3).value !== "string" || !team)
    continue;
  const employee = byName.get(normalizePersonName(rawName));
  if (!employee || seen.has(employee.employeeId))
    throw new Error(`Unmatched/duplicate identity on row ${rowNumber}`);
  if (
    employee.target !== target ||
    employee.teamLeader !== team ||
    employee.supervisor !== (unit === "Bahaa's Unit" ? "Bahaa Ramadan" : "Asmaa Fathy")
  ) {
    throw new Error(`Published roster differs from workbook row ${rowNumber}`);
  }
  seen.add(employee.employeeId);
  records.push({
    month: "2026-11",
    unit,
    team,
    name: rawName,
    employeeId: employee.employeeId,
    target,
    sourceRow: rowNumber,
  });
}
for (const row of sheet.getRows(1, sheet.rowCount) || [])
  row.eachCell((cell) => {
    if (cell.formula?.includes("#REF!") || cell.type === ExcelJS.ValueType.Error)
      problems.push({ cell: cell.address, formula: cell.formula || cell.text });
  });
const byTeam = new Map();
for (const row of records) {
  const group = byTeam.get(row.team) || { team: row.team, people: 0, target: 0 };
  group.people++;
  group.target += row.target;
  byTeam.set(row.team, group);
}
const total = records.reduce((sum, row) => sum + row.target, 0);
if (records.length !== 23 || total !== sheet.getCell("B28").value)
  throw new Error("Roster does not reconcile to the supplied grand total.");
for (const [label, sourceCell] of [
  ["Bahaa's Unit", "B13"],
  ["Asmaa's Unit", "B27"],
]) {
  if (
    records.filter((r) => r.unit === label).reduce((sum, r) => sum + r.target, 0) !==
    sheet.getCell(sourceCell).value
  )
    throw new Error(`Unit total mismatch: ${label}`);
}
const workbook = new ExcelJS.Workbook();
workbook.creator = "Engosoft Insights Hub";
const addRoster = (title, rows) => {
  const target = workbook.addWorksheet(title, { views: [{ state: "frozen", ySplit: 1 }] });
  target.columns = [
    { header: "Month", key: "month", width: 13 },
    { header: "Unit", key: "unit", width: 22 },
    { header: "Team", key: "team", width: 25 },
    { header: "Employee", key: "name", width: 48 },
    { header: "Stable identity", key: "employeeId", width: 40 },
    { header: "Target (USD)", key: "target", width: 18 },
    { header: "Source row (Sheet1)", key: "sourceRow", width: 22 },
  ];
  target.addRows(rows);
  target.autoFilter = { from: "A1", to: `G${rows.length + 1}` };
  target.getColumn("target").numFmt = '$#,##0;($#,##0);"$0"';
};
addRoster("All employees", records);
for (const team of byTeam.keys())
  addRoster(
    team,
    records.filter((r) => r.team === team),
  );
const notes = workbook.addWorksheet("Source and checks");
notes.columns = [
  { header: "Check", width: 36 },
  { header: "Source / result", width: 110 },
];
notes.addRows([
  ["Source file", source],
  ["Source SHA256", hash],
  ["Effective month", "November 2026; year taken from the user's current planning period."],
  ["Scope", "Only Sheet1 A1:D28. Each employee has exactly one existing identity/alias match."],
  ["Source Bahaa unit target (B13)", sheet.getCell("B13").value],
  ["Source Asmaa unit target (B27)", sheet.getCell("B27").value],
  ["Source grand target (B28)", sheet.getCell("B28").value],
  ["Excluded source formula errors", problems.map((r) => r.cell).join(", ")],
  [
    "Original preserved",
    "The input workbook was read only. Broken formulas and incomplete lead-distribution table below row 28 are not imported.",
  ],
  [
    "Blank is not zero",
    "Abdullah's published target is explicitly 0. Staff absent from the supplied plan have no invented November target.",
  ],
  ["Historical scope", "Previous months retain their original quotas and team assignments."],
  [
    "Fields to edit",
    "This is a reviewed export, not an input template. Change quotas via the dashboard editor, keeping their month.",
  ],
]);
for (const page of workbook.worksheets) {
  page.eachRow((row, index) =>
    row.eachCell((cell) => {
      cell.font = {
        name: "Arial",
        size: 11,
        color: { argb: index === 1 ? "FFFFFFFF" : "FF122344" },
        bold: index === 1,
      };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (index === 1)
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF12366A" } };
    }),
  );
  page.getRow(1).height = 30;
}
await workbook.xlsx.writeFile(output);
const after = createHash("sha256")
  .update(await readFile(source))
  .digest("hex");
if (after !== hash) throw new Error("Original unexpectedly changed.");
console.log(
  JSON.stringify({
    month: "2026-11",
    employees: records.length,
    total,
    teams: [...byTeam.values()],
    excludedErrors: problems,
    output,
    originalUnchanged: true,
  }),
);
