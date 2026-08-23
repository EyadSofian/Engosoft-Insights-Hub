import { useEffect, useMemo, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  Gauge,
  Target,
  TrendingDown,
  Trophy,
  Users,
} from "lucide-react";
import { HBarChart, MultiLineChart } from "@/components/charts";
import { DataTable, type Col } from "@/components/DataTable";
import {
  Card,
  ErrorState,
  KpiCard,
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/constants";
import { buildQuery, filterStore, useFilters } from "@/lib/filter-store";
import { fmtDate, fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import type { Maybe, Platform } from "@/lib/types";
import type { WeekendDayKey, WeekendDecision } from "@/lib/weekend-analysis";

export const Route = createFileRoute("/weekend")({ component: WeekendPerformance });

interface WeekendMetrics {
  spend: number;
  avgDailySpend: number;
  avgActiveDaySpend: Maybe;
  leads: number;
  leadsPerDay: number;
  won: number;
  lost: number;
  open: number;
  cpl: Maybe;
  salesRate: Maybe;
  lostRate: Maybe;
  platformLeads: Maybe;
  platformCpl: Maybe;
  reportedDays: number;
  spendDays: number;
  calendarDays: number;
}

interface WeekendPlatformRow {
  platform: Platform;
  weekend: WeekendMetrics;
  comparison: WeekendMetrics;
  decision: WeekendDecision;
  cplDelta: Maybe;
  salesRateDelta: Maybe;
  lostRateDelta: Maybe;
  dailySpendDelta: Maybe;
  hasSpendData: boolean;
  dataFrom: string;
  dataTo: string;
  efficiencyRank: number | null;
  qualityRank: number | null;
  overallRank: number | null;
}

interface WeekendDayRow extends WeekendMetrics {
  platform: Platform;
  day: WeekendDayKey;
}

interface WeekendResponse {
  window: {
    from: string;
    to: string;
    weeks: number;
    weekendDays: number;
    comparisonDays: number;
  };
  platforms: WeekendPlatformRow[];
  dayRows: WeekendDayRow[];
  weekly: Record<string, string | number | null>[];
  portfolio: {
    weekend: WeekendMetrics;
    comparison: WeekendMetrics;
    cplDelta: Maybe;
    salesRateDelta: Maybe;
    lostRateDelta: Maybe;
  };
  budgetPlan: {
    decision: "full" | "selective" | "reallocate" | "insufficient";
    bestPlatform: Platform | null;
    reducePlatforms: Platform[];
    selectivePlatforms: Platform[];
    insufficientPlatforms: Platform[];
  };
  methodology: {
    lostSource: string;
    salesDefinition: string;
  };
}

const DAY_LABEL: Record<WeekendDayKey, { ar: string; en: string }> = {
  thursday: { ar: "الخميس", en: "Thursday" },
  friday: { ar: "الجمعة", en: "Friday" },
  saturday: { ar: "السبت", en: "Saturday" },
};

function labelPlatform(platform: Platform, lang: "ar" | "en") {
  return PLATFORM_LABEL[platform][lang];
}

function decisionCopy(decision: WeekendDecision, lang: "ar" | "en") {
  const copy = {
    full: {
      ar: { label: "ميزانية كاملة", tone: "success" as const },
      en: { label: "Full budget", tone: "success" as const },
    },
    reallocate: {
      ar: { label: "إعادة توزيع", tone: "warning" as const },
      en: { label: "Reallocate", tone: "warning" as const },
    },
    reduce: {
      ar: { label: "تخفيض", tone: "danger" as const },
      en: { label: "Reduce", tone: "danger" as const },
    },
    insufficient: {
      ar: { label: "بيانات غير كافية", tone: "neutral" as const },
      en: { label: "Insufficient data", tone: "neutral" as const },
    },
  };
  return copy[decision][lang];
}

function formatPoints(value: Maybe, lang: "ar" | "en") {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} ${lang === "ar" ? "نقطة" : "pp"}`;
}

function Change({
  value,
  cost = false,
  points = false,
  lang,
}: {
  value: Maybe;
  cost?: boolean;
  points?: boolean;
  lang: "ar" | "en";
}) {
  if (value === null) return <span className="text-text-subtle">—</span>;
  const flat = Math.abs(value) < 0.05;
  const good = flat ? null : cost ? value < 0 : value > 0;
  const Icon = flat ? null : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className="num inline-flex items-center gap-1 text-[11px] font-semibold"
      style={{
        color: good === null ? "var(--text-muted)" : good ? "var(--success)" : "var(--danger)",
      }}
    >
      {Icon && <Icon size={13} strokeWidth={2.5} />}
      {points ? formatPoints(value, lang) : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`}
    </span>
  );
}

