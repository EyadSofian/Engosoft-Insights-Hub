import { createFileRoute } from "@tanstack/react-router";

/**
 * The six-month lead-to-paid report as a workbook.
 *
 * A management review of lead quality and sales follow-up ends in a meeting,
 * and a figure that cannot leave the screen does not survive one. This serves
 * exactly what `/api/lead-performance` computed — it re-reads nothing and
 * recalculates nothing, so the workbook and the page can never disagree.
 *
 * Every sheet carries the same availability caveats the page shows. An export
 * that silently drops "calls could not be verified" turns a withheld figure
 * into an apparent zero the moment it is pasted into a slide.
 */
export const Route = createFileRoute("/api/lead-performance-export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json } = await import("@/lib/api.server");
        const { loadLeadPerformanceReport } = await import("@/lib/lead-performance.server");
        const { default: ExcelJS } = await import("exceljs");

        const params = new URL(request.url).searchParams;
        const ar = params.get("lang") !== "en";
        const report = await loadLeadPerformanceReport({
          month: params.get("month") ?? undefined,
          course: params.get("course") ?? undefined,
        });
        if ("error" in report) return json(report, report.status);

        const { result, collectionsByMonth, availability } = report;
        const dash = "—";
        const num = (value: number | null | undefined) =>
          value === null || value === undefined ? dash : value;
        const paidReady = result.coverage.linksAvailable && availability.accounting;
        const paid = (value: number) => (paidReady ? value : dash);
        const safe = (value: string) =>
          ["=", "+", "-", "@"].includes(value.trimStart().charAt(0)) ? `'${value}` : value;

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Engosoft Insights Hub";
        workbook.created = new Date();

        const months = workbook.addWorksheet(ar ? "الشهور" : "Months");
        months.addRow([
          ar ? "شهر الدخول" : "Entry month",
          ar ? "سجلات جديدة" : "New records",
          ar ? "تكرار داخل الشهر" : "Duplicate same month",
          ar ? "تكرار من شهر سابق" : "Duplicate prior month",
          ar ? "تكرار مؤكد في أودو" : "Confirmed Odoo duplicate",
          ar ? "نسبة التكرار %" : "Duplicate rate %",
          ar ? "غير مؤهل" : "Unqualified",
          ar ? "لا يرد" : "No answer",
          ar ? "تعذر الوصول" : "Unreachable",
          ar ? "غير مهتم" : "Not interested",
          ar ? "مفقود" : "Lost",
          ar ? "نسبة الفقدان %" : "Lost rate %",
          ar ? "تم التواصل (PBX)" : "Contacted (PBX)",
          ar ? "متوسط المحاولات" : "Average attempts",
          ar ? "ساعات لأول محاولة" : "Hours to first attempt",
          ar ? "ليدز مدفوعة مثبتة" : "Verified paid leads",
          ar ? "دُفعت في شهر لاحق" : "Paid in a later month",
          ar ? "نسبة التحويل المدفوع %" : "Paid conversion %",
          ar ? "أوامر مدفوعة" : "Paid orders",
          ar ? "صافي التحصيل USD" : "Net collected USD",
          ar ? "فواتير مدفوعة بتاريخ الدفع" : "Invoices by payment date",
          ar ? "تحصيل بتاريخ الدفع USD" : "Collections by payment date USD",
        ]);
        for (const row of result.rows) {
          const collections = collectionsByMonth.find((item) => item.month === row.name);
          const duplicates = row.duplicateSameMonth + row.duplicateEarlierMonth;
          months.addRow([
            row.name,
            row.leads,
            row.duplicateSameMonth,
            row.duplicateEarlierMonth,
            row.confirmedDuplicate,
            row.leads ? Math.round((duplicates / row.leads) * 1000) / 10 : dash,
            row.unqualified,
            row.noAnswer,
            row.unreachable,
            row.noInterest,
            row.lost,
            num(row.lostRate),
            num(row.contacted),
            num(row.averageAttempts),
            num(row.averageHoursToFirstCall ?? null),
            paid(row.paidLeads),
            paid(row.paidLater),
            paidReady ? num(row.conversionRate) : dash,
            paid(row.paidOrders),
            paid(row.paidRevenue),
            availability.accounting ? (collections?.paidInvoices ?? dash) : dash,
            availability.accounting ? (collections?.paidUsd ?? dash) : dash,
          ]);
        }

        const funnel = workbook.addWorksheet(ar ? "مسار التحويل" : "Funnel");
        const stageLabel: Record<string, { ar: string; en: string }> = {
          entered: { ar: "دخلت الـCRM", en: "Entered CRM" },
          contacted: { ar: "تم التواصل معها (PBX)", en: "Contacted (PBX)" },
          opportunity: { ar: "مصنّفة فرصة الآن", en: "Currently an opportunity" },
          paid: { ar: "تسجيل مدفوع مثبت", en: "Verified paid enrollment" },
        };
        funnel.addRow([
          ar ? "المرحلة" : "Stage",
          ar ? "العدد" : "Count",
          ar ? "من إجمالي الدخول %" : "Share of entries %",
          ar ? "من المرحلة السابقة %" : "Step conversion %",
          ar ? "مثبت بدليل؟" : "Evidence-backed?",
        ]);
        for (const stage of result.stages) {
          funnel.addRow([
            stageLabel[stage.key]![ar ? "ar" : "en"],
            num(stage.count),
            num(stage.shareOfEntries),
            num(stage.stepRate),
            stage.evidenced
              ? ar
                ? "نعم"
                : "Yes"
              : ar
                ? "مؤشر حالة حالية"
                : "Current-status proxy",
          ]);
        }

        const dimensions: [string, typeof result.byCourse][] = [
          [ar ? "الكورس" : "Course", result.byCourse],
          [ar ? "المصدر" : "Source", result.bySource],
          [ar ? "الحملة" : "Campaign", result.byCampaign],
          [ar ? "الميديا باير" : "Media buyer", result.byMediaBuyer],
          [ar ? "مسؤول الليد" : "Lead owner", result.bySalesOwner],
          [ar ? "السيلز المغلق" : "Paid closer", paidReady ? result.bySalesCloser : []],
        ];
        for (const [label, rows] of dimensions) {
          const sheet = workbook.addWorksheet(label.slice(0, 31));
          sheet.addRow([
            label,
            ar ? "ليدز" : "Leads",
            ar ? "تكرار محتمل" : "Potential duplicates",
            ar ? "غير مؤهل" : "Unqualified",
            ar ? "لا يرد" : "No answer",
            ar ? "تعذر الوصول" : "Unreachable",
            ar ? "غير مهتم" : "Not interested",
            ar ? "مفقود" : "Lost",
            ar ? "نسبة الفقدان %" : "Lost rate %",
            ar ? "تم التواصل (PBX)" : "Contacted (PBX)",
            ar ? "متوسط المحاولات" : "Average attempts",
            ar ? "ساعات لأول محاولة" : "Hours to first attempt",
            ar ? "ليدز مدفوعة" : "Paid leads",
            ar ? "نسبة التحويل %" : "Conversion %",
            ar ? "أوامر مدفوعة" : "Paid orders",
            ar ? "صافي USD" : "Net USD",
          ]);
          for (const row of rows) {
            sheet.addRow([
              safe(row.name),
              row.leads,
              row.duplicateSameMonth + row.duplicateEarlierMonth,
              row.unqualified,
              row.noAnswer,
              row.unreachable,
              row.noInterest,
              row.lost,
              num(row.lostRate),
              num(row.contacted),
              num(row.averageAttempts),
              num(row.averageHoursToFirstCall ?? null),
              paid(row.paidLeads),
              paidReady ? num(row.conversionRate) : dash,
              paid(row.paidOrders),
              paid(row.paidRevenue),
            ]);
          }
        }

        const reasons = workbook.addWorksheet(ar ? "أسباب الفقدان" : "Loss reasons");
        reasons.addRow([
          ar ? "السبب" : "Reason",
          ar ? "العدد" : "Count",
          ar ? "من المفقود %" : "Share of lost %",
        ]);
        for (const reason of result.lossReasons) {
          reasons.addRow([
            safe(ar ? reason.ar : reason.en),
            reason.count,
            result.selected.lost
              ? Math.round((reason.count / result.selected.lost) * 1000) / 10
              : dash,
          ]);
        }
        reasons.addRow([]);
        reasons.addRow([ar ? "سبب عدم التأهل" : "Unqualified reason", ar ? "العدد" : "Count"]);
        const categoryLabel: Record<string, { ar: string; en: string }> = {
          customer_data: { ar: "بيانات العميل", en: "Customer data" },
          course_fit: { ar: "ملاءمة الكورس", en: "Course fit" },
          unspecified: { ar: "سبب غير محدد", en: "Unspecified" },
        };
        for (const row of result.unqualifiedReasons)
          reasons.addRow([categoryLabel[row.category]![ar ? "ar" : "en"], row.count]);

        const notes = workbook.addWorksheet(ar ? "التعريفات والحدود" : "Definitions and limits");
        notes.addRow([ar ? "البند" : "Item", ar ? "القيمة" : "Value"]);
        const lines: [string, string][] = [
          [ar ? "الفترة" : "Window", `${result.months[0]} → ${result.asOf}`],
          [ar ? "الشهر المختار" : "Selected month", result.selectedMonth],
          [ar ? "فلتر الكورس" : "Course filter", params.get("course") || (ar ? "الكل" : "All")],
          [ar ? "مزامنة CRM" : "CRM synced at", availability.crmSyncedAt],
          [ar ? "مزامنة Lost" : "Lost synced at", availability.lostSyncedAt],
          [ar ? "مزامنة الحسابات" : "Accounting synced at", availability.accountingSyncedAt],
          [
            ar ? "ربط أوامر البيع متاح" : "Sale-order links available",
            result.coverage.linksAvailable ? (ar ? "نعم" : "Yes") : ar ? "لا" : "No",
          ],
          [
            ar ? "تغطية مكالمات Yeastar كاملة" : "Yeastar call coverage complete",
            result.coverage.callsAvailable ? (ar ? "نعم" : "Yes") : ar ? "لا" : "No",
          ],
          [
            ar ? "مراجعات جودة يدوية في المجموعة" : "Manual QA reviews in cohort",
            `${result.coverage.qaReviewed} / ${result.selected.leads}`,
          ],
          [
            ar ? "بنود مالية غير مربوطة" : "Unlinked accounting lines",
            String(result.coverage.unlinkedAccountingLines),
          ],
          [
            ar ? "مستبعد: توصية" : "Excluded: recommendation",
            String(result.coverage.excludedRecommendation),
          ],
          [
            ar ? "مستبعد: برودكاست واتساب" : "Excluded: WhatsApp broadcast",
            String(result.coverage.excludedBroadcast),
          ],
          [
            ar ? "تعريف التحويل" : "Conversion definition",
            ar
              ? "أمر بيع مرتبط بالفرصة ارتباطًا مباشرًا وصافي فواتيره المدفوعة موجب بعد الخصم. Won في الـCRM لا يُحتسب."
              : "An exactly opportunity-linked sale order with positive net paid invoices after credit notes. CRM Won alone never counts.",
          ],
          [
            ar ? "تعريف التكرار" : "Duplicate definition",
            ar
              ? "تكرار هوية هاتف أو بريد؛ مؤشر للمراجعة وليس حكمًا. المؤكد هو سبب Duplicate في أودو."
              : "A repeated phone or email identity — a review signal, not a verdict. Confirmed uses the Odoo duplicate reason.",
          ],
        ];
        for (const [item, value] of lines) if (value) notes.addRow([item, safe(value)]);

        for (const sheet of workbook.worksheets) {
          sheet.views = [{ state: "frozen", ySplit: 1, rightToLeft: ar }];
          sheet.getRow(1).height = 30;
          sheet.getRow(1).eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2B5B" } };
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          });
          sheet.getColumn(1).width = 32;
          for (let col = 2; col <= sheet.columnCount; col++) sheet.getColumn(col).width = 18;
        }

        const bytes = await workbook.xlsx.writeBuffer();
        return new Response(new Uint8Array(bytes), {
          headers: {
            "cache-control": "no-store",
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="engosoft-lead-to-paid-${result.selectedMonth}.xlsx"`,
          },
        });
      },
    },
  },
});
