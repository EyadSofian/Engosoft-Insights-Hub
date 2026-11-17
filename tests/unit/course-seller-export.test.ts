import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createCourseSellerWorkbook } from "@/lib/course-seller-export";
import { buildCourseSellerRanking } from "@/lib/course-seller-ranking";

it("exports every seller with guarded formulas and the full-course denominator", async () => {
  const collections = Array.from({ length: 7 }, (_, i) => ({
    course: "BIM",
    salesperson: `Seller ${i + 1}`,
    usdPaid: 2000 - i,
  }));
  const report = buildCourseSellerRanking({
    course: "BIM",
    collections,
    courseCollections: [{ course: "BIM", usdPaid: 20000 }],
    lost: [],
    orders: [],
    crm: [{ id: "1", course: "BIM", salesperson: "Seller 1", isWon: true }],
    period: { from: "2026-11-01", to: "2026-11-17" },
    availability: { crm: true, orders: false, collections: true },
  });
  const workbook = createCourseSellerWorkbook("BIM", report);
  if (process.env.COURSE_SELLER_TEST_XLSX)
    await workbook.xlsx.writeFile(process.env.COURSE_SELLER_TEST_XLSX);
  const copy = new ExcelJS.Workbook();
  await copy.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = copy.worksheets[0];
  expect(sheet.getCell("B3").value).toBe(20000);
  expect(sheet.getCell("B13").value).toBe("Seller 7");
  expect(sheet.getCell("D7").value).toEqual({
    formula: 'IF(AND(ISNUMBER(C7),$B$3>0),C7/$B$3,"")',
    result: 0.1,
  });
  expect(sheet.getCell("H7").result).toBe(1);
  expect(sheet.getCell("H8").formula).toContain("F8>0");
  expect(sheet.getCell("E7").value).toBeNull();
});