function WeekendPerformance() {
  const { t, lang } = useI18n();
  const filters = useFilters();
  const query = buildQuery(filters);
  const { data, isLoading, error, refetch } = useQuery<WeekendResponse>({
    queryKey: ["weekend-performance", query],
    queryFn: async () => {
      const response = await fetch(`/api/weekend${query}`);
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return response.json();
    },
    staleTime: 5 * 60_000,
  });

  // This report deliberately compares the whole paid portfolio. A stale course,
  // campaign or platform selection would make that fixed scope look incomplete.
  useEffect(() => {
    const current = filterStore.get();
    if (
      current.platform ||
      current.channel ||
      current.account ||
      current.campaign ||
      current.adset ||
      current.ad ||
      current.source ||
      current.course ||
      current.mainCategory ||
      current.salesTeam ||
      current.salesperson ||
      current.company
    ) {
      filterStore.resetDimensions();
    }
  }, []);

  // Keep the global date control honest: the page always studies eight complete
  // weeks and never labels a partial current weekend as part of the sample.
  useEffect(() => {
    if (data && (filters.from !== data.window.from || filters.to !== data.window.to)) {
      filterStore.setDates(data.window.from, data.window.to);
    }
  }, [data, filters.from, filters.to]);

  const dayWinners = useMemo(() => {
    const result = new Map<Platform, WeekendDayKey>();
    if (!data) return result;
    for (const platform of data.platforms.map((row) => row.platform)) {
      const rows = data.dayRows
        .filter((row) => row.platform === platform && row.leads > 0 && row.cpl !== null)
        .sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity));
      if (rows[0]) result.set(platform, rows[0].day);
    }
    return result;
  }, [data]);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title={lang === "ar" ? "أداء الحملات خلال الويك إند" : "Weekend campaign performance"}
        subtitle={
          lang === "ar"
            ? "تحليل آخر 8 أسابيع مكتملة للخميس والجمعة والسبت، مقارنةً بالأحد إلى الأربعاء لكل منصة."
            : "The last 8 complete weeks across Thursday, Friday and Saturday, benchmarked against Sunday–Wednesday per platform."
        }
      />

      {isLoading || !data ? (
        <WeekendSkeleton />
      ) : (
        <>
          <BudgetSignal data={data} lang={lang} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard
              label={lang === "ar" ? "متوسط الصرف اليومي" : "Average daily spend"}
              value={fmtUSD(data.portfolio.weekend.avgDailySpend)}
              sub={lang === "ar" ? "عبر 24 يوم ويك إند" : "Across 24 weekend days"}
              icon={<CircleDollarSign size={18} />}
              index={0}
            />
            <KpiCard
              label={t("crm_leads")}
              value={fmtNum(data.portfolio.weekend.leads)}
              sub={`${fmtNum(data.portfolio.weekend.leadsPerDay)} ${lang === "ar" ? "ليد/يوم" : "leads/day"}`}
              icon={<Users size={18} />}
              index={1}
            />
            <KpiCard
              label={t("cpl")}
              value={fmtUSDFull(data.portfolio.weekend.cpl)}
              delta={data.portfolio.cplDelta ?? undefined}
              deltaInvert
              sub={lang === "ar" ? "مقابل الأحد–الأربعاء" : "vs Sunday–Wednesday"}
              icon={<Gauge size={18} />}
              index={2}
            />
            <KpiCard
              label={lang === "ar" ? "نسبة المبيعات (Won)" : "Sales rate (Won)"}
              value={fmtPct(data.portfolio.weekend.salesRate, 1)}
              sub={`${fmtNum(data.portfolio.weekend.won)} ${lang === "ar" ? "صفقة من نفس الليدز" : "won from the same leads"}`}
              icon={<Target size={18} />}
              index={3}
            />
            <KpiCard
              label={t("lost_rate")}
              value={fmtPct(data.portfolio.weekend.lostRate, 1)}
              sub={`${fmtNum(data.portfolio.weekend.lost)} ${lang === "ar" ? "ليد Lost مؤكد" : "confirmed Lost leads"}`}
              icon={<TrendingDown size={18} />}
              index={4}
            />
          </div>

          <section>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "كل منصة مقارنة بأدائها هي نفسها من الأحد إلى الأربعاء خلال نفس الفترة."
                  : "Each platform is benchmarked against its own Sunday–Wednesday performance in the same period."
              }
            >
              {lang === "ar" ? "قرار الميزانية لكل منصة" : "Budget decision by platform"}
            </SectionTitle>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {data.platforms.map((row) => (
                <PlatformDecisionCard
                  key={row.platform}
                  row={row}
                  bestDay={dayWinners.get(row.platform)}
                  bestPlatform={data.budgetPlan.bestPlatform}
                  lang={lang}
                />
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle hint={lang === "ar" ? "الأقل أفضل" : "Lower is better"}>
                {lang === "ar" ? "كفاءة الصرف — CPL" : "Spend efficiency — CPL"}
              </SectionTitle>
              <HBarChart
                data={data.platforms
                  .filter((row) => row.weekend.cpl !== null)
                  .map((row) => ({
                    label: labelPlatform(row.platform, lang),
                    value: row.weekend.cpl ?? 0,
                  }))}
                format={fmtUSDFull}
                name={t("cpl")}
                showValues
                color="var(--warning)"
              />
            </Card>
            <Card>
              <SectionTitle
                hint={
                  lang === "ar" ? "Won من إجمالي ليدز الويك إند" : "Won as a share of weekend leads"
                }
              >
                {lang === "ar" ? "جودة الليد — نسبة المبيعات" : "Lead quality — sales rate"}
              </SectionTitle>
              <HBarChart
                data={data.platforms
                  .filter((row) => row.weekend.salesRate !== null)
                  .map((row) => ({
                    label: labelPlatform(row.platform, lang),
                    value: row.weekend.salesRate ?? 0,
                  }))}
                format={(value) => fmtPct(value, 1)}
                name={lang === "ar" ? "نسبة المبيعات" : "Sales rate"}
                showValues
                color="var(--success)"
              />
            </Card>
          </div>

          <PlatformComparison data={data} lang={lang} />

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <SectionTitle
                hint={
                  lang === "ar"
                    ? "تغيّر CPL عبر كل ويك إند؛ الفراغ يعني عدم وجود ليدز لذلك الأسبوع."
                    : "Weekend CPL by week; a gap means no leads were recorded that week."
                }
              >
                {lang === "ar" ? "ثبات الأداء خلال 8 أسابيع" : "Eight-week consistency"}
              </SectionTitle>
              <MultiLineChart
                data={data.weekly.map(
                  (point) =>
                    Object.fromEntries(
                      Object.entries(point).filter(
                        ([key, value]) =>
                          key === "date" || (key.endsWith("Cpl") && typeof value === "number"),
                      ),
                    ) as Record<string, string | number>,
                )}
                series={data.platforms.map((row) => ({
                  key: `${row.platform}Cpl`,
                  name: labelPlatform(row.platform, lang),
                  color: PLATFORM_COLOR[row.platform],
                }))}
                format={fmtUSDFull}
                height={300}
              />
            </Card>
            <DayBreakdown rows={data.dayRows} lang={lang} />
          </div>

          <Methodology data={data} lang={lang} />
        </>
      )}
    </div>
  );
}

