import ExcelJS from "exceljs";
import type { QuarterLeadReviewReport } from "./quarter-leads-report.server";
export function quarterReviewWorkbook(report: QuarterLeadReviewReport, lang: "ar" | "en" = "en") {
  const ar = lang === "ar",
    t = (a: string, e: string) => (ar ? a : e);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Engosoft Insights Hub";
  wb.created = new Date(report.generatedAt);
  wb.calcProperties.fullCalcOnLoad = true;
  const safe = (s: unknown) =>
    typeof s === "string" && /^[=+\-@]/.test(s.trimStart()) ? "'" + s : (s ?? null);
  const add = (name: string, headers: string[], rows: unknown[][]) => {
    const s = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, rightToLeft: ar }] });
    s.addRow(headers);
    rows.forEach((r) => s.addRow(r.map(safe)));
    s.autoFilter = { from: { row: 1, column: 1 }, to: { row: s.rowCount, column: headers.length } };
    s.columns.forEach((c, i) => (c.width = i < 3 ? 24 : 20));
    s.eachRow((r, n) => {
      r.height = n === 1 ? 46 : 28;
      r.eachCell({ includeEmpty: true }, (c) => {
        c.font = {
          name: "Arial",
          size: 11,
          bold: n === 1,
          color: { argb: n === 1 ? "FFFFFFFF" : "FF10234B" },
        };
        c.alignment = { vertical: "middle", wrapText: true };
        if (n === 1 || n % 2 === 0)
          c.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: n === 1 ? "FF10234B" : "FFF1F6FC" },
          };
      });
    });
    return s;
  };
  const headings = [
    t("الشهر", "Month"),
    t("الكورس", "Course"),
    t("المنصة", "Platform"),
    t("صرف الليدز USD", "Lead spend USD"),
    t("فورم مباشر", "Native forms"),
    "CPL USD",
    t("مجموعة CRM", "CRM cohort"),
    "Won",
    "Lost",
    t("مفتوح", "Open"),
    t("نسبة Won", "Won rate"),
    t("نسبة Lost", "Lost rate"),
    t("تحصيل المجموعة USD", "Cohort collections USD"),
    "ROAS",
    t("ليدز بدفع مثبت", "Paid leads"),
    t("متوسط دورة الإغلاق", "Mean closure days"),
    t("وسيط دورة الإغلاق", "Median closure days"),
    t("متوسط دورة Won", "Mean Won days"),
    t("متوسط دورة Lost", "Mean Lost days"),
    t("إغلاقات مؤرخة", "Dated closures"),
    t("إغلاقات بلا تاريخ", "Undated closures"),
    t("تواريخ بديلة", "Proxy dates"),
    t("CRM بدليل فورم", "CRM with form evidence"),
    t("نقرات", "Clicks"),
    "CPC USD",
    "0–7",
    "8–30",
    "31–60",
    "61–90",
    "90+",
    t("Lost Leads", "Lost Leads"),
    t("Lost Opportunities", "Lost Opportunities"),
  ];
  for (const [name, rows] of [
    [t("الشهور", "Months"), report.months],
    [t("الكورسات", "Courses"), report.byCourse],
    [t("المنصات", "Platforms"), report.byPlatform],
    [t("الكورس والمنصة", "Course platform"), report.comparison],
  ] as const) {
    const s = add(
      name,
      headings,
      rows.map((r) => [
        r.month,
        r.course,
        r.platform,
        r.spend,
        r.nativeLeads,
        r.nativeCpl,
        r.crmLeads,
        r.won,
        r.lost,
        r.open,
        r.wonRate,
        r.lostRate,
        r.cohortRevenue,
        r.cohortRoas,
        r.paidLeads,
        r.cycleMean,
        r.cycleMedian,
        r.wonCycle,
        r.lostCycle,
        r.datedClosures,
        r.undatedClosures,
        r.proxyDates,
        r.nativeProvenCrm,
        r.clicks,
        r.cpc,
        ...r.lifecycle.map((b) => b.count),
        r.lostLeads,
        r.lostOpportunities,
      ]),
    );
    rows.forEach((r, i) => {
      const n = i + 2;
      for (const [col, formula, result] of [
        ["F", `IF(E${n}=0,"",D${n}/E${n})`, r.nativeCpl],
        ["K", `IF(G${n}=0,"",H${n}/G${n})`, r.wonRate],
        ["L", `IF(G${n}=0,"",I${n}/G${n})`, r.lostRate],
        ["N", `IF(D${n}=0,"",M${n}/D${n})`, r.cohortRoas],
        ["Y", `IF(X${n}=0,"",D${n}/X${n})`, r.cpc],
      ] as const) {
        s.getCell(col + n).value = result === null ? null : { formula, result };
      }
    });
    ["D", "F", "M", "Y"].forEach((c) => (s.getColumn(c).numFmt = "$#,##0.00;($#,##0.00);$0.00"));
    ["K", "L"].forEach((c) => (s.getColumn(c).numFmt = "0.0%"));
    s.getColumn("N").numFmt = '0.00"x"';
    ["P", "Q", "R", "S"].forEach((c) => (s.getColumn(c).numFmt = "0.0"));
  }
  add(
    t("تدقيق الحملات", "Campaign audit"),
    [
      t("الشهر", "Month"),
      t("المنصة", "Platform"),
      t("الكورس", "Course"),
      t("الحملة", "Campaign"),
      t("الحساب", "Account"),
      t("الهدف", "Objective"),
      t("الصرف USD", "Spend USD"),
      t("فورم مباشر", "Native forms"),
      t("سبب الاستبعاد - فارغ يعني مشمول", "Exclusion - blank means included"),
    ],
    report.campaignAudit.map((r) => [
      r.month,
      r.platform,
      r.course,
      r.campaign,
      r.account,
      r.objective,
      r.spend,
      r.nativeLeads,
      r.exclusion,
    ]),
  );
  const notes = add(
    t("المنهجية والتغطية", "Method and coverage"),
    [t("البند", "Item"), t("القيمة والتعريف", "Value and definition")],
    [
      [t("الفترة الثابتة", "Fixed window"), "2026-08-01 → 2026-10-31"],
      [t("تاريخ المصير الحالي", "Outcome as of"), report.asOf],
      [t("قراءة التقرير", "Read at"), report.generatedAt],
      [
        "Fresh",
        t(
          "كل سجلات الدخول في الشهر، وليس Lead Segment الحالي.",
          "Every CRM entry in the month, not current Lead Segment.",
        ),
      ],
      [
        t("الفورم المباشر", "Native forms"),
        t(
          "Meta on-Facebook؛ Snap native؛ TikTok form لا conversions. Google غير مثبت كنموذج Native. أحداث وليس أشخاصًا فريدين.",
          "Meta on-Facebook; Snap native; TikTok form, not conversions. Google native forms unproven. Events, not distinct people.",
        ),
      ],
      [
        t("التحويل إلى Won", "Won conversion"),
        t(
          "حالة Won الحالية ÷ نفس مجموعة CRM الداخلة في الشهر. ليست قسمة Won على أعداد الفورم المجمعة.",
          "Current Won ÷ the same CRM creation-month cohort; not Won divided by aggregate form events.",
        ),
      ],
      [
        "ROAS",
        t(
          "تحصيل حتى تاريخ القراءة مرتبط بمعرف Opportunity وبنفس الكورس ÷ صرف شهر الدخول. الجزء المرتبط فقط؛ الفواتير وإشعارات الخصم غير المرتبطة قد تغير النتيجة ولا نوزعها تخمينًا.",
          "Collections through read date linked by exact Opportunity ID and same course ÷ creation-month spend. Linked portion only; unlinked invoices and credit notes may change the result and are not guessed into a cohort.",
        ),
      ],
      [
        t("دورة الحياة", "Lifecycle"),
        t(
          "الإنشاء إلى تاريخ الإغلاق المسجل للـWon/Lost فقط. المفتوح وغير المؤرخ خارج المتوسط. هذه الحالة الحالية لا لقطة نهاية الشهر.",
          "Creation to recorded Won/Lost close date only. Open and undated records excluded from mean. Current state, not month-end snapshots.",
        ),
      ],
      [
        t("الاستبعاد", "Exclusion"),
        "Website web/con/website; webinar; social/awareness/branding/traffic; unknown objectives. Lead denominators also exclude Recommendation, WhatsApp Broadcast, AutoDialer Broadcast.",
      ],
      [
        t("القيم الفارغة", "Blanks"),
        t(
          "غير متاح أو المقام صفر؛ ليست نتيجة صفر.",
          "Unavailable or zero denominator, not an observed zero.",
        ),
      ],
      [t("الفلاتر", "Filters"), JSON.stringify(report.appliedFilters)],
      [t("تغطية الربط", "Link coverage"), JSON.stringify(report.coverage)],
      [t("تغطية الصرف", "Spend coverage"), JSON.stringify(report.spendCoverage)],
      [t("الروابط متاحة", "Links ready"), String(report.linksReady)],
      [t("مصادر البيانات", "Sources"), JSON.stringify(report.sources)],
      [t("مزامنة المصادر", "Source syncs"), JSON.stringify(report.sourceSyncs)],
      [
        t("المعادلات", "Formulas"),
        t(
          "الأعداد والمبالغ لقطة مصدر، والنسب معادلات لها قيم مخبأة مطابقة للتقرير.",
          "Counts and amounts are source snapshots; ratios are formulas with report-matching cached results.",
        ),
      ],
    ],
  );
  notes.getColumn(1).width = 38;
  notes.getColumn(2).width = 110;
  notes.eachRow((r, n) => {
    if (n > 1) r.height = 58;
  });
  return wb;
}
export async function downloadQuarterLeadReview(
  report: QuarterLeadReviewReport,
  lang: "ar" | "en",
) {
  const bytes = await quarterReviewWorkbook(report, lang).xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "Engosoft-Leads-Aug-Sep-Oct-2026.xlsx";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
