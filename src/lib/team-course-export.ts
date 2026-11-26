import ExcelJS from "exceljs";
import type { GlobalFilters } from "./types";
import type { TeamCourseMatrix } from "./team-course-leads";

export interface TeamCourseExport {
  matrix: TeamCourseMatrix;
  rows: TeamCourseMatrix["rows"];
  filters: GlobalFilters;
  lang: "ar" | "en";
  search: string;
}

const countFor = (row: TeamCourseMatrix["rows"][number], key: string) =>
  Object.hasOwn(row.counts, key) ? row.counts[key] : 0;
const source = "https://engosoft-insights-hub-production.up.railway.app/teams";
const safeText = (value: string) =>
  /^[=+\-@\t\r\n]/.test(value.trimStart()) ? "'" + value : value;
const label = (data: TeamCourseExport, ar: string, en: string) => (data.lang === "ar" ? ar : en);
const owner = (data: TeamCourseExport, row: TeamCourseMatrix["rows"][number]) =>
  row.salesperson ? row.displayName : label(data, "بدون مسؤول حالي", "No current owner");
const courseName = (data: TeamCourseExport, key: string) =>
  key === "غير محدد" ? label(data, key, "Unspecified") : key;

export function createTeamCourseCsv(data: TeamCourseExport): string {
  const { rows, matrix, filters } = data;
  const headers = [
    label(data, "السيلز", "Salesperson"),
    label(data, "الفريق", "Team"),
    label(data, "من", "From"),
    label(data, "إلى", "To"),
    ...matrix.courses.map((col) => courseName(data, col.key)),
    label(data, "الإجمالي", "Total"),
    label(data, "الفلاتر", "Filters"),
    label(data, "البحث", "Search"),
    label(data, "أساس الأعداد", "Count basis"),
  ];
  const allTime = label(data, "كل الفترات", "All time");
  const context = [
    JSON.stringify(filters),
    data.search,
    label(
      data,
      "سجلات CRM حسب تاريخ الدخول والمسؤول الحالي والكورس الرئيسي؛ كل الحالات. ليست عدد مكالمات.",
      "CRM creation cohort, current owner and primary course; all statuses. Not call counts.",
    ),
  ];
  const values: (string | number)[][] = rows.map((row) => [
    owner(data, row),
    row.teams.join(" · "),
    filters.from || (filters.range === "all" ? allTime : ""),
    filters.to || (filters.range === "all" ? allTime : ""),
    ...matrix.courses.map((col) => countFor(row, col.key)),
    row.total,
    ...context,
  ]);
  values.push([
    label(data, "إجمالي الصفوف المعروضة", "Visible row totals"),
    "",
    filters.from || (filters.range === "all" ? allTime : ""),
    filters.to || (filters.range === "all" ? allTime : ""),
    ...matrix.courses.map((col) => rows.reduce((sum, row) => sum + countFor(row, col.key), 0)),
    rows.reduce((sum, row) => sum + row.total, 0),
    ...context,
  ]);
  const escape = (value: string | number) => {
    const text = typeof value === "number" ? String(value) : safeText(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return "\uFEFF" + [headers, ...values].map((row) => row.map(escape).join(",")).join("\r\n");
}

/** Export the loaded, searched table, not a second independent source read. */
export function createTeamCourseWorkbook(data: TeamCourseExport) {
  const { rows, matrix, filters } = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Engosoft Insights Hub";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const sheet = wb.addWorksheet(label(data, "ليدز السيلز والكورسات", "Salesperson course leads"), {
    views: [{ state: "frozen", xSplit: 2, ySplit: 7, rightToLeft: data.lang === "ar" }],
  });
  const totalColumn = matrix.courses.length + 3;
  sheet.mergeCells(1, 1, 1, totalColumn);
  sheet.getCell("A1").value = label(data, "ليدز كل سيلز حسب الكورس", "Salespeople × course leads");
  sheet.getCell("A2").value = label(data, "الفترة", "Period");
  sheet.getCell("B2").value =
    filters.range === "all"
      ? label(data, "كل الفترات", "All time")
      : `${filters.from || "…"} → ${filters.to || "…"}`;
  sheet.getCell("A3").value = label(data, "البحث", "Search");
  sheet.getCell("B3").value = safeText(data.search);
  sheet.getCell("A4").value = label(data, "المصدر", "Source");
  sheet.getCell("B4").value = { text: "Engosoft · Odoo CRM", hyperlink: source };
  sheet.getCell("A5").value = label(data, "أساس الأعداد", "Count basis");
  sheet.mergeCells(5, 2, 5, totalColumn);
  sheet.getCell("B5").value = label(
    data,
    "تاريخ إنشاء الليد، المسؤول الحالي والكورس الرئيسي؛ كل الحالات، ومنها Won وLost. ليست أعداد مكالمات ولا عملاء فريدين بالهاتف.",
    "Creation-date cohort, current owner and primary course; all statuses including Won and Lost. Not call counts or unique phone identities.",
  );
  sheet.getRow(7).values = [
    label(data, "السيلز", "Salesperson"),
    label(data, "الفريق", "Team"),
    ...matrix.courses.map((col) => courseName(data, col.key)),
    label(data, "الإجمالي", "Total"),
  ];
  sheet.getColumn(1).width = 38;
  sheet.getColumn(2).width = 32;
  for (let col = 3; col <= totalColumn; col++) {
    sheet.getColumn(col).width = 18;
    sheet.getColumn(col).numFmt = "#,##0";
  }
  const firstCourse = sheet.getColumn(3).letter;
  const lastCourse = sheet.getColumn(Math.max(3, totalColumn - 1)).letter;
  for (const row of rows) {
    const entry = sheet.addRow([
      owner(data, row),
      row.teams.join(" · "),
      ...matrix.courses.map((col) => countFor(row, col.key)),
      null,
    ]);
    entry.getCell(totalColumn).value = {
      formula: matrix.courses.length
        ? `SUM(${firstCourse}${entry.number}:${lastCourse}${entry.number})`
        : "SUM(0)",
      result: row.total,
    };
  }
  const lastDataRow = sheet.rowCount;
  const totals = sheet.addRow([label(data, "إجمالي الصفوف المعروضة", "Visible row totals")]);
  for (let col = 3; col <= totalColumn; col++) {
    const letter = sheet.getColumn(col).letter;
    totals.getCell(col).value = {
      formula: rows.length ? `SUBTOTAL(109,${letter}8:${letter}${lastDataRow})` : "SUM(0)",
      result: rows.reduce(
        (sum, row) =>
          sum + (col === totalColumn ? row.total : countFor(row, matrix.courses[col - 3].key)),
        0,
      ),
    };
  }
  sheet.autoFilter = {
    from: { row: 7, column: 1 },
    to: { row: Math.max(lastDataRow, 7), column: totalColumn },
  };
  sheet.eachRow((row, n) => {
    row.height = n === 5 ? 42 : n === 1 || n === 7 ? 34 : 28;
    row.eachCell({ includeEmpty: true }, (cell) => {
      const header = n === 1 || n === 7;
      cell.font = {
        name: "Arial",
        size: n === 1 ? 15 : 11,
        bold: header || n === totals.number,
        color: { argb: header ? "FFFFFFFF" : "FF132B50" },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal:
          Number(cell.col) >= 3 && n >= 7 ? "center" : data.lang === "ar" ? "right" : "left",
        wrapText: true,
      };
      if (header || n === totals.number || (n >= 8 && n % 2 === 0))
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: header ? "FF12316A" : "FFF0F5FF" },
        };
    });
  });
  const notes = wb.addWorksheet(label(data, "الفترة والفلاتر", "Period and filters"), {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: data.lang === "ar" }],
  });
  notes.columns = [
    { header: label(data, "البند", "Item"), width: 35 },
    { header: label(data, "القيمة", "Value"), width: 100 },
  ];
  notes.addRows([
    ["Source", source],
    ["Exported at (UTC)", wb.created.toISOString()],
    ["Search", data.search],
    ["Visible rows", rows.length],
    ["All-scope CRM records (before search)", matrix.total],
    ...Object.entries(filters)
      .filter(([, value]) => value)
      .map(([key, value]) => [key, String(value)]),
    [
      "Scope",
      label(
        data,
        "نفس الصفوف الظاهرة بالجدول بعد البحث، وبنفس فلاتر الصفحة. التكرار المسجل لا يُحذف تلقائيًا.",
        "Same visible table rows after search and the same page filters. Recorded duplicates are not silently removed.",
      ),
    ],
    [
      "Owner",
      label(
        data,
        "غياب المسؤول الحالي لا يثبت عدم التوزيع أو عدم الاتصال.",
        "Missing current owner does not prove never assigned or never contacted.",
      ),
    ],
    [
      "Formulas",
      label(
        data,
        "الأعداد لقطة من CRM. إجماليات الصفوف SUM وإجماليات الأعمدة SUBTOTAL؛ تتغير عند تعديل الأعداد أو فلترة الصفوف داخل Excel.",
        "Counts are CRM snapshots. Row totals use SUM and footer totals use SUBTOTAL, recalculating when counts are edited or Excel rows are filtered.",
      ),
    ],
  ]);
  notes.eachRow((row, n) => {
    row.height = n === 1 ? 30 : 40;
    row.eachCell((cell) => {
      cell.font = { name: "Arial", size: 11, bold: n === 1 };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (n === 1) {
        cell.font.color = { argb: "FFFFFFFF" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF12316A" } };
      }
    });
  });
  return wb;
}

export async function downloadTeamCourseExport(data: TeamCourseExport, format: "csv" | "xlsx") {
  const bytes =
    format === "csv"
      ? createTeamCourseCsv(data)
      : new Uint8Array(await createTeamCourseWorkbook(data).xlsx.writeBuffer());
  const blob = new Blob([bytes], {
    type:
      format === "csv"
        ? "text/csv;charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Engosoft-Sales-Course-Leads-${data.filters.from || "all"}-${data.filters.to || "all"}.${format}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