function BudgetSignal({ data, lang }: { data: WeekendResponse; lang: "ar" | "en" }) {
  const plan = data.budgetPlan;
  const copy = {
    full: {
      label: lang === "ar" ? "استمر بالميزانية الكاملة" : "Keep the full budget",
      note:
        lang === "ar"
          ? "المنصات المقاسة تحافظ على كفاءة الصرف وجودة الليدز خلال الويك إند."
          : "Measured platforms preserve spend efficiency and lead quality on weekends.",
      tone: "success" as const,
      color: "var(--success)",
      soft: "var(--success-soft)",
    },
    selective: {
      label: lang === "ar" ? "شغّل بانتقائية حسب المنصة" : "Run selectively by platform",
      note:
        lang === "ar"
          ? "لا تعمم قرارًا واحدًا؛ ثبّت القوي وراجع المنصات غير الحاسمة."
          : "Do not apply one blanket decision; protect strong platforms and review uncertain ones.",
      tone: "warning" as const,
      color: "var(--warning)",
      soft: "var(--warning-soft)",
    },
    reallocate: {
      label: lang === "ar" ? "خفّض وأعد توزيع الميزانية" : "Reduce and reallocate budget",
      note:
        lang === "ar"
          ? "هناك منصة واحدة على الأقل تتراجع بوضوح؛ انقل الجزء المخفّض إلى الأفضل أداءً."
          : "At least one platform deteriorates materially; move its reduced share to the best performer.",
      tone: "danger" as const,
      color: "var(--danger)",
      soft: "var(--danger-soft)",
    },
    insufficient: {
      label: lang === "ar" ? "لا تتخذ قرار ميزانية الآن" : "Do not change budget yet",
      note:
        lang === "ar"
          ? "بيانات الإنفاق أو Lost أو حجم العينة غير كافية لإصدار قرار موثوق."
          : "Spend, Lost data or sample size is insufficient for a reliable decision.",
      tone: "neutral" as const,
      color: "var(--text-muted)",
      soft: "var(--surface-2)",
    },
  }[plan.decision];

  return (
    <Card
      className="relative overflow-hidden"
      style={{
        background: `linear-gradient(125deg, ${copy.soft}, var(--surface) 58%)`,
        borderColor: `color-mix(in oklab, ${copy.color} 32%, var(--border))`,
      }}
    >
      <div
        className="pointer-events-none absolute -start-12 -top-16 h-44 w-44 rounded-full opacity-25 blur-3xl"
        style={{ background: copy.color }}
      />
      <div className="relative grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Pill tone={copy.tone}>{lang === "ar" ? "قرار الويك إند" : "Weekend decision"}</Pill>
            <span className="num text-[11px] text-text-muted">
              {fmtDate(data.window.from, lang)} — {fmtDate(data.window.to, lang)}
            </span>
          </div>
          <h2 className="text-xl font-semibold text-text sm:text-2xl">{copy.label}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">{copy.note}</p>
          {plan.bestPlatform && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-surface/80 px-3 py-2 text-xs">
              <Trophy size={16} style={{ color: "var(--warning)" }} />
              <span className="text-text-muted">
                {lang === "ar" ? "الأفضل إجمالًا:" : "Best overall:"}
              </span>
              <strong>{labelPlatform(plan.bestPlatform, lang)}</strong>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 lg:min-w-[310px]">
          <SignalStat value="8" label={lang === "ar" ? "أسابيع" : "weeks"} />
          <SignalStat value="24" label={lang === "ar" ? "يوم ويك إند" : "weekend days"} />
          <SignalStat value="32" label={lang === "ar" ? "يوم مقارنة" : "baseline days"} />
        </div>
      </div>
    </Card>
  );
}

function SignalStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/85 p-3 text-center shadow-sm">
      <div className="num text-xl font-semibold text-text">{value}</div>
      <div className="mt-1 text-[10px] leading-tight text-text-muted">{label}</div>
    </div>
  );
}

