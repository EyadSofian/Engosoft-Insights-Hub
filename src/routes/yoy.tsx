import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarOff, CalendarRange } from "lucide-react";
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
  InsightCard,
  InsightRow,
  KpiRow,
} from "@/components/dashboard-bits";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import type { DataHealth, Maybe, YoyPoint, YoyResult } from "@/lib/types";

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

const YTD_TONE: Record<string, "brand" | "success" | "danger" | "violet"> = {
  spend: "danger",
  revenue: "success",
  leads: "brand",
  won: "violet",
};

function metricLabel(metric: string, lang: "ar" | "en"): string {
  return YTD_LABEL[metric]?.[lang] ?? metric;
}

function Yoy() {
  const reportingPeriod = useReportingPeriod();
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

  // Courses ranked by how much money actually moved, not by percentage: a
  // course that went from $80 to $320 is a 300% gain and a $240 event, and
  // ranking it above a course that lost $9,000 would be a lie about which one
  // mattered. Only courses with a real reading on both sides are eligible.
  const movers = [...(data?.byCourse ?? [])]
    .filter((course) => Number.isFinite(course.current) && Number.isFinite(course.previous))
    .sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous));
  const decliner = movers.find((course) => course.current < course.previous) ?? null;

  return (
    <div className="space-y-5">
      <DashboardPageHeader
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
          <KpiRow columns={4}>
            {data.ytd.map((m, index) => {
              const money = m.metric === "spend" || m.metric === "revenue";
              const available = isAvailable(data, m.metric);
              return (
                <KpiCard
                  key={m.metric}
                  index={index}
                  label={metricLabel(m.metric, lang)}
                  value={available ? (money ? fmtUSD(m.current) : fmtNum(m.current)) : "—"}
                  delta={available && m.growth !== null ? m.growth : undefined}
                  deltaInvert={m.metric === "spend"}
                  tone={YTD_TONE[m.metric] ?? "neutral"}
                  sub={
                    available
                      ? `${data.previousYear}: ${money ? fmtUSD(m.previous) : fmtNum(m.previous)}`
                      : lang === "ar"
                        ? "لا توجد بيانات تاريخية لهذا المؤشر"
                        : "No historical data for this metric"
                  }
                />
              );
            })}
          </KpiRow>

          {movers.length > 0 && (
            <>
              <InsightRow>
                {movers[0] && (
                  <InsightCard
                    index={0}
                    kind="best"
                    eyebrow={lang === "ar" ? "أكبر نمو" : "Largest gain"}
                    title={movers[0].key}
                    value={fmtUSD(movers[0].current - movers[0].previous)}
                    detail={
                      lang === "ar"
                        ? `${fmtUSD(movers[0].previous)} في ${data.previousYear} ← ${fmtUSD(movers[0].current)} في ${data.currentYear}`
                        : `${fmtUSD(movers[0].previous)} in ${data.previousYear} → ${fmtUSD(movers[0].current)} in ${data.currentYear}`
                    }
                  />
                )}
                {decliner && (
                  <InsightCard
                    index={1}
                    kind="attention"
                    eyebrow={lang === "ar" ? "أكبر تراجع" : "Largest decline"}
                    title={decliner.key}
                    value={fmtUSD(decliner.current - decliner.previous)}
                    detail={
                      lang === "ar"
                        ? `${fmtUSD(decliner.previous)} في ${data.previousYear} ← ${fmtUSD(decliner.current)} في ${data.currentYear}`
                        : `${fmtUSD(decliner.previous)} in ${data.previousYear} → ${fmtUSD(decliner.current)} in ${data.currentYear}`
                    }
                  />
                )}
                <InsightCard
                  index={2}
                  kind="note"
                  eyebrow={lang === "ar" ? "نطاق المقارنة" : "Comparison scope"}
                  title={
                    lang === "ar"
                      ? `${data.currentYear} مقابل ${data.previousYear}`
                      : `${data.currentYear} against ${data.previousYear}`
                  }
                  detail={
                    lang === "ar"
                      ? "المقارنة السنوية تقرأ الملف كاملاً ولا تتأثر بالفلاتر أو الفترة المختارة."
                      : "The year comparison reads the whole file and is deliberately unaffected by the filters or the selected period."
                  }
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
