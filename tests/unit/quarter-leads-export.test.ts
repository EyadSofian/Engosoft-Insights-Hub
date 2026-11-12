import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuarterLeadReview } from "@/lib/quarter-leads-report";
import { quarterReviewWorkbook } from "@/lib/quarter-leads-export";
import type { QuarterLeadReviewReport } from "@/lib/quarter-leads-report.server";
describe("temporary review workbook", () => {
  it("serializes numeric ratios, missing fields and all three cohorts without formulas errors", async () => {
    const result = buildQuarterLeadReview({
      ads: [
        {
          month: "2026-08",
          course: "CFM",
          platform: "meta",
          campaign: "CFM",
          campaignKey: "id:1",
          account: "Leads",
          objective: "leads",
          spend: 100,
          clicks: 50,
          nativeLeads: 25,
        },
      ],
      leads: [],
      payments: [],
      asOf: "2026-11-12",
      spendCoverage: { "2026-08": true },
      crmReady: true,
      revenueReady: true,
      linksReady: true,
    });
    const report = {
      ...result,
      asOf: "2026-11-12",
      generatedAt: "2026-11-12T10:00:00Z",
      appliedFilters: {},
      spendCoverage: [],
      linksReady: true,
      sources: {},
      sourceSyncs: [],
    } as unknown as QuarterLeadReviewReport;
    const wb = quarterReviewWorkbook(report),
      bytes = await wb.xlsx.writeBuffer(),
      copy = new ExcelJS.Workbook();
    await copy.xlsx.load(bytes);
    expect(copy.worksheets).toHaveLength(6);
    expect(copy.getWorksheet("Months")!.rowCount).toBe(4);
    expect(copy.getWorksheet("Months")!.getCell("F2").value).toEqual({
      formula: 'IF(E2=0,"",D2/E2)',
      result: 4,
    });
    expect(copy.getWorksheet("Months")!.getCell("Y2").value).toEqual({
      formula: 'IF(X2=0,"",D2/X2)',
      result: 2,
    });
    expect(copy.getWorksheet("Months")!.getCell("K2").value).toBeNull();
    if (process.env.QUARTER_REVIEW_OUTPUT)
      await wb.xlsx.writeFile(process.env.QUARTER_REVIEW_OUTPUT);
  });
});