function PlatformDecisionCard({
  row,
  bestDay,
  bestPlatform,
  lang,
}: {
  row: WeekendPlatformRow;
  bestDay?: WeekendDayKey;
  bestPlatform: Platform | null;
  lang: "ar" | "en";
}) {
  const decision = decisionCopy(row.decision, lang);
  const evidence: string[] = [];
  if (row.cplDelta !== null)
    evidence.push(
      `${lang === "ar" ? "CPL" : "CPL"} ${row.cplDelta >= 0 ? "+" : ""}${row.cplDelta.toFixed(1)}%`,
    );
  if (row.salesRateDelta !== null)
    evidence.push(
      `${lang === "ar" ? "المبيعات" : "sales"} ${formatPoints(row.salesRateDelta, lang)}`,
    );
  if (row.lostRateDelta !== null)
    evidence.push(`${lang === "ar" ? "Lost" : "Lost"} ${formatPoints(row.lostRateDelta, lang)}`);

  let recommendation =
    lang === "ar"
      ? "بيانات الصرف أو Lost أو حجم العينة لا تكفي لتغيير الميزانية."
      : "Spend, Lost data or sample size is insufficient for a budget change.";
  if (row.decision === "full")
    recommendation =
      lang === "ar" ? "استمر مع مراقبة CPL أسبوعيًا." : "Continue and monitor CPL weekly.";
  if (row.decision === "reallocate")
    recommendation = bestDay
      ? lang === "ar"
        ? `ثبّت جزءًا أكبر في ${DAY_LABEL[bestDay].ar} واختبر باقي الأيام بميزانية أقل.`
        : `Weight ${DAY_LABEL[bestDay].en} more heavily and test the other days at lower budget.`
      : lang === "ar"
        ? "أعد توزيع الميزانية داخل الويك إند تدريجيًا."
        : "Reallocate weekend budget gradually.";
  if (row.decision === "reduce")
    recommendation =
      bestPlatform && bestPlatform !== row.platform
        ? lang === "ar"
          ? `خفّضها وانقل الجزء المحرر إلى ${labelPlatform(bestPlatform, lang)}.`
          : `Reduce it and move the released share to ${labelPlatform(bestPlatform, lang)}.`
        : lang === "ar"
          ? "خفّضها تدريجيًا مع اختبار أسبوعي مضبوط."
          : "Reduce gradually with a controlled weekly test.";

  return (
    <Card hoverable className="flex min-h-[300px] flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="h-9 w-1.5 rounded-full"
            style={{ background: PLATFORM_COLOR[row.platform] }}
          />
          <div>
            <h3 className="font-semibold text-text">{labelPlatform(row.platform, lang)}</h3>
            <p className="num mt-0.5 text-[10px] text-text-muted">
              {row.overallRank
                ? `#${row.overallRank} ${lang === "ar" ? "إجمالًا" : "overall"}`
                : lang === "ar"
                  ? "غير مصنّف"
                  : "Unranked"}
            </p>
          </div>
        </div>
        <Pill tone={decision.tone}>{decision.label}</Pill>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4">
        <Fact
          label={lang === "ar" ? "الصرف/يوم" : "Spend/day"}
          value={fmtUSD(row.hasSpendData ? row.weekend.avgDailySpend : null)}
        />
        <Fact label={lang === "ar" ? "الليدز" : "Leads"} value={fmtNum(row.weekend.leads)} />
        <Fact label="CPL" value={fmtUSDFull(row.weekend.cpl)} />
        <Fact
          label={lang === "ar" ? "المبيعات" : "Sales"}
          value={fmtPct(row.weekend.salesRate, 1)}
        />
        <Fact label="Lost" value={fmtPct(row.weekend.lostRate, 1)} />
        <Fact
          label={lang === "ar" ? "تغطية الصرف" : "Spend coverage"}
          value={`${fmtNum(row.weekend.reportedDays)}/24`}
        />
      </div>
      <div className="mt-5 border-t border-border pt-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-text-subtle">
          {lang === "ar" ? "مقابل باقي الأسبوع" : "vs rest of week"}
        </p>
        <p className="num mt-1.5 text-xs text-text-muted">{evidence.join(" · ") || "—"}</p>
      </div>
      <p className="mt-auto pt-4 text-xs leading-relaxed text-text-muted">{recommendation}</p>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className="num mt-0.5 text-sm font-semibold text-text">{value}</div>
    </div>
  );
}

