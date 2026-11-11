import ExcelJS from "exceljs";
import { dailyCourseKey } from "./daily-updates";
import type { DailyUpdatesReport } from "./daily-updates.server";

/** A point-in-time export of the loaded page, never a second independent data read. */
export function createDailyUpdatesWorkbook(
  report: DailyUpdatesReport,
  visibleRows = report.rows,
  lang: "ar" | "en" = "en",
  search = "",
) {
  const ar = lang === "ar";
  const t = (arabic: string, english: string) => (ar ? arabic : english);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Engosoft Insights Hub";
  wb.created = new Date(report.generatedAt);
  wb.calcProperties.fullCalcOnLoad = true;
  const visible = new Set(visibleRows.map((row) => row.key));
  const inScope = (r: { course: string }) => visible.has(dailyCourseKey(r.course));
  const money = "$#,##0.00;($#,##0.00);$0.00";
  const count = "#,##0";
  const pct = "0.0%";
  const multiple = '0.00"x"';
  const safe = (value: string | number | null | undefined) =>
    typeof value === "string" && /^[=+\-@\t\r]/.test(value.trimStart())
      ? "'" + value
      : (value ?? null);
  const sheet = (
    name: string,
    headers: string[],
    rows: (string | number | null | undefined)[][],
  ) => {
    const s = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, rightToLeft: ar }] });
    s.addRow(headers);
    rows.forEach((row) => s.addRow(row.map(safe)));
    s.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(s.rowCount, 1), column: headers.length },
    };
    s.eachRow((row, index) => {
      row.height = index === 1 ? 44 : 26;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = {
          name: "Arial",
          size: 11,
          color: { argb: index === 1 ? "FFFFFFFF" : "FF0B2B5B" },
          bold: index === 1,
        };
        cell.alignment = { vertical: "middle", horizontal: ar ? "right" : "left", wrapText: true };
        if (index === 1 || index % 2 === 0)
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: index === 1 ? "FF0B2B5B" : "FFF2F6FC" },
          };
      });
    });
    s.columns.forEach((col, index) => {
      col.width = index === 0 ? 28 : 22;
    });
    return s;
  };
  const courses = sheet(
    t("الكورسات", "Courses"),
    [
      t("الكورس", "Course"),
      t("اليوم", "Day"),
      t("بداية الشهر", "Month from"),
      t("ليدز اليوم", "Day entries"),
      t("ليدز الشهر", "MTD entries"),
      t("Lost بتاريخ اليوم", "Lost dated in day"),
      t("Lost Leads اليوم", "Day Lost Leads"),
      t("Lost Opportunities اليوم", "Day Lost Opportunities"),
      t("Lost من دخول اليوم", "Current Lost of day entries"),
      t("نسبة Lost من دخول اليوم", "Day-entry Lost rate"),
      t("دفع مثبت من دخول اليوم", "Paid day-entry cohort"),
      t("تحويل اليوم لدفع - حد أدنى", "Day paid conversion - minimum"),
      t("دفع مثبت من دخول الشهر", "Paid MTD-entry cohort"),
      t("تحويل الشهر لدفع - حد أدنى", "MTD paid conversion - minimum"),
      t("صرف اليوم USD", "Day spend USD"),
      t("صرف الشهر USD", "MTD spend USD"),
      t("تحصيل اليوم USD", "Day collections USD"),
      t("تحصيل الشهر USD", "MTD collections USD"),
      t("ROAS اليوم", "Day ROAS"),
      t("ROAS الشهر", "MTD ROAS"),
      t("فواتير اليوم", "Day invoices"),
      t("عدد الحملات", "Campaign count"),
    ],
    visibleRows.map((r) => [
      r.course,
      report.day,
      report.monthFrom,
      r.leadsDay,
      r.leadsMonth,
      r.lostDay,
      r.lostLeadsDay,
      r.lostOpportunitiesDay,
      r.cohortLostDay,
      r.cohortLostRate,
      r.paidDayCohort,
      r.conversionDay,
      r.paidMonthCohort,
      r.conversionMonth,
      r.spendDay,
      r.spendMonth,
      r.revenueDay,
      r.revenueMonth,
      r.roasDay,
      r.roasMonth,
      r.invoicesDay,
      r.campaigns.length,
    ]),
  );
  visibleRows.forEach((r, index) => {
    const n = index + 2;
    for (const [col, formula, result] of [
      ["J", `IF(D${n}=0,"",I${n}/D${n})`, r.cohortLostRate],
      ["L", `IF(D${n}=0,"",K${n}/D${n})`, r.conversionDay],
      ["N", `IF(E${n}=0,"",M${n}/E${n})`, r.conversionMonth],
      ["S", `IF(O${n}=0,"",Q${n}/O${n})`, r.roasDay],
      ["T", `IF(P${n}=0,"",R${n}/P${n})`, r.roasMonth],
    ] as const) {
      // Missing evidence stays blank. An observed zero remains numeric zero.
      const cell = courses.getCell(col + n);
      if (result !== null) cell.value = { formula, result };
      else {
        cell.value = null;
        cell.note = t(
          "غير متاح أو المقام صفر؛ ليس صفرًا مفترضًا.",
          "Unavailable or denominator zero; not an assumed zero.",
        );
      }
      cell.numFmt = col === "S" || col === "T" ? multiple : pct;
    }
  });
  for (const col of ["D", "E", "F", "G", "H", "I", "K", "M", "U", "V"])
    courses.getColumn(col).numFmt = count;
  for (const col of ["O", "P", "Q", "R"]) courses.getColumn(col).numFmt = money;

  const campaigns = sheet(
    t("الحملات", "Campaigns"),
    [
      t("الكورس", "Course"),
      t("الحملة", "Campaign"),
      t("مفتاح الحملة", "Campaign key"),
      t("المنصات", "Platforms"),
      t("صرف اليوم USD", "Day spend USD"),
      t("صرف الشهر USD", "MTD spend USD"),
      t("ليدز اليوم المسندة", "Attributed day entries"),
      t("أساس إسناد الكورس", "Course attribution basis"),
    ],
    visibleRows.flatMap((r) =>
      r.campaigns.map((c) => [
        r.course,
        c.name,
        c.key,
        c.platforms.join(" · "),
        c.spendDay,
        c.spendMonth,
        c.leadsDay,
        c.attribution.join(" · "),
      ]),
    ),
  );
  campaigns.getColumn(2).width = 55;
  campaigns.getColumn(5).numFmt = money;
  campaigns.getColumn(6).numFmt = money;
  campaigns.getColumn(7).numFmt = count;
  const paid = new Set(report.details.paid.map((r) => r.id));
  const status = (s: string) =>
    ar ? { lead: "ليد", open: "مفتوح", won: "ناجح", lost: "مفقود" }[s] || s : s;
  sheet(
    t("سجلات CRM", "CRM records"),
    [
      t("الكورس", "Course"),
      t("معرف السجل", "Record ID"),
      t("الاسم", "Name"),
      t("تاريخ الدخول", "Created date"),
      t("نوع السجل الحالي", "Current record type"),
      t("الحالة الحالية", "Current status"),
      t("المصدر", "Source"),
      "Lead Segment",
      t("الحملة", "Campaign"),
      t("دفع مثبت", "Evidenced payment"),
      t("رابط Odoo", "Odoo link"),
    ],
    report.details.leads
      .filter(inScope)
      .map((r) => [
        r.course,
        r.id,
        r.name,
        r.createdAt,
        ar ? (r.recordType === "lead" ? "ليد" : "فرصة بيعية") : r.recordType,
        status(r.status),
        r.source,
        r.segment,
        r.campaign,
        report.availability.links && report.availability.revenue
          ? paid.has(r.id)
            ? t("نعم", "Yes")
            : t("لا - غير مثبت", "No - not evidenced")
          : t("غير متاح", "Unavailable"),
        r.url,
      ]),
  );
  sheet(
    t("اللوست", "Lost records"),
    [
      t("الكورس", "Course"),
      t("معرف السجل", "Record ID"),
      t("الاسم", "Name"),
      t("تاريخ الخسارة", "Lost date"),
      t("نوع السجل", "Record type"),
      t("المصدر", "Source"),
      "Lead Segment",
      t("رابط Odoo", "Odoo link"),
    ],
    report.availability.lost
      ? report.details.lost
          .filter(inScope)
          .map((r) => [
            r.course,
            r.id,
            r.name,
            r.date,
            ar ? (r.recordType === "lead" ? "ليد" : "فرصة بيعية") : r.recordType,
            r.source,
            r.segment,
            r.url,
          ])
      : [],
  );
  const collections = sheet(
    t("التحصيل", "Collections"),
    [
      t("الكورس", "Course"),
      t("الفاتورة", "Invoice"),
      t("الشركة", "Company"),
      t("تاريخ التقرير المالي", "Financial reporting date"),
      t("قيمة البند USD", "Line value USD"),
    ],
    report.availability.revenue
      ? report.details.invoices
          .filter(inScope)
          .map((r) => [r.course, r.invoice, r.company, r.date, r.amount])
      : [],
  );
  collections.getColumn(5).numFmt = money;
  const metadata: (string | number | null)[][] = [
    [
      t("مصدر الملف", "Report source"),
      "https://engosoft-insights-hub-production.up.railway.app/daily-updates",
    ],
    [t("اليوم المختار - القاهرة", "Selected day - Cairo"), report.day],
    [t("بداية الشهر", "Month from"), report.monthFrom],
    [t("قراءة البيانات", "Data read at"), report.generatedAt],
    [t("نص البحث المحلي", "Local course search"), search],
    [t("الكورسات المصدرة", "Exported courses"), visibleRows.map((r) => r.course).join(" · ")],
    [
      t("القيم الفارغة", "Blank cells"),
      t(
        "تعني غير متاح أو مقام صفر، وليست صفرًا محسوبًا. الصفر الرقمي نتيجة مرصودة.",
        "Unavailable or denominator zero, not an assumed zero. Numeric zero is an observed result.",
      ),
    ],
    [
      t("تعريف الصفوف", "Row definitions"),
      t(
        "سجلات CRM للدخول من أول الشهر إلى اليوم. سجلات Lost بتاريخ اليوم فقط. التحصيل بنود فواتير وليس عدد تسجيلات.",
        "CRM records are month-to-date creation entries. Lost records are day-dated current-Lost records only. Collections are invoice lines, not registrations.",
      ),
    ],
    [
      t("نسب التحويل", "Conversion rates"),
      t(
        "دفع موجب مربوط بمعرف Opportunity لنفس مجموعة الدخول والكورس؛ حد أدنى موثق لا يعتمد على عدد الفواتير أو Won فقط.",
        "Net-positive payments linked to exact Opportunity IDs for the same course and entry cohort; an evidenced minimum, not invoice counts or Won alone.",
      ),
    ],
    [t("مصدر Lost", "Lost basis"), report.lossBasis],
    [
      t("تفاصيل تعريف Lost", "Lost definition"),
      t(
        "نفس تقرير Lost بتاريخ الخسارة وحالتها الحالية؛ ليس كل انتقالات Chatter أو العملاء الذين أُعيد فتحهم.",
        "Same current-Lost close-date population as the Lost workspace; not all Chatter transitions or reopened records.",
      ),
    ],
    [
      t("تتبّع Chatter متاح", "Chatter tracking available"),
      report.chatterAvailable ? t("نعم", "Yes") : t("لا", "No"),
    ],
    [t("عدد تواريخ Lost البديلة", "Lost fallback-date count"), report.fallbackDateCount],
    [
      t("الفواتير غير المرتبطة - نطاق التقرير الكامل", "Unlinked invoices - full report scope"),
      report.unlinkedInvoices,
    ],
    [
      t("استبعاد من الليدز فقط", "Excluded from lead counts only"),
      report.excludedSources.join(" · "),
    ],
    [
      t("ROAS", "ROAS"),
      t(
        "تحصيل الفترة ÷ صرفها؛ ليس إثباتًا سببيًا. صرف الكورس بنفس إسناد الداشبورد، ويوم الإعلان حسب تاريخ مصدر المنصة.",
        "Period collections ÷ spend, not causal attribution. Course spend follows dashboard attribution; ad days follow platform source dates.",
      ),
    ],
    [t("الفلاتر الفعلية", "Applied filters"), JSON.stringify(report.appliedFilters)],
    [t("حالة المصادر", "Source availability"), JSON.stringify(report.availability)],
    [t("أخطاء المصادر", "Source errors"), report.errors.join(" · ")],
    ...Object.entries(report.sources).map(([key, value]) => [key, value]),
    [
      t("المعادلات والمدخلات", "Formulas and source inputs"),
      t(
        "الأعداد والمبالغ لقطة من المصادر وقت القراءة. نسب الكورسات معادلات بمخرجات مخبأة مطابقة للداشبورد؛ تُعاد في Excel عند تعديل المدخلات.",
        "Counts and money are source snapshots as of read time. Course ratios are formulas with dashboard-matching cached values; Excel recalculates when inputs change.",
      ),
    ],
  ];
  const notes = sheet(
    t("معلومات التقرير", "Report notes"),
    [t("البند", "Item"), t("التفاصيل", "Details")],
    metadata,
  );
  notes.getColumn(1).width = 40;
  notes.getColumn(2).width = 110;
  notes.eachRow((r, n) => {
    if (n > 1) r.height = 48;
  });
  return wb;
}

export async function downloadDailyUpdatesExcel(
  report: DailyUpdatesReport,
  rows = report.rows,
  lang: "ar" | "en" = "en",
  search = "",
) {
  const workbook = createDailyUpdatesWorkbook(report, rows, lang, search);
  const bytes = await workbook.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "Engosoft-Daily-Updates-" + report.day + ".xlsx";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
