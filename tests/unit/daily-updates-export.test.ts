import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildDailyUpdates } from "@/lib/daily-updates";
import { createDailyUpdatesWorkbook } from "@/lib/daily-updates-export";
import type { DailyUpdatesReport } from "@/lib/daily-updates.server";
function report(missing = false): DailyUpdatesReport {
  const availability = {
    crm: true,
    lost: !missing,
    revenue: !missing,
    links: true,
    daySpend: !missing,
    monthSpend: !missing,
  };
  return {
    ...buildDailyUpdates({
      day: "2026-11-11",
      availability,
      entries: [1, 2, 3, 4]
        .map((id) => ({
          id: String(id),
          course: "CFM",
          createdAt: "2026-11-11",
          status: id === 4 ? "lost" : "open",
          recordType: "opportunity",
          source: "Facebook",
          segment: "Fresh",
          name: id === 1 ? "=HYPERLINK(1)" : "مثال عربي",
          campaign: "CFM campaign",
          url: "https://example.test/" + id,
        }))
        .concat([
          {
            id: "5",
            course: "PMP",
            createdAt: "2026-11-11",
            status: "open",
            recordType: "opportunity",
            source: "Facebook",
            segment: "Fresh",
            name: "Another",
            campaign: "PMP campaign",
            url: "https://example.test/5",
          },
        ]),
      losses: [
        {
          id: "old",
          course: "CFM",
          date: "2026-11-11",
          recordType: "lead",
          source: "Facebook",
          segment: "",
          name: "Older",
          url: "https://example.test/old",
        },
      ],
      payments: [
        {
          course: "CFM",
          company: "KSA",
          order: "S1",
          leadId: "1",
          date: "2026-11-11",
          invoice: "INV1",
          amount: 50,
        },
        {
          course: "CFM",
          company: "KSA",
          order: "S2",
          leadId: "2",
          date: "2026-11-11",
          invoice: "INV2",
          amount: 50,
        },
      ],
      spend: [
        {
          course: "CFM",
          campaign: "CFM campaign",
          campaignKey: "id:1",
          platform: "meta",
          date: "2026-11-11",
          spend: 20,
          attribution: "campaign_name",
        },
      ],
    }),
    today: "2026-11-11",
    generatedAt: "2026-11-11T10:00:00Z",
    timezone: "Africa/Cairo",
    lossBasis: "crm_lost_date",
    chatterAvailable: false,
    fallbackDateCount: 0,
    unlinkedInvoices: 0,
    excludedSources: ["Recommendation", "WhatsApp Broadcast", "AutoDialer Broadcast"],
    errors: [],
    appliedFilters: { from: "2026-11-01", to: "2026-11-11" },
    sources: {
      crmReadAt: "2026-11-11T10:00:00Z",
      revenueSyncedAt: "2026-11-11T09:55:00Z",
      lostReadAt: "2026-11-11T09:55:00Z",
      linksSyncedAt: "2026-11-11T09:55:00Z",
      adsSyncedAt: "2026-11-11T09:55:00Z",
    },
  } as DailyUpdatesReport;
}
describe("daily updates Excel export", () => {
  it("writes a genuine XLSX with numeric currencies, cached ratio formulas and all detail sheets", async () => {
    const data = report(),
      wb = createDailyUpdatesWorkbook(data);
    const bytes = await wb.xlsx.writeBuffer();
    expect([...new Uint8Array(bytes).slice(0, 2)]).toEqual([80, 75]);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(bytes);
    expect(loaded.worksheets.map((s) => s.name)).toEqual([
      "Courses",
      "Campaigns",
      "CRM records",
      "Lost records",
      "Collections",
      "Report notes",
    ]);
    const s = loaded.getWorksheet("Courses")!;
    expect(s.getCell("D2").value).toBe(4);
    expect(s.getCell("Q2").value).toBe(100);
    expect(s.getCell("L2").value).toEqual({ formula: 'IF(D2=0,"",K2/D2)', result: 0.5 });
    expect(s.getCell("J2").value).toEqual({ formula: 'IF(D2=0,"",I2/D2)', result: 0.25 });
    expect(s.getCell("S2").value).toEqual({ formula: 'IF(O2=0,"",Q2/O2)', result: 5 });
    expect(s.getCell("L2").numFmt).toBe("0.0%");
    expect(loaded.getWorksheet("CRM records")!.getCell("C2").value).toBe("'=HYPERLINK(1)");
    expect(loaded.getWorksheet("Collections")!.getCell("E2").value).toBe(50);
    expect(s.views[0].state).toBe("frozen");
    if (process.env.DAILY_EXPORT_TEST_OUTPUT)
      await wb.xlsx.writeFile(process.env.DAILY_EXPORT_TEST_OUTPUT);
  });
  it("limits course rows and every detail sheet to the locally visible courses", () => {
    const data = report(),
      rows = data.rows.filter((r) => r.course === "PMP");
    const wb = createDailyUpdatesWorkbook(data, rows, "en", "PMP");
    expect(wb.getWorksheet("Courses")!.rowCount).toBe(2);
    expect(wb.getWorksheet("CRM records")!.rowCount).toBe(2);
    expect(wb.getWorksheet("Campaigns")!.rowCount).toBe(1);
    expect(wb.getWorksheet("Collections")!.rowCount).toBe(1);
    expect(wb.getWorksheet("Report notes")!.getCell("B6").value).toBe("PMP");
  });
  it("preserves missing evidence as blank and supports RTL Arabic sheets", () => {
    const data = report(true),
      wb = createDailyUpdatesWorkbook(data, data.rows, "ar");
    const s = wb.getWorksheet("الكورسات")!;
    expect(s.views[0].rightToLeft).toBe(true);
    expect(s.getCell("F2").value).toBeNull();
    expect(s.getCell("Q2").value).toBeNull();
    expect(s.getCell("L2").value).toBeNull();
    expect(s.getCell("S2").value).toBeNull();
    expect(wb.getWorksheet("التحصيل")!.rowCount).toBe(1);
    expect(wb.getWorksheet("اللوست")!.rowCount).toBe(1);
  });
});