function PlatformComparison({ data, lang }: { data: WeekendResponse; lang: "ar" | "en" }) {
  const cols: Col<WeekendPlatformRow>[] = [
    {
      key: "platform",
      header: lang === "ar" ? "المنصة" : "Platform",
      label: lang === "ar" ? "المنصة" : "Platform",
      always: true,
      sticky: true,
      minWidth: "130px",
      render: (row) => (
        <span className="inline-flex items-center gap-2 font-semibold">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: PLATFORM_COLOR[row.platform] }}
          />
          {labelPlatform(row.platform, lang)}
        </span>
      ),
      sortValue: (row) => row.platform,
    },
    {
      key: "avgSpend",
      header: lang === "ar" ? "صرف/يوم" : "Spend/day",
      group: "weekend",
      align: "right",
      render: (row) => fmtUSD(row.hasSpendData ? row.weekend.avgDailySpend : null),
      sortValue: (row) => row.weekend.avgDailySpend,
    },
    {
      key: "leads",
      header: lang === "ar" ? "الليدز" : "Leads",
      group: "weekend",
      align: "right",
      render: (row) => fmtNum(row.weekend.leads),
      sortValue: (row) => row.weekend.leads,
    },
    {
      key: "cpl",
      header: "CPL",
      group: "weekend",
      align: "right",
      render: (row) => fmtUSDFull(row.weekend.cpl),
      sortValue: (row) => row.weekend.cpl ?? Infinity,
    },
    {
      key: "lostRate",
      header: "Lost",
      group: "weekend",
      align: "right",
      render: (row) => fmtPct(row.weekend.lostRate, 1),
      sortValue: (row) => row.weekend.lostRate ?? Infinity,
    },
    {
      key: "salesRate",
      header: lang === "ar" ? "المبيعات" : "Sales",
      group: "weekend",
      align: "right",
      render: (row) => fmtPct(row.weekend.salesRate, 1),
      sortValue: (row) => row.weekend.salesRate ?? -Infinity,
    },
    {
      key: "baseCpl",
      header: "CPL",
      group: "baseline",
      align: "right",
      render: (row) => fmtUSDFull(row.comparison.cpl),
      sortValue: (row) => row.comparison.cpl ?? Infinity,
    },
    {
      key: "baseLost",
      header: "Lost",
      group: "baseline",
      align: "right",
      hideByDefault: true,
      render: (row) => fmtPct(row.comparison.lostRate, 1),
      sortValue: (row) => row.comparison.lostRate ?? Infinity,
    },
    {
      key: "baseSales",
      header: lang === "ar" ? "المبيعات" : "Sales",
      group: "baseline",
      align: "right",
      hideByDefault: true,
      render: (row) => fmtPct(row.comparison.salesRate, 1),
      sortValue: (row) => row.comparison.salesRate ?? -Infinity,
    },
    {
      key: "cplDelta",
      header: "Δ CPL",
      group: "change",
      align: "right",
      render: (row) => <Change value={row.cplDelta} cost lang={lang} />,
      sortValue: (row) => row.cplDelta ?? Infinity,
    },
    {
      key: "salesDelta",
      header: lang === "ar" ? "Δ المبيعات" : "Δ sales",
      group: "change",
      align: "right",
      render: (row) => <Change value={row.salesRateDelta} points lang={lang} />,
      sortValue: (row) => row.salesRateDelta ?? -Infinity,
    },
    {
      key: "decision",
      header: lang === "ar" ? "القرار" : "Decision",
      align: "center",
      minWidth: "120px",
      render: (row) => {
        const copy = decisionCopy(row.decision, lang);
        return <Pill tone={copy.tone}>{copy.label}</Pill>;
      },
      sortValue: (row) => row.decision,
    },
  ];

  return (
    <section>
      <SectionTitle
        hint={
          lang === "ar"
            ? "المقارنة المرجعية هي متوسط الأحد إلى الأربعاء لنفس المنصة ونفس الأسابيع."
            : "The baseline is the same platform's Sunday–Wednesday performance in the same weeks."
        }
      >
        {lang === "ar" ? "المقارنة الكاملة بين المنصات" : "Full platform comparison"}
      </SectionTitle>
      <DataTable
        rows={data.platforms}
        cols={cols}
        pageSize={10}
        initialSort={{ key: "cpl", dir: 1 }}
        groupLabels={{
          weekend: lang === "ar" ? "الخميس–السبت" : "Thursday–Saturday",
          baseline: lang === "ar" ? "الأحد–الأربعاء" : "Sunday–Wednesday",
          change: lang === "ar" ? "الفارق" : "Change",
        }}
        columnChooser
        csvFilename="weekend-platform-performance"
        csvRow={(row) => ({
          platform: labelPlatform(row.platform, lang),
          weekend_avg_daily_spend: row.weekend.avgDailySpend,
          weekend_leads: row.weekend.leads,
          weekend_cpl: row.weekend.cpl ?? "",
          weekend_lost_rate: row.weekend.lostRate ?? "",
          weekend_sales_rate: row.weekend.salesRate ?? "",
          baseline_cpl: row.comparison.cpl ?? "",
          cpl_change_pct: row.cplDelta ?? "",
          decision: row.decision,
        })}
      />
    </section>
  );
}

