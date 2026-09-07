import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarOff, CalendarRange, TrendingDown, TrendingUp } from "lucide-react";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import {
  Card,
  ErrorState,
  EmptyState,
  KpiCard,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import {
  DashboardPageHeader,
  DashboardPanel,
  InsightRow,
  KpiRow,
} from "@/components/dashboard-bits";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import type { DataHealth, Maybe, YoyPoint, YoyResult } from "@/lib/types";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { InsightDetailTrigger, MetricDetailTrigger } from "@/components/metric-detail";
import { topRows, type MetricDetail } from "@/lib/metric-detail";

export const Route = createFileRoute("/yoy")({ component: Yoy });

interface Resp extends YoyResult {
  years: number[];
  rowsPerYear: { year: number; ads: number; crm: number; accounting: number }[];
  health: DataHealth;
}

const MONTHS = {
  ar: [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** The four year-to-date metrics, named for a reader rather than by field key. */
const YTD_LABEL: Record<string, { ar: string; en: string }> = {
  spend: { ar: "الإنفاق", en: "Spend" },
  revenue: { ar: "الإيراد", en: "Revenue" },
  leads: { ar: "العملاء المحتملون", en: "Leads" },
  won: { ar: "الصفقات الرابحة", en: "Won" },
};

function metricLabel(metric: string, lang: "ar" | "en"): string {
  return YTD_LABEL[metric]?.[lang] ?? metric;
}

/**
 * What each year-to-date comparison is made of.
 *
 * The monthly series and the per-course split are already in the response, so
 * opening "Revenue" shows the twelve months and the courses that moved it —
 * without a second request and without inventing a month the sheet never had.
 *
 * A metric with no history shows no delta and no chart: "0% year on year" from
 * an absent baseline reads as "flat", which is a claim the data has not made.
 */
/**
 * The three readings of the year comparison.
 *
 * Two of them name a course and one states the scope. All three open, because
 * "largest gain" is a sort the reader cannot see and "the comparison ignores
 * your filters" is the single most useful thing to know about this page — and
 * both were previously stated on a card that did nothing.
 */
function yoyInsights(
  data: Resp,
  movers: (YoyPoint & { metric: string })[],
  decliner: (YoyPoint & { metric: string }) | null,
  lang: "ar" | "en",
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const gainer = movers[0] ?? null;
  const scopeNote = A
    ? "المقارنة السنوية تقرأ الملف كاملًا ولا تتأثر بالفلاتر أو الفترة المختارة."
    : "The year comparison reads the whole file and is deliberately unaffected by the filters or the selected period.";

  const courseRows = (pick: (row: YoyPoint) => number, tone: "mint" | "rose") =>
    topRows(
      movers.map((course) => ({
        key: course.key,
        label: course.key,
        value: pick(course),
        display: fmtUSD(pick(course)),
        meta: `${fmtUSD(course.previous)} → ${fmtUSD(course.current)}`,
        tone,
      })),
    );

  const courseFacts = (row: (YoyPoint & { metric: string }) | null) =>
    row
      ? [
          { key: "previous", label: String(data.previousYear), value: fmtUSD(row.previous) },
          { key: "current", label: String(data.currentYear), value: fmtUSD(row.current) },
          {
            key: "delta",
            label: A ? "الفرق" : "Change",
            value: fmtUSD(row.current - row.previous),
          },
          { key: "growth", label: A ? "النمو" : "Growth", value: fmtPct(row.growth, 1) },
        ]
      : undefined;

  return {
    gainer: {
      id: "yoy.largestGain",
      title: A ? "أكبر نمو" : "Largest gain",
      value: gainer ? gainer.key : "—",
      tone: "mint",
      icon: <TrendingUp size={16} />,
      entity: gainer ? { type: "course", id: gainer.key, name: gainer.key } : null,
      definition: A
        ? "الدورة التي زاد إيرادها بأكبر مبلغ بين العامين. الترتيب بالمبلغ لا بالنسبة: نمو 300% على مئة دولار ليس حدثًا."
        : "The course whose revenue grew by the largest amount between the two years. Ranked by amount, not by percentage: 300% growth on a hundred dollars is not an event.",
      formula: gainer
        ? `${fmtUSD(gainer.current)} − ${fmtUSD(gainer.previous)} = ${fmtUSD(gainer.current - gainer.previous)}`
        : undefined,
      caveat: scopeNote,
      supporting: courseFacts(gainer),
      breakdowns: [
        {
          id: "gains",
          title: A ? "أكبر الزيادات بالمبلغ" : "Largest increases, by amount",
          rows: courseRows((row) => Math.max(0, row.current - row.previous), "mint"),
          emptyLabel: A ? "لا توجد زيادة في أي دورة" : "No course grew",
        },
      ],
      report: { to: "/courses", label: A ? "فتح تقرير الدورات" : "Open the courses report" },
    },

    decliner: {
      id: "yoy.largestDecline",
      title: A ? "أكبر تراجع" : "Largest decline",
      value: decliner ? decliner.key : "—",
      tone: "rose",
      icon: <TrendingDown size={16} />,
      deltaInvert: true,
      entity: decliner ? { type: "course", id: decliner.key, name: decliner.key } : null,
      definition: A
        ? "الدورة التي انخفض إيرادها بأكبر مبلغ بين العامين."
        : "The course whose revenue fell by the largest amount between the two years.",
      formula: decliner
        ? `${fmtUSD(decliner.current)} − ${fmtUSD(decliner.previous)} = ${fmtUSD(decliner.current - decliner.previous)}`
        : undefined,
      caveat: scopeNote,
      supporting: courseFacts(decliner),
      breakdowns: [
        {
          id: "declines",
          title: A ? "أكبر التراجعات بالمبلغ" : "Largest declines, by amount",
          rows: courseRows((row) => Math.min(0, row.current - row.previous), "rose"),
          emptyLabel: A ? "لم تتراجع أي دورة" : "No course declined",
        },
      ],
      report: { to: "/courses", label: A ? "فتح تقرير الدورات" : "Open the courses report" },
    },

    scope: {
      id: "yoy.scope",
      title: A ? "نطاق المقارنة" : "Comparison scope",
      value: `${data.currentYear} ${A ? "مقابل" : "vs"} ${data.previousYear}`,
      tone: "violet",
      icon: <CalendarRange size={16} />,
      definition: scopeNote,
      formula: A
        ? `يقارن كل ${data.currentYear} حتى اليوم بنفس الأيام من ${data.previousYear}.`
        : `Compares ${data.currentYear} to date against the same days of ${data.previousYear}.`,
      caveat: A
        ? "أي مؤشر لا يملك تاريخًا في العام السابق يظهر بشرطة بدلًا من صفر يقرأه القارئ كتراجع."
        : "A metric with no history in the previous year shows an em dash rather than a zero a reader would take for a collapse.",
      supporting: [
        {
          key: "courses",
          label: A ? "الدورات المقارَنة" : "Courses compared",
          value: fmtNum(movers.length),
        },
        {
          key: "rising",
          label: A ? "دورات نمت" : "Courses that grew",
          value: fmtNum(movers.filter((row) => row.current > row.previous).length),
        },
        {
          key: "falling",
          label: A ? "دورات تراجعت" : "Courses that fell",
          value: fmtNum(movers.filter((row) => row.current < row.previous).length),
        },
        {
          key: "metrics",
          label: A ? "مؤشرات لها تاريخ" : "Metrics with history",
          value: fmtNum(Object.values(data.metricAvailability).filter(Boolean).length),
        },
      ],
      breakdowns: [
        {
          id: "ytd",
          title: A ? "المقارنة حسب المؤشر" : "The comparison, by metric",
          rows: data.ytd.map((row) => ({
            key: row.metric,
            label: row.metric,
            value: row.current,
            display:
              row.metric === "spend" || row.metric === "revenue"
                ? fmtUSD(row.current)
                : fmtNum(row.current),
            meta:
              row.metric === "spend" || row.metric === "revenue"
                ? `${data.previousYear}: ${fmtUSD(row.previous)}`
                : `${data.previousYear}: ${fmtNum(row.previous)}`,
            tone: "violet" as const,
          })),
          emptyLabel: A ? "لا توجد مؤشرات قابلة للمقارنة" : "No comparable metric",
        },
      ],
    },
  };
}

function yoyMetrics(data: Resp, lang: "ar" | "en"): Record<string, MetricDetail> {
  const A = lang === "ar";
  const TONE: Record<string, MetricDetail["tone"]> = {
    spend: "rose",
    revenue: "mint",
    leads: "sky",
    won: "violet",
  };

  const out: Record<string, MetricDetail> = {};
  for (const row of data.ytd) {
    const money = row.metric === "spend" || row.metric === "revenue";
    const format = money ? fmtUSD : fmtNum;
    const available = isAvailable(data, row.metric);
    const monthly = (data[row.metric as "spend" | "revenue" | "leads" | "won"] ?? []) as YoyPoint[];
    const courses = data.byCourse.filter((course) => course.metric === row.metric);

    out[row.metric] = {
      id: `yoy.${row.metric}`,
      title: metricLabel(row.metric, lang),
      value: available ? format(row.current) : "—",
      tone: TONE[row.metric] ?? "slate",
      delta: available && row.growth !== null ? row.growth : undefined,
      deltaInvert: row.metric === "spend",
      definition: available
        ? A
          ? `${metricLabel(row.metric, lang)} من بداية ${data.currentYear} حتى اليوم، مقابل نفس المدة من ${data.previousYear}. المقارنة على مدى متساوٍ من السنة، لا على سنة كاملة مقابل سنة ناقصة.`
          : `${metricLabel(row.metric, lang)} from the start of ${data.currentYear} to today, against the same stretch of ${data.previousYear}. Equal spans of the year, never a full year against a partial one.`
        : A
          ? "لا توجد بيانات تاريخية لهذا المؤشر، فلا تُعرض مقارنة سنوية له."
          : "There is no history for this metric, so no year-on-year comparison is shown for it.",
      formula: available
        ? A
          ? `${format(row.previous)} في ${data.previousYear} ← ${format(row.current)} في ${data.currentYear}.`
          : `${format(row.previous)} in ${data.previousYear} → ${format(row.current)} in ${data.currentYear}.`
        : undefined,
      supporting: available
        ? [
            {
              key: "previous",
              label: `${data.previousYear}`,
              value: format(row.previous),
            },
            { key: "current", label: `${data.currentYear}`, value: format(row.current) },
            {
              key: "delta",
              label: A ? "الفارق" : "Difference",
              value: format(row.current - row.previous),
            },
            {
              key: "growth",
              label: A ? "النمو" : "Growth",
              value: row.growth === null ? "—" : fmtPct(row.growth, 1),
            },
          ]
        : undefined,
      breakdowns: available
        ? [
            {
              id: "months",
              title: A ? "أكبر الشهور تغيّرًا" : "Months that moved the most",
              hint: A
                ? `الفارق بين ${data.currentYear} و${data.previousYear} لكل شهر.`
                : `The difference between ${data.currentYear} and ${data.previousYear}, month by month.`,
              rows: topRows(
                monthly.map((point) => ({
                  key: point.key,
                  label: point.key,
                  value: point.delta,
                  display: format(point.delta),
                  meta: point.growth === null ? undefined : fmtPct(point.growth, 1),
                  tone: point.delta >= 0 ? ("mint" as const) : ("rose" as const),
                })),
              ),
              emptyLabel: A ? "لا توجد شهور قابلة للمقارنة" : "No comparable months",
            },
            {
              id: "courses",
              title: A ? "أكبر الدورات تغيّرًا" : "Courses that moved the most",
              rows: topRows(
                courses.map((course) => ({
                  key: course.key,
                  label: course.key,
                  value: course.delta,
                  display: format(course.delta),
                  meta: course.growth === null ? undefined : fmtPct(course.growth, 1),
                  tone: course.delta >= 0 ? ("mint" as const) : ("rose" as const),
                })),
              ),
              emptyLabel: A ? "لا توجد دورات قابلة للمقارنة" : "No comparable courses",
            },
          ]
        : undefined,
      report:
        row.metric === "revenue"
          ? { to: "/accounting", label: A ? "فتح تقرير الحسابات" : "Open the Accounting report" }
          : row.metric === "spend"
            ? { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" }
            : { to: "/leads", label: A ? "فتح تقرير العملاء" : "Open the leads report" },
    };
  }
  return out;
}

function Yoy() {
  const reportingPeriod = useReportingPeriod();
  // Declares this page to ENGO Nexus, so "حلل الصفحة دي" and "التاب ده"
  // have something to resolve against. Ids and state only — no figures.
  useRegisterNexusView("yoy");
  const { t, lang } = useI18n();
  // Year-over-year is a property of the whole sheet, not of the active window,
  // so this endpoint deliberately ignores the global filters.
  const { data, isLoading, error, refetch } = useQuery<Resp>({
    queryKey: ["yoy"],
    queryFn: async () => {
      const res = await fetch("/api/yoy");
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  // One description per figure, built once from the response on screen.
  const metrics = data ? yoyMetrics(data, lang) : {};

  // Courses ranked by how much money actually moved, not by percentage: a
  // course that went from $80 to $320 is a 300% gain and a $240 event, and
  // ranking it above a course that lost $9,000 would be a lie about which one
  // mattered. Only courses with a real reading on both sides are eligible.
  const movers = [...(data?.byCourse ?? [])]
    .filter((course) => Number.isFinite(course.current) && Number.isFinite(course.previous))
    .sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous));
  const decliner = movers.find((course) => course.current < course.previous) ?? null;
  const insights = data ? yoyInsights(data, movers, decliner, lang) : null;

  return (
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<CalendarRange size={20} />}
        title={t("yoy")}
        subtitle={
          data
            ? `${data.currentYear} ${lang === "ar" ? "مقابل" : "vs"} ${data.previousYear}`
            : undefined
        }
        period={reportingPeriod}
      />

      {isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : !data.available ? (
        <>
          <Card>
            <div className="py-8 text-center">
              <CalendarOff size={30} className="text-text-subtle mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm font-medium text-text mb-1">
                {lang === "ar"
                  ? `لا توجد بيانات كافية لعام ${data.previousYear}`
                  : `Not enough ${data.previousYear} data`}
              </p>
              <p className="text-xs text-text-muted max-w-md mx-auto leading-relaxed">
                {t("yoy_empty")}
              </p>
            </div>
          </Card>

          <Card>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "تغطية البيانات المتاحة لكل عام"
                  : "Available data coverage per year"
              }
            >
              {lang === "ar" ? "تغطية البيانات" : "Data coverage"}
            </SectionTitle>
            <div className="table-wrap scroll-hint-x">
              <table className="w-full text-sm min-w-[460px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="text-start py-2">{lang === "ar" ? "العام" : "Year"}</th>
                    <th className="text-end py-2">{lang === "ar" ? "إعلانات" : "Ads"}</th>
                    <th className="text-end py-2">{t("crm_leads")}</th>
                    <th className="text-end py-2">{t("accounting")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rowsPerYear.map((r) => (
                    <tr key={r.year} className="border-t border-border">
                      <td className="py-2.5 num font-medium">{r.year}</td>
                      <td className="py-2.5 text-end num">{fmtNum(r.ads)}</td>
                      <td className="py-2.5 text-end num">{fmtNum(r.crm)}</td>
                      <td className="py-2.5 text-end num">{fmtNum(r.accounting)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-text-muted mt-3 leading-relaxed">
              {lang === "ar"
                ? "لن تُعرض أي نسبة نمو مقابل أساس صفري — الرقم في تلك الحالة بلا معنى، لذلك تظهر شرطة."
                : "No growth percentage is rendered against a zero baseline — that number is meaningless, so it shows an em dash."}
            </p>
          </Card>
        </>
      ) : (
        <>
          {/* The same four year-to-date comparisons, on the shared KPI card.
              `delta` is the growth the API returned; a metric with no history
              renders an em dash and no delta at all rather than a zero and a
              0% that would read as "flat year on year". */}
          <KpiRow>
            {data.ytd.map((m, index) => {
              const money = m.metric === "spend" || m.metric === "revenue";
              const available = isAvailable(data, m.metric);
              return (
                <MetricDetailTrigger
                  key={m.metric}
                  detail={metrics[m.metric]}
                  card={{
                    index,
                    sub: available
                      ? `${data.previousYear}: ${money ? fmtUSD(m.previous) : fmtNum(m.previous)}`
                      : lang === "ar"
                        ? "لا توجد بيانات تاريخية لهذا المؤشر"
                        : "No historical data for this metric",
                  }}
                />
              );
            })}
          </KpiRow>

          {movers.length > 0 && (
            <>
              <InsightRow>
                {movers[0] && (
                  <InsightDetailTrigger
                    detail={insights!.gainer}
                    card={{
                      index: 0,
                      kind: "best",
                      eyebrow: lang === "ar" ? "أكبر نمو" : "Largest gain",
                      title: movers[0].key,
                      value: fmtUSD(movers[0].current - movers[0].previous),
                      detail:
                        lang === "ar"
                          ? `${fmtUSD(movers[0].previous)} في ${data.previousYear} ← ${fmtUSD(movers[0].current)} في ${data.currentYear}`
                          : `${fmtUSD(movers[0].previous)} in ${data.previousYear} → ${fmtUSD(movers[0].current)} in ${data.currentYear}`,
                      actionLabel: lang === "ar" ? "ما ترتيب الدورات؟" : "How do courses rank?",
                    }}
                  />
                )}
                {decliner && (
                  <InsightDetailTrigger
                    detail={insights!.decliner}
                    card={{
                      index: 1,
                      kind: "attention",
                      eyebrow: lang === "ar" ? "أكبر تراجع" : "Largest decline",
                      title: decliner.key,
                      value: fmtUSD(decliner.current - decliner.previous),
                      detail:
                        lang === "ar"
                          ? `${fmtUSD(decliner.previous)} في ${data.previousYear} ← ${fmtUSD(decliner.current)} في ${data.currentYear}`
                          : `${fmtUSD(decliner.previous)} in ${data.previousYear} → ${fmtUSD(decliner.current)} in ${data.currentYear}`,
                      actionLabel: lang === "ar" ? "ما الذي تراجع أيضًا؟" : "What else fell?",
                    }}
                  />
                )}
                <InsightDetailTrigger
                  detail={insights!.scope}
                  card={{
                    index: 2,
                    kind: "note",
                    eyebrow: lang === "ar" ? "نطاق المقارنة" : "Comparison scope",
                    title:
                      lang === "ar"
                        ? `${data.currentYear} مقابل ${data.previousYear}`
                        : `${data.currentYear} against ${data.previousYear}`,
                    detail:
                      lang === "ar"
                        ? "المقارنة السنوية تقرأ الملف كاملاً ولا تتأثر بالفلاتر أو الفترة المختارة."
                        : "The year comparison reads the whole file and is deliberately unaffected by the filters or the selected period.",
                    actionLabel: lang === "ar" ? "ما الذي يُقارَن؟" : "What is compared?",
                  }}
                />
              </InsightRow>

              <DashboardPanel
                title={lang === "ar" ? "أكثر التغيّرات تأثيراً" : "Most consequential changes"}
                hint={
                  lang === "ar"
                    ? "مرتّبة بحجم التغيّر بالدولار، لا بنسبته — نمو 300% على مئة دولار ليس حدثاً."
                    : "Ranked by the size of the change in dollars, not its percentage — 300% on a hundred dollars is not an event."
                }
              >
                <div className="table-wrap scroll-hint-x">
                  <table className="w-full min-w-[460px] text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                        <th className="py-2 text-start">#</th>
                        <th className="py-2 text-start">{t("course")}</th>
                        <th className="py-2 text-end">{lang === "ar" ? "التغيّر" : "Change"}</th>
                        <th className="py-2 text-end">{t("growth")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movers.slice(0, 5).map((course, index) => (
                        <tr key={course.key} className="border-t border-border">
                          <td className="num py-2.5 text-text-muted">{index + 1}</td>
                          <td className="py-2.5">{course.key}</td>
                          <td
                            className="num py-2.5 text-end font-medium"
                            style={{
                              color:
                                course.current >= course.previous
                                  ? "var(--success)"
                                  : "var(--danger)",
                            }}
                          >
                            {course.current >= course.previous ? "+" : ""}
                            {fmtUSD(course.current - course.previous)}
                          </td>
                          <td className="py-2.5 text-end">
                            <Growth value={course.growth} inline />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DashboardPanel>
            </>
          )}

          <MonthTable
            title={t("spend")}
            points={data.spend}
            money
            available={data.metricAvailability.spend}
          />
          <MonthTable
            title={t("revenue")}
            points={data.revenue}
            money
            available={data.metricAvailability.revenue}
          />
          <MonthTable
            title={t("crm_leads")}
            points={data.leads}
            available={data.metricAvailability.leads}
          />
          <MonthTable title={t("won")} points={data.won} available={data.metricAvailability.won} />

          <Card>
            <SectionTitle>{t("by_course")}</SectionTitle>
            {data.byCourse.length === 0 ? (
              <EmptyState label={t("no_data")} compact />
            ) : (
              <div className="table-wrap scroll-hint-x">
                <table className="w-full text-sm min-w-[460px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                      <th className="text-start py-2">{t("course")}</th>
                      <th className="text-end py-2">{data.currentYear}</th>
                      <th className="text-end py-2">{data.previousYear}</th>
                      <th className="text-end py-2">{t("growth")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCourse.slice(0, 20).map((c) => (
                      <tr key={c.key} className="border-t border-border">
                        <td className="py-2.5">{c.key}</td>
                        <td className="py-2.5 text-end num">{fmtUSD(c.current)}</td>
                        <td className="py-2.5 text-end num">{fmtUSD(c.previous)}</td>
                        <td className="py-2.5 text-end">
                          <Growth value={c.growth} inline />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function isAvailable(data: Resp, metric: string): boolean {
  return metric in data.metricAvailability
    ? data.metricAvailability[metric as keyof Resp["metricAvailability"]]
    : false;
}

function MonthTable({
  title,
  points,
  money,
  available,
}: {
  title: string;
  points: YoyPoint[];
  money?: boolean;
  available: boolean;
}) {
  const { lang } = useI18n();
  const fmt = money ? fmtUSD : fmtNum;
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      {!available ? (
        <EmptyState
          label={
            lang === "ar"
              ? `بيانات ${title} التاريخية غير متاحة للمقارنة`
              : `Historical ${title} data is unavailable for comparison`
          }
          compact
        />
      ) : (
        <div className="table-wrap scroll-hint-x">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="text-start py-2">{lang === "ar" ? "الشهر" : "Month"}</th>
                <th className="text-end py-2">{lang === "ar" ? "الحالي" : "Current"}</th>
                <th className="text-end py-2">{lang === "ar" ? "السابق" : "Previous"}</th>
                <th className="text-end py-2">{lang === "ar" ? "الفرق" : "Delta"}</th>
                <th className="text-end py-2">%</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p.key} className="border-t border-border">
                  <td className="py-2">{MONTHS[lang][i]}</td>
                  <td className="py-2 text-end num">{fmt(p.current)}</td>
                  <td className="py-2 text-end num">{fmt(p.previous)}</td>
                  <td className="py-2 text-end num">{fmt(p.delta)}</td>
                  <td className="py-2 text-end">
                    <Growth value={p.growth} inline />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** An em dash where the baseline was zero — a growth % there is not a fact. */
function Growth({ value, inline }: { value: Maybe; inline?: boolean }) {
  if (value === null || !isFinite(value))
    return (
      <span className={`text-text-subtle num ${inline ? "" : "block mt-1 text-[11px]"}`}>—</span>
    );
  const good = value >= 0;
  return (
    <span
      className={`num font-semibold ${inline ? "text-[13px]" : "block mt-1 text-[11px]"}`}
      style={{ color: good ? "var(--success)" : "var(--danger)" }}
    >
      {good ? "+" : ""}
      {fmtPct(value, 1)}
    </span>
  );
}
