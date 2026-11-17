import ExcelJS from "exceljs";
import type { CourseSellerRanking } from "./course-seller-ranking";

export function createCourseSellerWorkbook(
  course: string,
  report: CourseSellerRanking,
  lang: "ar" | "en" = "en",
) {
  const en = lang === "en";
  const t = (ar: string, english: string) => (en ? english : ar);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Engosoft Insights Hub";
  wb.calcProperties.fullCalcOnLoad = true;
  const sheet = wb.addWorksheet(t("ترتيب البياعين", "Salesperson ranking"), {
    views: [{ state: "frozen", ySplit: 6, rightToLeft: !en }],
  });
  const money = '"$"#,##0.00;("$"#,##0.00);"-"';
  sheet.mergeCells("A1:H1");
  sheet.getCell("A1").value = `${t("ترتيب البياعين", "Salesperson ranking")} · ${course}`;
  sheet.getRow(1).height = 28;
  sheet.getCell("A2").value = t("الفترة", "Period");
  sheet.getCell("B2").value =
    report.period?.from || report.period?.to
      ? `${report.period?.from ?? "…"} → ${report.period?.to ?? "…"}`
      : t("كل الفترة", "All time");
  sheet.getCell("A3").value = t("صافي تحصيل الكورس", "Course net collected");
  sheet.getCell("B3").value = report.totalCollected;
  sheet.getCell("B3").numFmt = money;
  sheet.getCell("A4").value = t("المصدر", "Source");
  sheet.getCell("B4").value =
    "Engosoft · Odoo Accounting / CRM / Full Invoiced Orders (count only)";
  sheet.getRow(6).values = en
    ? [
        "Rank",
        "Salesperson",
        "Net collected (USD)",
        "Share of course collections",
        "Sales orders",
        "CRM leads",
        "Won",
        "Win rate (Won ÷ CRM leads)",
      ]
    : [
        "الترتيب",
        "البياع",
        "صافي التحصيل (USD)",
        "حصة من تحصيل الكورس",
        "أوامر البيع",
        "الليدز",
        "Won",
        "Win rate (Won ÷ الليدز)",
      ];
  sheet.getRow(6).height = 32;
  [22, 44, 23, 27, 15, 15, 12, 27].forEach((width, i) => (sheet.getColumn(i + 1).width = width));
  for (const r of report.rows) {
    const row = sheet.addRow([
      r.rank,
      r.name || t("غير منسوب لبياع", "Unassigned"),
      r.collected,
      null,
      r.orders,
      r.leads,
      r.won,
      null,
    ]);
    const n = row.number;
    row.getCell(3).numFmt = money;
    for (const [col, formula, value] of [
      [4, `IF(AND(ISNUMBER(C${n}),$B$3>0),C${n}/$B$3,"")`, r.collectionShare],
      [8, `IF(AND(ISNUMBER(G${n}),F${n}>0),G${n}/F${n},"")`, r.winRate],
    ] as const) {
      row.getCell(col).numFmt = "0.0%";
      row.getCell(col).value = { formula, result: value === null ? "" : value / 100 };
    }
  }
  sheet.autoFilter = { from: "A6", to: `H${sheet.rowCount}` };
  const notes = [
    t(
      "حصة التحصيل: تحصيل البياع ÷ إجمالي تحصيل الكورس لكل البياعين ضمن نفس نطاق الفترة والفلاتر الأخرى.",
      "Collection share: seller net collected ÷ the course net total across all sellers in the same period and other filters.",
    ),
    t(
      "Win rate: السجلات التي حالتها Won الآن ÷ سجلات CRM الداخلة في الفترة لنفس البياع الحالي والكورس. لا يدل على الدفع.",
      "Win rate: currently Won ÷ CRM records created in the period for the same course and current owner. It is not a paid conversion rate.",
    ),
    t(
      "الترتيب حسب صافي التحصيل الموجب فقط. عدد الأوامر للمعلومة، وليس أساس الترتيب. الخانة الفارغة تعني عدم التوفر أو عدم وجود مقام صالح.",
      "Rank uses positive net collections only. Order count is informational. Blanks denote unavailable inputs or a missing/invalid denominator.",
    ),
  ];
  for (const note of notes) {
    const row = sheet.addRow([note]);
    sheet.mergeCells(row.number, 1, row.number, 8);
    row.height = 22;
  }
  sheet.eachRow((row, n) => {
    row.eachCell({ includeEmpty: n === 6 }, (cell) => {
      const header = n === 1 || n === 6;
      cell.font = {
        name: "Arial",
        size: n === 1 ? 15 : 11,
        bold: header,
        color: { argb: header ? "FFFFFFFF" : "FF182E50" },
      };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (header || (n >= 7 && n <= 6 + report.rows.length && n % 2 === 0)) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: header ? "FF142E60" : "FFF1F5FD" },
        };
      }
    });
    if (n >= 7 && n <= 6 + report.rows.length) row.height = 22;
  });
  return wb;
}

export async function downloadCourseSellerExcel(
  course: string,
  report: CourseSellerRanking,
  lang: "ar" | "en",
) {
  const bytes = await createCourseSellerWorkbook(course, report, lang).xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  const name = course.replace(/[^\p{L}\p{N}_.-]+/gu, "-").slice(0, 70) || "course";
  link.download = `Engosoft-${name}-Seller-Ranking.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