function DayBreakdown({ rows, lang }: { rows: WeekendDayRow[]; lang: "ar" | "en" }) {
  const bestRows = [...rows]
    .filter((row) => row.leads > 0 && row.cpl !== null)
    .sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity));
  return (
    <Card>
      <SectionTitle
        hint={
          lang === "ar" ? "متوسط كل يوم عبر 8 تكرارات" : "Each day's average across 8 occurrences"
        }
      >
        {lang === "ar" ? "الخميس أم الجمعة أم السبت؟" : "Thursday, Friday or Saturday?"}
      </SectionTitle>
      <div className="space-y-2.5">
        {bestRows.map((row, index) => (
          <div
            key={`${row.platform}-${row.day}`}
            className="rounded-xl border border-border bg-surface-2/70 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="num text-[10px] text-text-subtle">#{index + 1}</span>
                <span className="truncate text-xs font-semibold">
                  {labelPlatform(row.platform, lang)}
                </span>
                <Pill>{DAY_LABEL[row.day][lang]}</Pill>
              </div>
              <span className="num text-sm font-semibold">{fmtUSDFull(row.cpl)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
              <span>
                {fmtUSD(row.avgDailySpend)} {lang === "ar" ? "صرف/يوم" : "spend/day"}
              </span>
              <span>
                {fmtNum(row.leads)} {lang === "ar" ? "ليد" : "leads"}
              </span>
              <span>
                {fmtPct(row.salesRate, 1)} {lang === "ar" ? "مبيعات" : "sales"}
              </span>
              <span>{fmtPct(row.lostRate, 1)} Lost</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Methodology({ data, lang }: { data: WeekendResponse; lang: "ar" | "en" }) {
  const lostAvailable = data.methodology.lostSource !== "unavailable";
  return (
    <Card className="border-dashed">
      <div className="flex items-start gap-3">
        <CalendarClock size={20} className="mt-0.5 shrink-0 text-text-subtle" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">
            {lang === "ar" ? "طريقة الحساب" : "Methodology"}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            {lang === "ar"
              ? "الليد يُنسب ليوم إنشائه في Odoo حتى لو أُغلق لاحقًا. Lost مأخوذ من Archived Lost المعتمد لنفس دفعة الإنشاء، ونسبة المبيعات هي Won ÷ إجمالي الليدز؛ لا يتم اختراع ربط محاسبي غير موجود بين الليد والفاتورة. متوسط الصرف اليومي يشمل أيام الصرف الصفري داخل العينة."
              : "A lead is attributed to its Odoo creation day even if it closes later. Lost comes from the authoritative Archived Lost cohort, while sales rate is Won ÷ total leads; no unsupported lead-to-invoice link is invented. Average daily spend includes zero-spend days in the sample."}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-text-subtle">
            {lang === "ar"
              ? "قاعدة Full: CPL لا يسوء بأكثر من 10%، المبيعات لا تنخفض بأكثر من نقطتين، وLost لا ترتفع بأكثر من 3 نقاط مقابل باقي الأسبوع؛ مع حد جودة مطلق لا يقل عن 2% مبيعات ولا يزيد عن 40% Lost."
              : "Full-budget rule: CPL worsens by no more than 10%, sales fall by no more than 2pp, and Lost rises by no more than 3pp versus the baseline; absolute quality must also reach 2% sales with Lost no higher than 40%."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone={lostAvailable ? "success" : "danger"}>
              {lostAvailable
                ? lang === "ar"
                  ? "Lost متاح ومعتمد"
                  : "Authoritative Lost available"
                : lang === "ar"
                  ? "Lost غير متاح"
                  : "Lost unavailable"}
            </Pill>
            <Pill>
              {lang === "ar" ? "الحد الأدنى للقرار: 30 ليد" : "Decision minimum: 30 leads"}
            </Pill>
            <Pill>{lang === "ar" ? "8 أسابيع مكتملة فقط" : "8 complete weeks only"}</Pill>
          </div>
        </div>
      </div>
    </Card>
  );
}

function WeekendSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-72" />
        ))}
      </div>
    </div>
  );
}
