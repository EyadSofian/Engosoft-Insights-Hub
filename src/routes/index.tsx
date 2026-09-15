import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CalendarDays,
  Info,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  Target,
  Receipt,
  TrendingUp,
  Users,
  UsersRound,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { useFilters } from "@/lib/filter-store";
import { fmtCompact, fmtDateTime, fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { ErrorState, FunnelBars, KpiSkeletonGrid, Notice, Skeleton } from "@/components/ui-bits";
import {
  AlertBar,
  DashboardPageHeader,
  DataHealthButton,
  DashboardPanel,
  ExecutiveSummary,
  InsightRow,
  KpiRow,
  PageSection,
  PageSections,
  SyncStatus,
  WorkspaceLinks,
  type DataHealthIssue,
  type WorkspaceLink,
} from "@/components/dashboard-bits";
import { InsightDetailTrigger, MetricDetailTrigger } from "@/components/metric-detail";
import {
  businessSignals,
  insightDetails,
  overviewEfficiencyMetrics,
  overviewMetrics,
  type BusinessSignals,
  type OverviewResp,
} from "@/components/overview-metrics";
import { MultiLineChart } from "@/components/charts";
import { useClosedLoop } from "@/components/acquisition/ClosedLoop";
import { KpiFigure } from "@/components/acquisition/ManagementOverview";
import {
  formatDisplayMoney,
  usdToDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/display-currency";
import { fxRatesFromFilters } from "@/lib/fx-rates";
import type { AgentAnalyticsResult } from "@/lib/agent-analytics.server";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { PLATFORM_LABEL, PLATFORMS, resolveSpendByPlatform } from "@/lib/constants";

export const Route = createFileRoute("/")({ component: Overview });

type TrendGrain = "day" | "week";

interface MoneyPoint extends Record<string, string | number> {
  date: string;
  value: number;
}

/**
 * The funnel stages, named the way the rest of the dashboard names them.
 *
 * Only the stages `/api/overview` actually returns are listed. There is no
 * "qualified" step in that response, so there is no label for one here: a
 * stage nobody measures cannot be drawn, however much a funnel picture wants
 * a middle.
 */
const FUNNEL_LABELS: Record<string, { ar: string; en: string }> = {
  impressions: { ar: "مرات الظهور", en: "Impressions" },
  clicks: { ar: "النقرات", en: "Clicks" },
  platform_leads: { ar: "عملاء من المنصات", en: "Platform leads" },
  crm_leads: { ar: "العملاء المحتملون", en: "CRM leads" },
  won: { ar: "الصفقات الرابحة", en: "Won deals" },
};

function sundayWeekStart(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function moneyTrend(
  rows: OverviewResp["trend"],
  grain: TrendGrain,
  metric: "spend" | "revenue",
): MoneyPoint[] {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const date = grain === "week" ? sundayWeekStart(row.date) : row.date;
    grouped.set(date, (grouped.get(date) ?? 0) + row[metric]);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

/**
 * "أهم حاجة محتاج تعرفها" — the three readings of the period a manager is
 * expected to act on, and nothing else.
 *
 * Every value comes from `businessSignals`, which is unchanged, and each card
 * opens the verdict, the figures behind it and the report it came from, in the
 * same panel every KPI uses.
 *
 * Three cards, deliberately. The strip of supporting facts that used to sit
 * under them — best campaign, top employee, top course — said the same three
 * things the navigation cards at the foot of the page now carry beside the
 * report each one belongs to, so a reader met every one of those names twice
 * before reaching the analysis.
 */
function TodaysInsights({
  signals,
  details,
  lang,
}: {
  signals: BusinessSignals;
  details: ReturnType<typeof insightDetails>;
  lang: "ar" | "en";
}) {
  const course = signals.topCourse;

  return (
    <InsightRow>
      <InsightDetailTrigger
        detail={details.best}
        card={{
          index: 0,
          kind: "best",
          eyebrow: lang === "ar" ? "أحسن نتيجة" : "Best result",
          title: course
            ? lang === "ar"
              ? `كورس ${course.course} حقق أعلى إيراد`
              : `${course.course} produced the most revenue`
            : lang === "ar"
              ? "لا توجد مبيعات دورات مصنفة"
              : "No classified course sales",
          value: course ? fmtUSD(course.revenue) : undefined,
          detail: course
            ? signals.courseTargetShare !== null
              ? `${fmtPct(signals.courseTargetShare, 1)} ${lang === "ar" ? "من التارجت" : "of target"}${signals.targetComplete ? "" : ` · ${lang === "ar" ? "تارجت جزئي" : "partial target"}`}`
              : `${fmtPct(course.contribution, 1)} ${lang === "ar" ? "من إجمالي إيراد الدورات" : "of total course revenue"}`
            : undefined,
          actionLabel: lang === "ar" ? "ليه الكورس ده؟" : "Why this course?",
        }}
      />

      <InsightDetailTrigger
        detail={details.risk}
        card={{
          index: 1,
          kind: "attention",
          eyebrow: lang === "ar" ? "محتاج متابعة" : "Needs attention",
          title: signals.risk.title,
          detail: signals.risk.detail,
          actionLabel: lang === "ar" ? "إيه اللي وصلنا لكده؟" : "What led to this?",
        }}
      />

      <InsightDetailTrigger
        detail={details.decision}
        card={{
          index: 2,
          kind: "opportunity",
          eyebrow: lang === "ar" ? "فرصة وقرار مقترح" : "Opportunity and decision",
          title: signals.decision.title,
          detail: signals.decision.detail,
          actionLabel: lang === "ar" ? "على أي أساس؟" : "On what basis?",
        }}
      />
    </InsightRow>
  );
}

function Overview() {
  // Declares this page to ENGO Nexus, so "حلل الصفحة دي" and "التاب ده"
  // have something to resolve against. Ids and state only — no figures.
  useRegisterNexusView("overview");
  const { t, lang } = useI18n();
  const filters = useFilters();
  const { data, isLoading, error, refetch } = useApi<OverviewResp>("/api/overview");
  const workforce = useApi<AgentAnalyticsResult>("/api/teams");
  // The one headline figure /api/overview does not carry: qualified leads, from
  // the exact-attribution closed loop, shown with that scope in its own words.
  const closedLoop = useClosedLoop();
  const [spendGrain, setSpendGrain] = useState<TrendGrain>("week");
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("USD");
  const business = useMemo(
    () => (data ? businessSignals(data, workforce.data, lang) : null),
    [data, workforce.data, lang],
  );
  // Both drill-down sets are derived from the two responses already on screen,
  // so opening a card costs a render and never a request.
  const metrics = useMemo(
    () => (data ? overviewMetrics({ data, workforce: workforce.data, lang }) : null),
    [data, workforce.data, lang],
  );
  const efficiency = useMemo(
    () => (data ? overviewEfficiencyMetrics({ data, workforce: workforce.data, lang }) : null),
    [data, workforce.data, lang],
  );
  const insights = useMemo(
    () => (data && business ? insightDetails(data, business, workforce.data, lang) : null),
    [data, business, workforce.data, lang],
  );

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (isLoading || !data || !metrics || !efficiency || !insights || !business) {
    return (
      <div className="page-sections">
        <Skeleton className="h-28" />
        <KpiSkeletonGrid count={10} />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const { totals: T, health } = data;
  const spendByPlatform = resolveSpendByPlatform(T);

  // Sparklines are drawn from the same daily series the trend charts use — the
  // response's own numbers, never a curve invented to fill the slot. A metric
  // the API does not return a series for simply has no sparkline.
  const seriesOf = (metric: "spend" | "revenue" | "leads" | "won") =>
    data.trend.length > 1 ? data.trend.map((row) => row[metric]) : undefined;

  const period = filters.from && filters.to ? `${filters.from} → ${filters.to}` : undefined;
  const syncLabel = data.syncedAt
    ? `${lang === "ar" ? "آخر مزامنة" : "Last sync"} · ${fmtDateTime(data.syncedAt, lang)}`
    : undefined;

  // Everything the response knows about its own reliability, restated for a
  // reader who does not work on the pipeline. The internal names stay — they
  // are what an admin needs to fix it — but they live behind a disclosure.
  const healthIssues: DataHealthIssue[] = [];
  if (data.fetchErrors.length) {
    healthIssues.push({
      tone: "danger",
      message:
        lang === "ar"
          ? `${data.fetchErrors.length} من المصادر لم تُحمَّل في هذه الجلسة.`
          : `${data.fetchErrors.length} source(s) failed to load in this session.`,
      impact:
        lang === "ar"
          ? "الأرقام المعروضة لا تشمل هذه المصادر."
          : "The figures shown exclude those sources.",
      technical: data.fetchErrors.join(" · "),
    });
  }
  if (data.staleTabs?.length) {
    healthIssues.push({
      tone: "warning",
      message:
        lang === "ar"
          ? "بعض المصادر لم تُحدَّث بعد، ويتم عرض آخر نسخة ناجحة."
          : "Some sources have not refreshed; the last good copy is shown.",
      impact: lang === "ar" ? "قد تنقص أحدث الصفوف." : "The newest rows may be missing.",
      technical: data.staleTabs.join(" · "),
    });
  }
  // Held onto so the data-health section does not restate it: this exact
  // problem already interrupts the top of the page in its own alert bar, and
  // reading the same warning twice in one screen makes a reader trust neither.
  let spendTabIssue: DataHealthIssue | null = null;
  if (health.platformsWithoutSpendTab?.length) {
    spendTabIssue = {
      tone: "danger",
      message:
        lang === "ar"
          ? "توجد منصات جاءت منها عملاء بدون بيانات إنفاق مقابلة."
          : "Some platforms produced leads with no matching spend data.",
      impact:
        lang === "ar"
          ? "كل نسب الكفاءة تبدو أفضل من الواقع."
          : "Every efficiency ratio reads better than reality.",
      technical: health.platformsWithoutSpendTab
        .map((row) => `${row.platform}: ${fmtNum(row.leads)} leads`)
        .join(" · "),
    };
    healthIssues.push(spendTabIssue);
  }
  if (health.excludedStages?.length) {
    healthIssues.push({
      tone: "warning",
      message:
        lang === "ar"
          ? "صفوف مستبعدة من الحساب حسب سياسة المراحل المعتمدة."
          : "Some rows are excluded from the calculation by the approved stage policy.",
      technical: health.excludedStages
        .map((row) => `${row.stage}: ${fmtNum(row.rows)}`)
        .join(" · "),
    });
  }
  if (T.lostArchived > 0) {
    healthIssues.push({
      tone: "info",
      message:
        lang === "ar"
          ? "الصفقات الضائعة مصنفة بعقد CRM 1.26 المعتمد."
          : "Lost deals follow the approved CRM 1.26 contract.",
      technical:
        lang === "ar"
          ? `Lost: ${fmtNum(T.lostArchived)} حالة. Lost Lead = مؤرشف ومعه Lost Reason؛ Lost Opportunity = داخل Lost stage، مع إضافة التاريخ المؤرشف.`
          : `Lost: ${fmtNum(T.lostArchived)} records. Lost Lead = archived with a Lost Reason; Lost Opportunity = in the Lost stage, plus archived history.`,
    });
  }

  // The severity, from what the issues ARE rather than from how many there
  // are. A period that only carries the standing note about the Lost source
  // has nothing wrong with it, and painting the freshness chip amber for it
  // teaches a reader that amber means nothing.
  const blockingIssues = healthIssues.filter(
    (issue) => issue.tone === "danger" && issue !== spendTabIssue,
  );
  const healthTone = blockingIssues.length
    ? "danger"
    : healthIssues.some((issue) => issue.tone === "warning")
      ? "warning"
      : "success";

  const sarRate = fxRatesFromFilters(filters).SAR;
  // One series set for one chart. Both metrics already share a grain and a
  // display currency, so they are converted together rather than each card
  // converting its own copy.
  const money = (n: number) => formatDisplayMoney(n, displayCurrency, lang);
  const combinedTrend = moneyTrend(data.trend, spendGrain, "spend").map((point, index) => ({
    date: point.date,
    spend: usdToDisplayCurrency(point.value, displayCurrency, sarRate) ?? 0,
    revenue:
      usdToDisplayCurrency(
        moneyTrend(data.trend, spendGrain, "revenue")[index]?.value ?? 0,
        displayCurrency,
        sarRate,
      ) ?? 0,
  }));
  const totalSpendShown = combinedTrend.reduce((sum, row) => sum + row.spend, 0);
  const totalRevenueShown = combinedTrend.reduce((sum, row) => sum + row.revenue, 0);

  const links: WorkspaceLink[] = [
    {
      to: "/acquisition",
      title: lang === "ar" ? "التسويق" : "Marketing",
      description:
        lang === "ar"
          ? "الحملات والمواد الإعلانية ومصادر العملاء"
          : "Campaigns, creatives and where leads came from",
      figure: `${fmtUSD(T.spend)} ${lang === "ar" ? "إنفاق" : "spend"}`,
      icon: <Megaphone size={17} />,
      tone: "sky",
    },
    {
      to: "/leads",
      title: lang === "ar" ? "المبيعات والعملاء" : "Sales & CRM",
      description:
        lang === "ar" ? "العملاء والمتابعة والصفقات المفقودة" : "Leads, follow-up and lost deals",
      figure: `${fmtNum(T.totalLeads)} ${lang === "ar" ? "عميل" : "leads"}`,
      icon: <Users size={17} />,
      tone: "violet",
    },
    {
      to: "/accounting",
      title: lang === "ar" ? "الإيرادات" : "Revenue",
      description:
        lang === "ar" ? "التحصيل والفواتير والكورسات" : "Collection, invoices and courses",
      figure: `${fmtUSD(T.revenue)} ${lang === "ar" ? "تحصيل" : "collected"}`,
      icon: <Receipt size={17} />,
      tone: "mint",
    },
    {
      to: "/teams",
      title: lang === "ar" ? "أداء الفريق" : "Team",
      description: lang === "ar" ? "فريق المبيعات والميديا بايرز" : "Sales team and media buyers",
      figure: business.bestEmployee?.name,
      icon: <UsersRound size={17} />,
      tone: "amber",
    },
  ];

  return (
    <div>
      <DashboardPageHeader
        flush
        icon={<LayoutDashboard size={20} />}
        title={lang === "ar" ? "نظرة عامة" : "Overview"}
        subtitle={
          lang === "ar"
            ? "أداء الشركة في الفترة: الإيراد والإنفاق والعملاء والمبيعات"
            : "How the business performed this period: revenue, spend, leads and sales"
        }
        period={period}
        sync={<SyncStatus label={syncLabel} tone={healthTone} />}
        actions={<DataHealthButton issues={healthIssues} syncedLabel={syncLabel} />}
      />

      {/* Only the one class of problem that changes what the figures MEAN may
          interrupt the page: spend that exists but is missing from the
          workbook makes every efficiency ratio look better than it is. */}
      {health.platformsWithoutSpendTab?.length > 0 && (
        <div className="mt-3">
          <AlertBar title={t("missing_spend_tab")}>
            {health.platformsWithoutSpendTab
              .map((p) => `${p.platform}: ${fmtNum(p.leads)} ${lang === "ar" ? "عميلاً" : "leads"}`)
              .join(" · ")}
            {" — "}
            {t("missing_spend_tab_note")}
          </AlertBar>
        </div>
      )}

      <PageSections className="gap-after-header">
        {/* LEVEL 1 — is the company doing well? Six figures, one row. */}
        <PageSection
          level="headline"
          aria-label={lang === "ar" ? "أهم الأرقام" : "Headline figures"}
        >
          <KpiRow>
            <MetricDetailTrigger
              detail={metrics.revenue}
              card={{
                index: 0,
                hero: true,
                spark: seriesOf("revenue"),
                sub:
                  lang === "ar"
                    ? `منه ${fmtUSD(T.attributedRevenue)} مرتبط بحملات`
                    : `${fmtUSD(T.attributedRevenue)} campaign-linked`,
              }}
            />
            <MetricDetailTrigger
              detail={metrics.spend}
              card={{
                index: 1,
                spark: seriesOf("spend"),
                sub: PLATFORMS.map((platform) => ({
                  platform,
                  spend: spendByPlatform[platform],
                }))
                  .filter(({ spend }) => spend > 0)
                  .map(
                    ({ platform, spend }) => `${PLATFORM_LABEL[platform][lang]} ${fmtUSD(spend)}`,
                  )
                  .join(" · "),
              }}
            />
            <MetricDetailTrigger
              detail={metrics.leads}
              card={{
                index: 2,
                spark: seriesOf("leads"),
                sub: `CRM ${fmtNum(T.crmLeads)} + Lost ${fmtNum(T.lost)}`,
              }}
            />
            <KpiFigure
              kpi={closedLoop.data?.kpis?.qualified}
              index={3}
              icon={<Target size={17} />}
              tone="sky"
              loading={closedLoop.isLoading}
              sub={
                lang === "ar"
                  ? "من العملاء المعروف إعلانهم بالضبط"
                  : "Of leads traced to their exact ad"
              }
            />
            <MetricDetailTrigger
              detail={metrics.won}
              card={{
                index: 4,
                spark: seriesOf("won"),
                sub: `${fmtPct(T.conversionRate, 1)} ${lang === "ar" ? "معدل التحويل" : "conversion"}`,
              }}
            />
            <MetricDetailTrigger
              detail={metrics.roas}
              card={{
                index: 5,
                sub:
                  lang === "ar"
                    ? "إجمالي التحصيل ÷ الإنفاق (ليس ROAS إعلانيًا)"
                    : "All revenue ÷ spend (not ad ROAS)",
              }}
            />
          </KpiRow>
          {!data.prevComparable && data.prevRange && (
            <Notice tone="info" icon={<Info size={16} />}>
              {lang === "ar"
                ? `لا تُعرض نسب التغيّر لأن الفترة السابقة (${data.prevRange.from} → ${data.prevRange.to}) تقع قبل بداية البيانات.`
                : `Change percentages are hidden because the previous period (${data.prevRange.from} → ${data.prevRange.to}) falls before the data begins.`}
            </Notice>
          )}
        </PageSection>

        {/* LEVEL 2 — why: one trend and one funnel, side by side. */}
        <PageSection
          level="primary"
          title={lang === "ar" ? "الأداء في الفترة" : "Performance this period"}
        >
          <div className="card-grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <DashboardPanel
              icon={<TrendingUp size={16} />}
              title={lang === "ar" ? "التحصيل مقابل الإنفاق" : "Collection against spend"}
              hint={
                lang === "ar"
                  ? "التحصيل بتاريخ الدفع، والإنفاق بتاريخ الإعلان."
                  : "Collection follows Payment Date; spend follows ad date."
              }
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <GrainToggle value={spendGrain} onChange={setSpendGrain} lang={lang} />
                  <DisplayCurrencyToggle
                    value={displayCurrency}
                    onChange={setDisplayCurrency}
                    sarRate={sarRate}
                    lang={lang}
                  />
                </div>
              }
              footer={
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: "var(--mint-strong)" }}
                      aria-hidden="true"
                    />
                    {lang === "ar" ? "التحصيل" : "Collection"}
                    <b className="num text-text">{money(totalRevenueShown)}</b>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: "var(--rose-strong)" }}
                      aria-hidden="true"
                    />
                    {lang === "ar" ? "الصرف" : "Spend"}
                    <b className="num text-text">{money(totalSpendShown)}</b>
                  </span>
                </span>
              }
            >
              <MultiLineChart
                data={combinedTrend}
                height={280}
                format={money}
                series={[
                  {
                    key: "revenue",
                    name: lang === "ar" ? "التحصيل" : "Collection",
                    color: "var(--mint-strong)",
                  },
                  {
                    key: "spend",
                    name: lang === "ar" ? "الصرف" : "Spend",
                    color: "var(--rose-strong)",
                  },
                ]}
              />
            </DashboardPanel>

            <DashboardPanel
              icon={<Users size={16} />}
              title={lang === "ar" ? "مسار التحويل" : "Conversion funnel"}
              hint={
                lang === "ar" ? "من الظهور للصفقة المقفولة." : "From impression to closed deal."
              }
            >
              <FunnelBars
                steps={data.funnel.map((s) => ({
                  label: FUNNEL_LABELS[s.key]?.[lang] ?? s.key,
                  value: s.value ?? 0,
                  display: s.value === null ? "—" : fmtCompact(s.value),
                }))}
              />
            </DashboardPanel>
          </div>
        </PageSection>

        {/* LEVEL 2 — what is going well and what needs attention. Three. */}
        <PageSection
          level="insight"
          icon={<Lightbulb size={16} />}
          title={lang === "ar" ? "ما يحتاج انتباهك" : "What needs attention"}
        >
          <TodaysInsights signals={business} details={insights} lang={lang} />
        </PageSection>

        <PageSection level="records" title={lang === "ar" ? "اذهب للتفاصيل" : "Go deeper"}>
          <WorkspaceLinks links={links} />
        </PageSection>

        {/* The period's written read. Three lines, and the last thing on the
            page: everything heavier now lives in the report it belongs to —
            campaign records under Campaigns, CRM efficiency under Leads,
            course contribution under Courses, bot status under Data coverage. */}
        <ExecutiveSummary title={t("exec_summary")}>
          {lang === "ar" ? data.summary.ar : data.summary.en}
        </ExecutiveSummary>
      </PageSections>
    </div>
  );
}

function GrainToggle({
  value,
  onChange,
  lang,
}: {
  value: TrendGrain;
  onChange: (grain: TrendGrain) => void;
  lang: "ar" | "en";
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5"
      role="group"
      aria-label={lang === "ar" ? "تجميع الشارت" : "Chart grain"}
    >
      {(["day", "week"] as const).map((grain) => (
        <button
          key={grain}
          type="button"
          onClick={() => onChange(grain)}
          className={`inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-2.5 text-[10.5px] font-semibold transition-colors ${
            value === grain ? "bg-surface text-brand shadow-sm" : "text-text-muted hover:text-text"
          }`}
          aria-pressed={value === grain}
        >
          <CalendarDays size={12} />
          {grain === "day"
            ? lang === "ar"
              ? "يومي"
              : "Daily"
            : lang === "ar"
              ? "أسبوعي"
              : "Weekly"}
        </button>
      ))}
    </div>
  );
}

function DisplayCurrencyToggle({
  value,
  onChange,
  sarRate,
  lang,
}: {
  value: DisplayCurrency;
  onChange: (currency: DisplayCurrency) => void;
  sarRate: number;
  lang: "ar" | "en";
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div
        className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5"
        role="group"
        aria-label={lang === "ar" ? "عملة عرض الأرقام" : "Display currency"}
      >
        {(["USD", "SAR"] as const).map((currency) => (
          <button
            key={currency}
            type="button"
            onClick={() => onChange(currency)}
            className={`min-h-7 cursor-pointer rounded-md px-2.5 text-[10.5px] font-semibold transition-colors ${
              value === currency
                ? "bg-surface text-brand shadow-sm"
                : "text-text-muted hover:text-text"
            }`}
            aria-pressed={value === currency}
          >
            {currency === "USD" ? "$ USD" : lang === "ar" ? "ر.س SAR" : "SAR"}
          </button>
        ))}
      </div>
      <span className="num whitespace-nowrap text-[9px] text-text-subtle">
        1 USD = {sarRate.toLocaleString("en-US", { maximumFractionDigits: 4 })} SAR
      </span>
    </div>
  );
}
