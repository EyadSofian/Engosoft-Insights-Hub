import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download, RefreshCw, FileChartColumn, Search } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { useI18n, fmtNum, fmtPct, fmtUSDFull, fmtRoas, fmtDateTime } from "@/lib/i18n";
import { Card, Notice, Skeleton } from "@/components/ui-bits";
import type { QuarterLeadReviewReport } from "@/lib/quarter-leads-report.server";
import type { QuarterLeadReview } from "@/lib/quarter-leads-report";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
export const Route = createFileRoute("/quarter-leads-review")({ component: QuarterLeadReviewPage });
type Row = QuarterLeadReview["byCourse"][number];
export function QuarterLeadReviewPage() {
  const { lang } = useI18n(),
    ar = lang === "ar";
  const { data, isLoading, error, refetch, isFetching } = useApi<QuarterLeadReviewReport>(
    "/api/quarter-leads-review",
    { refetchInterval: 300000 },
  );
  const [view, setView] = useState<"byCourse" | "byPlatform" | "comparison">("byCourse");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState(false);
  useRegisterNexusView("quarter_leads_review", { tab: view });
  const pct = (n: number | null) => (n === null ? "—" : fmtPct(n * 100));
  const number = (n: number | null) => (n === null ? "—" : fmtNum(n));
  const days = (n: number | null) => (n === null ? "—" : n.toFixed(1) + (ar ? " يوم" : " days"));
  const rows =
    data?.[view].filter((r) =>
      (r.course + " " + r.platform).toLowerCase().includes(search.toLowerCase()),
    ) || [];
  const exportExcel = async () => {
    if (!data) return;
    setExporting(true);
    setExportError(false);
    try {
      const { downloadQuarterLeadReview } = await import("@/lib/quarter-leads-export");
      await downloadQuarterLeadReview(data, lang);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };
  return (
    <main className="space-y-5">
      <header className="rounded-[1.75rem] bg-text p-6 text-surface sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] opacity-75">
              <FileChartColumn size={17} />
              {ar ? "تقرير مؤقت · 2026" : "TEMPORARY REVIEW · 2026"}
            </p>
            <h1 className="mt-3 text-3xl font-black">
              {ar ? "الليدز: أغسطس · سبتمبر · أكتوبر" : "Leads: August · September · October"}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 opacity-80">
              {ar
                ? "صرف الاستحواذ فقط، الفورم المباشر، ومصير مجموعة دخول كل شهر حتى تاريخ القراءة. Fresh هنا = كل الليدز الداخلة في الشهر، وليس تصنيف Lead Segment الحالي."
                : "Lead-acquisition spend, native forms and the outcome of each entry-month cohort as of this read. Fresh means all leads created that month, not today's Lead Segment tag."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => refetch()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/25 px-4 text-sm font-bold"
            >
              <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
              {ar ? "تحديث" : "Refresh"}
            </button>
            <button
              disabled={!data || exporting || isFetching}
              onClick={exportExcel}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-surface px-4 text-sm font-bold text-text disabled:opacity-50"
            >
              <Download size={16} />
              {exporting
                ? ar
                  ? "جارٍ تجهيز Excel…"
                  : "Preparing Excel…"
                : ar
                  ? "تصدير التقرير Excel"
                  : "Export review Excel"}
            </button>
          </div>
        </div>
      </header>
      <Notice tone="info">
        {ar
          ? "الفترة ثابتة: 1 أغسطس–31 أكتوبر 2026. فلاتر الكورس والمنصة فقط تطبّق هنا؛ فلتر التاريخ والبائع والشركة في الشريط العلوي لا يغيّر هذا التقرير."
          : "Fixed window: 1 August–31 October 2026. Only course and platform filters apply here; the header date, salesperson and company filters do not change this report."}
      </Notice>
      <Notice tone="info">
        {ar
          ? "مجموعة CRM هنا من مصادر المنصات المدفوعة بعد استبعاد الموقع والوعي والمصادر غير المدفوعة، وليس إجمالي CRM للشركة. كل شهر له مدة متابعة مختلفة حتى تاريخ القراءة، فلا تُعامل المقارنة كلقطة نهاية الشهر أو تجربة سببية."
          : "The CRM cohort here uses paid-platform sources after website, awareness and non-paid sources are excluded, not all company CRM. Cohorts have different follow-up ages at read time; this is not a month-end snapshot or causal experiment."}
      </Notice>
      {isLoading && <Skeleton className="h-80" />}
      {error && (
        <Notice tone="warning">
          {ar ? "تعذرت قراءة التقرير؛ أعد المحاولة." : "The review could not be read; retry."}
        </Notice>
      )}
      {exportError && (
        <Notice tone="warning">{ar ? "تعذر تجهيز Excel." : "Excel preparation failed."}</Notice>
      )}
      {data && (
        <>
          {(!data.availability.crm || !data.availability.revenue || !data.availability.links) && (
            <Notice tone="warning">
              {ar
                ? "بعض مصادر CRM أو التحصيل أو ربط البيع غير متاحة/قديمة؛ المقاييس المتأثرة تظهر — وليست صفرًا."
                : "Some CRM, collection or sales-link sources are unavailable/stale; affected metrics show —, not zero."}
            </Notice>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            {data.months.map((m) => (
              <Card key={m.month}>
                <p className="text-xs font-black uppercase tracking-wider text-brand">{m.month}</p>
                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-sm font-bold">
                    {ar ? "صرف حملات الليدز" : "Lead-campaign spend"}
                  </h2>
                  <b className="num text-2xl">{fmtUSDFull(m.spend)}</b>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <dt className="text-text-muted">
                      {ar ? "فورم مباشر من المنصات" : "Native platform forms"}
                    </dt>
                    <dd className="num mt-1 text-xl font-black">{number(m.nativeLeads)}</dd>
                    {!m.nativeComplete && (
                      <p className="mt-1 text-text-muted">
                        {ar ? "الموثّق فقط" : "Verified subtotal"}: {fmtNum(m.nativeKnown)}
                      </p>
                    )}
                  </div>
                  <div>
                    <dt className="text-text-muted">CPL · {ar ? "فورم مباشر" : "native"}</dt>
                    <dd className="num mt-1 text-xl font-black">{fmtUSDFull(m.nativeCpl)}</dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">
                      {ar ? "مجموعة CRM / Won" : "CRM cohort / Won"}
                    </dt>
                    <dd className="num mt-1 font-bold">
                      {number(m.crmLeads)} / {number(m.won)} · {pct(m.wonRate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">
                      {ar ? "Lost / مفتوح حاليًا" : "Lost / open now"}
                    </dt>
                    <dd className="num mt-1 font-bold">
                      {number(m.lost)} / {number(m.open)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">
                      {ar ? "إيراد المجموعة حتى الآن" : "Cohort collections to date"}
                    </dt>
                    <dd className="num mt-1 font-bold">{fmtUSDFull(m.cohortRevenue)}</dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">
                      {ar ? "ROAS المجموعة · الجزء المرتبط" : "Cohort ROAS · linked portion"}
                    </dt>
                    <dd className="num mt-1 font-bold">
                      {m.cohortRoas === null ? "—" : fmtRoas(m.cohortRoas)}
                    </dd>
                  </div>
                </dl>
                {m.spend === null && (
                  <p className="mt-3 text-xs text-danger">
                    {ar
                      ? "تغطية الصرف ناقصة؛ المتوفر فقط"
                      : "Spend coverage incomplete; observed subtotal only"}
                    : {fmtUSDFull(m.spendKnown)}
                  </p>
                )}
                <p className="mt-4 border-t border-border pt-3 text-[11px] leading-6 text-text-muted">
                  {ar
                    ? "صرف مستبعد: موقع/وعي/هدف غير مؤكد"
                    : "Excluded spend: website/awareness/unverified objective"}
                  : <b className="num">{fmtUSDFull(m.excludedSpend)}</b>
                </p>
              </Card>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-text-muted">
            <span>
              {ar ? "قراءة التقرير" : "Read at"}: {fmtDateTime(data.generatedAt, lang)}
            </span>
            <span>
              {ar ? "المصير الحالي حتى" : "Current outcome as of"}: {data.asOf}
            </span>
            <span>
              {ar ? "فواتير بلا ربط حاسم" : "Invoices without exact link"}:{" "}
              {fmtNum(data.coverage.unlinkedInvoices)}
            </span>
          </div>
          <Notice tone="warning">
            {ar
              ? "ليدز المنصات أعداد أحداث فورم، وليست عدد أشخاص CRM الفريدين. أعداد Won/Lost نسبتها من مجموعة CRM، وليس من الفورم المجمّع. إيراد المجموعة مربوط بمعرف Opportunity وأمر البيع، ويشمل التحصيل اللاحق؛ غير المرتبط لا نُسنده تخمينًا."
              : "Native platform leads are form events, not distinct CRM people. Won/Lost rates use the CRM cohort, not aggregate forms. Cohort revenue uses exact Opportunity/order links and includes later collections; unlinked sales are not guessed into a cohort."}
          </Notice>
          <Notice tone="info">
            {ar
              ? "دليل فورم مباشر على سجلات CRM: " +
                fmtNum(data.coverage.nativeProvenCrm) +
                " من " +
                fmtNum(data.coverage.cohortIds) +
                ". باقي السجلات محسوبة من مصدر المنصة، لكنه وحده لا يثبت نموذج Native؛ لذلك تحويل Won وROAS المعروضين تخص مجموعة CRM المدفوعة، وليس ادعاء ربط كل حدث فورم بفرد."
              : "Direct form evidence on CRM records: " +
                fmtNum(data.coverage.nativeProvenCrm) +
                " of " +
                fmtNum(data.coverage.cohortIds) +
                ". Other records are scoped by paid-platform source, which alone does not prove a native form. Won conversion and ROAS therefore describe the paid CRM cohort, not a proven person-level link for every form event."}
          </Notice>
          {!data.tiktokNativeReady && (
            <Notice tone="warning">
              {ar
                ? "الفورم المباشر من TikTok غير متاح؛ تحويلات الموقع لم تُستخدم بدلًا منه."
                : "TikTok native forms are unavailable; website conversions were not substituted."}
            </Notice>
          )}
          <Card className="overflow-hidden !p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["byCourse", ar ? "دورة حياة الكورس" : "Course lifecycle"],
                    ["byPlatform", ar ? "مقارنة المنصات" : "Platform comparison"],
                    ["comparison", ar ? "كل كورس × منصة" : "Course × platform"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setView(key)}
                    className={
                      "min-h-10 rounded-xl px-4 text-xs font-bold " +
                      (view === key
                        ? "bg-brand text-white"
                        : "border border-border text-text-muted")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 rounded-xl border border-border px-3">
                <Search size={14} />
                <input
                  aria-label={ar ? "بحث التقرير" : "Search review"}
                  placeholder={ar ? "كورس أو منصة…" : "Course or platform…"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-h-10 w-40 bg-transparent text-sm outline-none"
                />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1350px] text-start text-xs">
                <thead className="bg-surface-2 text-text-muted">
                  <tr>
                    {[
                      ar ? "الشهر" : "Month",
                      ar ? "الكورس / المنصة" : "Course / platform",
                      ar ? "الصرف" : "Spend",
                      ar ? "فورم مباشر / CPL" : "Native forms / CPL",
                      ar ? "CRM / Won / Lost" : "CRM / Won / Lost",
                      ar ? "نسبة Won / Lost" : "Won / Lost rate",
                      ar ? "إيراد المجموعة / ROAS" : "Cohort revenue / ROAS",
                      ar ? "متوسط / وسيط الإغلاق" : "Mean / median close",
                      ar ? "دورة Won / Lost" : "Won / Lost cycle",
                      ar ? "عينات مؤرخة / مفقودة" : "Dated / undated",
                      ar ? "الإغلاق خلال أيام" : "Closed within days",
                    ].map((h) => (
                      <th key={h} className="px-4 py-4 text-start">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.month + r.course + r.platform}
                      className="border-t border-border align-top hover:bg-surface-2/40"
                    >
                      <td className="num px-4 py-4">{r.month}</td>
                      <td className="px-4 py-4 font-bold">
                        {r.course}
                        <span className="mt-1 block text-text-muted">{r.platform}</span>
                      </td>
                      <td className="num px-4 py-4">{fmtUSDFull(r.spend)}</td>
                      <td className="num px-4 py-4">
                        {number(r.nativeLeads)}
                        <span className="mt-1 block text-text-muted">
                          {fmtUSDFull(r.nativeCpl)}
                        </span>
                      </td>
                      <td className="num px-4 py-4">
                        {number(r.crmLeads)} / <b className="text-success">{number(r.won)}</b> /{" "}
                        <b className="text-danger">{number(r.lost)}</b>
                        <span className="mt-1 block text-text-muted">
                          {ar ? "Lost ليد / فرصة" : "Lost lead / opp."}: {number(r.lostLeads)} /{" "}
                          {number(r.lostOpportunities)}
                        </span>
                      </td>
                      <td className="num px-4 py-4">
                        {pct(r.wonRate)} / {pct(r.lostRate)}
                      </td>
                      <td className="num px-4 py-4">
                        {fmtUSDFull(r.cohortRevenue)}
                        <span className="mt-1 block text-text-muted">
                          {r.cohortRoas === null ? "—" : fmtRoas(r.cohortRoas)}
                        </span>
                      </td>
                      <td className="num px-4 py-4">
                        {days(r.cycleMean)} / {days(r.cycleMedian)}
                      </td>
                      <td className="num px-4 py-4">
                        {days(r.wonCycle)} / {days(r.lostCycle)}
                      </td>
                      <td className="num px-4 py-4">
                        {number(r.datedClosures)} / {number(r.undatedClosures)}
                        <span className="mt-1 block text-text-muted">
                          {ar ? "تاريخ بديل" : "Proxy date"}: {number(r.proxyDates)}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          {r.lifecycle.map((b) => (
                            <span key={b.bucket} className="rounded-md bg-surface-2 px-2 py-1">
                              <b className="num">{number(b.count)}</b> · {b.bucket}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <details className="rounded-2xl border border-border bg-surface p-5">
            <summary className="cursor-pointer font-bold">
              {ar ? "منهجية التقرير والتغطية" : "Methodology and coverage"}
            </summary>
            <div className="mt-4 space-y-3 text-xs leading-7 text-text-muted">
              <p>
                {ar
                  ? "الموقع (web/con/website)، الويبينار، وحملات الوعي والترافيك والبراندنج مستبعدة من صرف الليدز. الأهداف المجهولة لا تُعامل كحملات ليدز. ملف Excel يضم تدقيق الحملات المستبعدة وسبب استبعادها."
                  : "Website (web/con/website), webinars, awareness, traffic and branding campaigns are excluded from lead spend. Unknown objectives are not assumed to be lead campaigns. Excel includes the excluded-campaign audit and reason."}
              </p>
              <p>
                {ar
                  ? "Meta = on-Facebook forms؛ Snapchat = native leads؛ TikTok = form فقط، وليس conversions. Google لا يُسمى فورم مباشر إذا لم يتوفر هذا القياس. عدم اكتمال أي جزء يمنع اعتماد إجمالي/CPL مكتمل."
                  : "Meta uses on-Facebook forms; Snapchat native leads; TikTok form only, not conversions. Google is not called native forms without that metric. Incomplete source coverage withholds a complete total/CPL."}
              </p>
              <p>
                {ar
                  ? "نستبعد Recommendation وWhatsApp Broadcast وAutoDialer Broadcast من السورس أو Lead Segment. نحسب كل ID مرة واحدة، وليس كل رقم هاتف مرة واحدة؛ الأحداث المجمعة من المنصات ليست أشخاصًا فريدين."
                  : "Recommendation, WhatsApp Broadcast and AutoDialer Broadcast are excluded by source or Lead Segment. Each CRM ID counts once, not each phone number once; aggregate platform events are not distinct people."}
              </p>
              <p>
                {ar
                  ? "دورة الحياة من يوم الإنشاء إلى تاريخ Won/Lost المسجل فقط، وليست من آخر نشاط. السجلات المفتوحة وغير المؤرخة لا تُفترض صفر أيام. حالات الإغلاق الحالية ليست لقطة نهاية شهر أغسطس أو سبتمبر أو أكتوبر."
                  : "Lifecycle is creation day to recorded Won/Lost date, not last activity. Open and undated records are not assumed to take zero days. Current outcomes are not historical month-end snapshots."}
              </p>
              <p>
                {ar
                  ? "وجود مصدر منصة على CRM لا يثبت وحده أنه فورم Native. السجلات ذات Facebook Lead ID هي دليل إضافي، والباقي موضح بتغطية الإسناد. ROAS المجموعة لا يعني أن كل إيرادات الشركة أُسندت بنجاح."
                  : "A CRM platform source alone does not prove a native form. Facebook Lead ID supplies additional evidence; attribution coverage is disclosed. Cohort ROAS does not imply every company receipt was successfully attributed."}
              </p>
            </div>
          </details>
        </>
      )}
    </main>
  );
}
