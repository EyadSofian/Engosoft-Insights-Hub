import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarRange, CircleAlert } from "lucide-react";
import { Card, ErrorState, SectionTitle, Skeleton } from "@/components/ui-bits";
import { DashboardPageHeader } from "@/components/dashboard-bits";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import type { AnnualComparison, AnnualNumbers } from "@/lib/yearly-analysis";

export const Route = createFileRoute("/yoy")({ component: YearlyPage });

interface Response {
  years: number[];
  annual: AnnualComparison;
  sourceDates: { ads: string; crm: string; revenue: string };
  today: string;
  health: { crmAuthority: string; lostAuthority: string; accountingAuthority: string };
  history: {
    year: number;
    status: "ready" | "refreshing" | "unavailable";
    syncedAt: string;
    error: string;
    leads: number;
    inventoryLeads: number;
  }[];
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

type Measure = "revenue" | "spend" | "leads" | "won" | "lost";
const MONTHLY_MEASURES: Measure[] = ["revenue", "spend", "leads", "won", "lost"];

function rate(current: number, previous: number, comparable: boolean) {
  return comparable && previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : null;
}

function moneyOrNumber(measure: Measure, value: number) {
  return measure === "revenue" || measure === "spend" ? fmtUSDFull(value) : fmtNum(value);
}

function metricName(measure: Measure, lang: "ar" | "en") {
  const names = {
    revenue: { ar: "الإيراد المحصّل", en: "Collected revenue" },
    spend: { ar: "صرف الإعلانات", en: "Ad spend" },
    leads: { ar: "الليدز", en: "Leads" },
    won: { ar: "Won", en: "Won" },
    lost: { ar: "Lost", en: "Lost" },
  };
  return names[measure][lang];
}

function Change({
  current,
  previous,
  comparable,
  invert = false,
}: {
  current: number;
  previous: number;
  comparable: boolean;
  invert?: boolean;
}) {
  const value = rate(current, previous, comparable);
  if (value === null) return <span className="text-text-subtle">—</span>;
  const good = invert ? value <= 0 : value >= 0;
  return (
    <span className={`num font-bold ${good ? "text-mint-ink" : "text-rose-ink"}`}>
      {value > 0 ? "+" : ""}
      {fmtPct(value, 1)}
    </span>
  );
}

function YearMetric({
  measure,
  current,
  previous,
  comparable,
  previousYear,
  lang,
  currentAvailable = true,
}: {
  measure: Measure;
  current: AnnualNumbers;
  previous: AnnualNumbers;
  comparable: boolean;
  previousYear: number;
  lang: "ar" | "en";
  currentAvailable?: boolean;
}) {
  const accent =
    measure === "revenue"
      ? "border-t-mint-strong"
      : measure === "spend"
        ? "border-t-rose-strong"
        : measure === "lost"
          ? "border-t-amber-strong"
          : "border-t-sky-strong";
  return (
    <Card className={`border-t-[3px] ${accent}`}>
      <div className="text-xs font-semibold text-text-muted">{metricName(measure, lang)}</div>
      <div className="num mt-2 text-2xl font-black tracking-tight text-text">
        {currentAvailable ? moneyOrNumber(measure, current[measure]) : "—"}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-[11px]">
        <span className="text-text-muted">
          {previousYear}:{" "}
          {comparable && currentAvailable ? moneyOrNumber(measure, previous[measure]) : "—"}
        </span>
        <Change
          current={current[measure]}
          previous={previous[measure]}
          comparable={comparable && currentAvailable}
          invert={measure === "spend" || measure === "lost"}
        />
      </div>
    </Card>
  );
}

function YearlyPage() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [courseQuery, setCourseQuery] = useState("");
  const [monthlyMeasure, setMonthlyMeasure] = useState<Measure>("revenue");
  useRegisterNexusView("yoy", {
    parameters: {
      year: selectedYear === null ? "" : String(selectedYear),
      month: selectedMonth === null ? "" : String(selectedMonth),
    },
  });
  const query = new URLSearchParams();
  if (selectedYear) query.set("year", String(selectedYear));
  if (selectedMonth) query.set("month", String(selectedMonth));
  const { data, isLoading, error, refetch } = useQuery<Response>({
    queryKey: ["yearly-analysis", selectedYear, selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/yoy${query.size ? `?${query}` : ""}`);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchInterval: (current) =>
      current.state.data?.history.some((source) => source.status === "refreshing")
        ? 10_000
        : current.state.data?.history.some(
              (source) => source.status === "unavailable" && source.error !== "Odoo not configured",
            )
          ? 60_000
          : false,
  });
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  const annual = data?.annual;
  const comparable = annual?.coverage.comparable;
  const currentHistory = data?.history.find((source) => source.year === annual?.year);
  const currentLeadsReady = !currentHistory || currentHistory.status === "ready";
  const lostAvailable =
    !!data &&
    (data.health.lostAuthority !== "unavailable" ||
      (Boolean(currentHistory) && currentHistory?.status === "ready"));
  const currentRevenueAvailable = (annual?.coverage.current.accounting ?? 0) > 0;
  const currentSpendAvailable = (annual?.coverage.current.ads ?? 0) > 0;
  const courses =
    annual?.courses.filter((row) =>
      row.name.toLowerCase().includes(courseQuery.trim().toLowerCase()),
    ) ?? [];
  const currentPeriod = annual ? `${annual.currentFrom} → ${annual.currentTo}` : undefined;
  const laggingSources =
    annual && data
      ? (
          [
            [A ? "الإعلانات" : "Ads", data.sourceDates.ads],
            ["CRM", data.sourceDates.crm],
            [A ? "التحصيل" : "Collections", data.sourceDates.revenue],
          ] as const
        ).filter(([, date]) => date && date < annual.currentTo)
      : [];

  return (
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<CalendarRange size={20} />}
        title={A ? "تحليل السنة" : "Yearly performance"}
        subtitle={
          A
            ? "المبيعات والليدز واللوست والصرف، شهرًا بشهر ولكل دورة."
            : "Revenue, leads, lost and spend—month by month and by course."
        }
        period={currentPeriod}
      />

      {isLoading || !annual || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <Card className="border-brand/20 bg-brand-soft/20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
                  {A ? "نطاق المقارنة" : "Comparison window"}
                </div>
                <h2 className="mt-1 text-lg font-black text-text">
                  {annual.year}{" "}
                  <span className="font-medium text-text-muted">{A ? "مقابل" : "versus"}</span>{" "}
                  {annual.previousYear}
                </h2>
                <p className="mt-1 text-xs text-text-muted">
                  {annual.currentFrom} → {annual.currentTo} <span className="mx-2">/</span>{" "}
                  {annual.previousFrom} → {annual.previousTo}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px] font-semibold text-text-muted">
                  {A ? "السنة" : "Year"}
                  <select
                    value={annual.year}
                    onChange={(event) => {
                      setSelectedYear(Number(event.target.value));
                      setSelectedMonth(null);
                    }}
                    className="mt-1 block min-w-28 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text"
                  >
                    {data.years.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-text-muted">
                  {A ? "حتى نهاية شهر" : "Through month"}
                  <select
                    value={annual.throughMonth}
                    onChange={(event) => setSelectedMonth(Number(event.target.value))}
                    className="mt-1 block min-w-32 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text"
                  >
                    {MONTHS[lang].map((label, index) => (
                      <option
                        key={label}
                        value={index + 1}
                        disabled={
                          annual.year === Number(data.today.slice(0, 4)) &&
                          index + 1 > Number(data.today.slice(5, 7))
                        }
                      >
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <p className="mt-3 border-t border-brand/15 pt-3 text-[11px] leading-relaxed text-text-muted">
              {A
                ? "المقارنة تبدأ من 1 يناير في العامين وتتوقف عند نفس اليوم من الشهر المحدد إذا كان الشهر الحالي لم ينتهِ؛ الشهور التالية لا تدخل في الإجمالي."
                : "Both years start on January 1. For an unfinished current month, both stop on the same calendar day; later months are excluded."}
            </p>
          </Card>

          {data.history.length > 0 && (
            <Card className="border-sky-border bg-sky-surface/30">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-text">
                    {A ? "ليدز 2024 و2025 من Odoo" : "2024–2025 leads from Odoo"}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">
                    {A
                      ? "تشمل كل ليدز السنتين، سواء في الـInventory الآن أو الـCRM العادي، بتاريخ إنشائها. Won/Lost بحسب حالتها الحالية؛ المبيعات حسب تاريخ التحصيل وليست بالضرورة من نفس الليدز."
                      : "Includes all leads created in those years, whether now in Inventory or normal CRM. Won/Lost reflect current state; collections are not necessarily from the same lead cohort."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.history.map((source) => (
                    <span
                      key={source.year}
                      className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-semibold text-text"
                      title={
                        source.status === "ready"
                          ? `${source.year}: ${fmtNum(source.leads)} total Odoo leads · ${fmtNum(source.inventoryLeads)} Inventory · ${source.syncedAt}`
                          : source.error
                      }
                    >
                      {source.year}:{" "}
                      {source.status === "ready"
                        ? `${fmtNum(source.year === annual.year ? annual.coverage.current.historical : annual.coverage.previous.historical)} ${A ? "ليد في الفترة" : "period leads"} · ${fmtNum(source.year === annual.year ? annual.coverage.current.inventory : annual.coverage.previous.inventory)} Inventory`
                        : source.status === "refreshing"
                          ? A
                            ? "جارٍ تحميل الأرشيف"
                            : "Loading archive"
                          : A
                            ? "المصدر غير متاح"
                            : "Source unavailable"}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {!comparable?.crm && (
            <Card className="border-amber-border bg-amber-surface/40">
              <div className="flex gap-2">
                <CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-ink" />
                <div>
                  <div className="text-sm font-bold text-text">
                    {A
                      ? "مقارنة CRM بالسنة الماضية غير مكتملة"
                      : "Prior-year CRM comparison is incomplete"}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">
                    {annual.previousYear < 2024
                      ? A
                        ? `أرشيف ${annual.previousYear} غير مربوط في هذه الصفحة؛ نعرض ${annual.year} وحدها ولا نفترض أن السنة السابقة صفر.`
                        : `${annual.previousYear} CRM history is not connected on this page; ${annual.year} remains visible without treating the previous year as zero.`
                      : A
                        ? `مقارنة الليدز مع ${annual.previousYear} معلّقة حتى يكتمل سحب Odoo التاريخي وتتوفر تغطية كافية. المتاح: ${fmtNum(annual.coverage.previous.historical)} تاريخي، منها ${fmtNum(annual.coverage.previous.inventory)} في Inventory. لا نعتبر البيانات الناقصة صفرًا.`
                        : `Lead comparison with ${annual.previousYear} is withheld until the historical Odoo pull is ready and coverage is sufficient. Available: ${fmtNum(annual.coverage.previous.historical)} historical, including ${fmtNum(annual.coverage.previous.inventory)} in Inventory. Missing history is not treated as zero.`}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {laggingSources.length > 0 && (
            <Card className="border-amber-border bg-amber-surface/40">
              <div className="flex gap-2">
                <CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-ink" />
                <p className="text-xs leading-relaxed text-text-muted">
                  {A
                    ? "الفترة المختارة لم تصل لها كل المصادر بعد؛ الأرقام الحالية جزئية: "
                    : "Some sources have not reached the selected date; current figures are partial: "}
                  {laggingSources.map(([name, date]) => `${name} ${date}`).join(" · ")}
                </p>
              </div>
            </Card>
          )}

          {!lostAvailable && (
            <Card className="border-amber-border bg-amber-surface/40">
              <div className="flex gap-2">
                <CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-ink" />
                <p className="text-xs leading-relaxed text-text-muted">
                  {A
                    ? "مصدر Odoo Lost غير متاح في اللقطة الحالية؛ أخفينا عدد اللوست ونسبته بدل عرضه صفر، وعدد الليدز الحالي جزئي حتى يعود المصدر."
                    : "The Odoo Lost source is unavailable in this snapshot. Lost counts and rates are hidden rather than shown as zero; current lead totals are partial until it returns."}
                </p>
              </div>
            </Card>
          )}

          {(!currentRevenueAvailable || !currentSpendAvailable) && (
            <Card className="border-amber-border bg-amber-surface/40">
              <div className="flex gap-2">
                <CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-ink" />
                <p className="text-xs leading-relaxed text-text-muted">
                  {A
                    ? `لا توجد صفوف مصدر ${!currentRevenueAvailable ? "للتحصيل" : ""}${!currentRevenueAvailable && !currentSpendAvailable ? " أو " : ""}${!currentSpendAvailable ? "للصرف" : ""} في فترة ${annual.year} المختارة؛ أخفينا هذه القيم بدل عرضها صفرًا.`
                    : `No ${!currentRevenueAvailable ? "collection" : ""}${!currentRevenueAvailable && !currentSpendAvailable ? " or " : ""}${!currentSpendAvailable ? "spend" : ""} source rows are available in the selected ${annual.year} window; these values are hidden rather than shown as zero.`}
                </p>
              </div>
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {MONTHLY_MEASURES.map((measure) => (
              <YearMetric
                key={measure}
                measure={measure}
                current={annual.current}
                previous={annual.previous}
                comparable={
                  measure === "revenue"
                    ? comparable!.revenue
                    : measure === "spend"
                      ? comparable!.spend
                      : comparable!.crm
                }
                previousYear={annual.previousYear}
                lang={lang}
                currentAvailable={
                  measure === "revenue"
                    ? currentRevenueAvailable
                    : measure === "spend"
                      ? currentSpendAvailable
                      : currentLeadsReady && (measure !== "lost" || lostAvailable)
                }
              />
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.2fr_.8fr]">
            <Card>
              <SectionTitle
                hint={
                  A
                    ? "من ليدز فترة الإنشاء نفسها؛ Lost يتبع تاريخ إنشاء الليد وليس يوم إغلاقه."
                    : "From leads created in the period; Lost follows lead creation, not close date."
                }
              >
                {A ? "مصير الليدز" : "Lead outcomes"}
              </SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                <Outcome
                  label={A ? "إجمالي الليدز" : "All leads"}
                  value={currentLeadsReady ? fmtNum(annual.current.leads) : "—"}
                />
                <Outcome
                  label={A ? "نسبة الإغلاق" : "Won rate"}
                  value={
                    !currentLeadsReady || !lostAvailable || annual.current.wonRate === null
                      ? "—"
                      : fmtPct(annual.current.wonRate, 1)
                  }
                />
                <Outcome
                  label={A ? "نسبة اللوست" : "Lost rate"}
                  value={
                    !currentLeadsReady || !lostAvailable || annual.current.lostRate === null
                      ? "—"
                      : fmtPct(annual.current.lostRate, 1)
                  }
                />
              </div>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-3">
                {currentLeadsReady && lostAvailable && (
                  <div
                    className="bg-mint-strong"
                    style={{ width: `${annual.current.wonRate ?? 0}%` }}
                  />
                )}
                {currentLeadsReady && lostAvailable && (
                  <div
                    className="bg-rose-strong"
                    style={{ width: `${annual.current.lostRate ?? 0}%` }}
                  />
                )}
              </div>
            </Card>
            <Card>
              <SectionTitle
                hint={
                  A
                    ? "التحصيل من فواتير Odoo المدفوعة مقابل إجمالي الإنفاق الإعلاني؛ ليس ROAS منسوبًا للحملات."
                    : "Odoo paid-invoice collections versus all ad spend; not campaign-attributed ROAS."
                }
              >
                {A ? "التحصيل مقابل الصرف" : "Collections versus spend"}
              </SectionTitle>
              <div className="num text-3xl font-black text-text">
                {currentRevenueAvailable && currentSpendAvailable && annual.current.spend > 0
                  ? `${(annual.current.revenue / annual.current.spend).toFixed(2)}×`
                  : "—"}
              </div>
              <p className="mt-2 text-xs text-text-muted">
                {currentRevenueAvailable ? fmtUSDFull(annual.current.revenue) : "—"} ÷{" "}
                {currentSpendAvailable ? fmtUSDFull(annual.current.spend) : "—"}
              </p>
            </Card>
          </div>

          <Card>
            <SectionTitle
              hint={
                A
                  ? "كل صف يقارن نفس الشهر من العامين؛ الشهر الجاري يتوقف عند نفس اليوم."
                  : "Each row compares matching months; the current month stops on the same day in both years."
              }
              action={
                <select
                  aria-label={A ? "مؤشر مقارنة الشهور" : "Monthly comparison metric"}
                  value={monthlyMeasure}
                  onChange={(event) => setMonthlyMeasure(event.target.value as Measure)}
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text"
                >
                  {MONTHLY_MEASURES.map((measure) => (
                    <option key={measure} value={measure}>
                      {metricName(measure, lang)}
                    </option>
                  ))}
                </select>
              }
            >
              {A ? "مقارنة الشهور" : "Monthly comparison"}
            </SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[740px] table-fixed text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-text-muted">
                    <th className="w-[16%] px-2 py-2 text-start">{A ? "الشهر" : "Month"}</th>
                    <th className="w-[20%] px-2 py-2 text-end">{annual.year}</th>
                    <th className="w-[20%] px-2 py-2 text-end">{annual.previousYear}</th>
                    <th className="w-[18%] px-2 py-2 text-end">{A ? "الفرق" : "Difference"}</th>
                    <th className="w-[16%] px-2 py-2 text-end">{A ? "التغير" : "Change"}</th>
                    <th className="w-[10%] px-2 py-2 text-end">{A ? "تغطية" : "Scope"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {annual.months.map((row) => {
                    const ok =
                      monthlyMeasure === "revenue"
                        ? comparable!.revenue
                        : monthlyMeasure === "spend"
                          ? comparable!.spend
                          : comparable!.crm && (monthlyMeasure !== "lost" || lostAvailable);
                    const currentAvailable =
                      monthlyMeasure === "revenue"
                        ? currentRevenueAvailable
                        : monthlyMeasure === "spend"
                          ? currentSpendAvailable
                          : currentLeadsReady && (monthlyMeasure !== "lost" || lostAvailable);
                    const current = row.current[monthlyMeasure];
                    const previous = row.previous[monthlyMeasure];
                    const maximum = Math.max(
                      ...annual.months.map((item) => item.current[monthlyMeasure]),
                      1,
                    );
                    return (
                      <tr key={row.month} className="hover:bg-surface-2/60">
                        <td className="px-2 py-3 font-semibold text-text">
                          {MONTHS[lang][row.month - 1]}
                        </td>
                        <td className="px-2 py-3 text-end">
                          <div className="num font-bold text-text">
                            {currentAvailable ? moneyOrNumber(monthlyMeasure, current) : "—"}
                          </div>
                          <div className="ms-auto mt-1 h-1.5 max-w-32 rounded-full bg-surface-3">
                            <div
                              className="h-full rounded-full bg-brand"
                              style={{ width: `${Math.max(0, current / maximum) * 100}%` }}
                            />
                          </div>
                        </td>
                        <td className="num px-2 py-3 text-end text-text-muted">
                          {ok && currentAvailable ? moneyOrNumber(monthlyMeasure, previous) : "—"}
                        </td>
                        <td className="num px-2 py-3 text-end">
                          {ok && currentAvailable
                            ? moneyOrNumber(monthlyMeasure, current - previous)
                            : "—"}
                        </td>
                        <td className="px-2 py-3 text-end">
                          <Change
                            current={current}
                            previous={previous}
                            comparable={ok && currentAvailable}
                            invert={monthlyMeasure === "spend" || monthlyMeasure === "lost"}
                          />
                        </td>
                        <td className="num px-2 py-3 text-end text-[11px] text-text-muted">
                          {row.month === annual.throughMonth && annual.partialMonth
                            ? `${row.throughDay} ${A ? "يوم" : "days"}`
                            : A
                              ? "كامل"
                              : "Full"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <SectionTitle
              hint={
                A
                  ? "المبيعات من فواتير Odoo المدفوعة، الليدز واللوست من CRM، والصرف من بيانات المنصات."
                  : "Paid Odoo invoices, CRM lead/lost cohorts, and platform spend."
              }
              action={
                <input
                  value={courseQuery}
                  onChange={(event) => setCourseQuery(event.target.value)}
                  placeholder={A ? "ابحث عن دورة" : "Search courses"}
                  aria-label={A ? "ابحث عن دورة" : "Search courses"}
                  className="w-36 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text sm:w-44"
                />
              }
            >
              {A ? "تفصيل كل دورة" : "Course breakdown"}
            </SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-xs">
                <thead>
                  <tr className="border-b border-border text-text-muted">
                    <th className="px-2 py-2 text-start">{A ? "الدورة" : "Course"}</th>
                    <th className="px-2 py-2 text-end">{A ? "المبيعات" : "Revenue"}</th>
                    <th className="px-2 py-2 text-end">{`${annual.previousYear} ${A ? "مبيعات" : "revenue"}`}</th>
                    <th className="px-2 py-2 text-end">{A ? "التغير" : "Change"}</th>
                    <th className="px-2 py-2 text-end">{A ? "الصرف" : "Spend"}</th>
                    <th className="px-2 py-2 text-end">{A ? "الليدز" : "Leads"}</th>
                    <th className="px-2 py-2 text-end">Won</th>
                    <th className="px-2 py-2 text-end">Lost</th>
                    <th className="px-2 py-2 text-end">{A ? "نسبة الإغلاق" : "Won rate"}</th>
                    <th className="px-2 py-2 text-end">{A ? "نسبة اللوست" : "Lost rate"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {courses.map((row) => (
                    <tr key={row.name} className="hover:bg-surface-2/60">
                      <td
                        className="max-w-40 truncate px-2 py-3 font-semibold text-text"
                        title={row.name}
                      >
                        {row.name}
                      </td>
                      <td className="num px-2 py-3 text-end font-bold text-text">
                        {currentRevenueAvailable ? fmtUSDFull(row.current.revenue) : "—"}
                      </td>
                      <td className="num px-2 py-3 text-end text-text-muted">
                        {comparable!.revenue ? fmtUSDFull(row.previous.revenue) : "—"}
                      </td>
                      <td className="px-2 py-3 text-end">
                        <Change
                          current={row.current.revenue}
                          previous={row.previous.revenue}
                          comparable={comparable!.revenue}
                        />
                      </td>
                      <td className="num px-2 py-3 text-end">
                        {currentSpendAvailable ? fmtUSDFull(row.current.spend) : "—"}
                      </td>
                      <td className="num px-2 py-3 text-end">
                        {currentLeadsReady ? fmtNum(row.current.leads) : "—"}
                      </td>
                      <td className="num px-2 py-3 text-end">
                        {currentLeadsReady ? fmtNum(row.current.won) : "—"}
                      </td>
                      <td className="num px-2 py-3 text-end">
                        {currentLeadsReady && lostAvailable ? fmtNum(row.current.lost) : "—"}
                      </td>
                      <td className="num px-2 py-3 text-end">
                        {!currentLeadsReady || !lostAvailable || row.current.wonRate === null
                          ? "—"
                          : fmtPct(row.current.wonRate, 1)}
                      </td>
                      <td className="num px-2 py-3 text-end">
                        {!currentLeadsReady || !lostAvailable || row.current.lostRate === null
                          ? "—"
                          : fmtPct(row.current.lostRate, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {courses.length === 0 && (
              <p className="py-6 text-center text-xs text-text-muted">
                {A ? "لا توجد دورة مطابقة" : "No matching course"}
              </p>
            )}
          </Card>

          <Card className="border-dashed">
            <SectionTitle>
              {A ? "مصدر الأرقام وحدود المقارنة" : "Sources and comparison limits"}
            </SectionTitle>
            <div className="grid gap-2 text-xs text-text-muted sm:grid-cols-3">
              <div>
                Odoo CRM / Lost / Historical (Inventory): {fmtNum(annual.coverage.current.crm)} /{" "}
                {lostAvailable ? fmtNum(annual.coverage.current.lost) : "—"} /{" "}
                {fmtNum(annual.coverage.current.historical)} (
                {fmtNum(annual.coverage.current.inventory)}) · {data.health.crmAuthority}
              </div>
              <div>
                {A ? "فواتير Odoo المدفوعة" : "Odoo paid invoices"}:{" "}
                {fmtNum(annual.coverage.current.accounting)} · {data.health.accountingAuthority}
              </div>
              <div>
                {A ? "صفوف الإنفاق الإعلاني" : "Ad spend rows"}:{" "}
                {fmtNum(annual.coverage.current.ads)}
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
              {A
                ? `آخر تواريخ المصدر: الإعلانات ${data.sourceDates.ads || "—"}، CRM ${data.sourceDates.crm || "—"}، التحصيل ${data.sourceDates.revenue || "—"}. نسب Won/Lost تخص مجموعة الليدز المنشأة في الفترة، والمبيعات تخص تاريخ الدفع؛ ليست نفس cohort البيعي.`
                : `Source max dates: ads ${data.sourceDates.ads || "—"}, CRM ${data.sourceDates.crm || "—"}, collections ${data.sourceDates.revenue || "—"}. Won/Lost rates use the lead-creation cohort, while revenue uses payment date; these are not the same sales cohort.`}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function Outcome({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="num mt-1 text-lg font-black text-text">{value}</div>
    </div>
  );
}
