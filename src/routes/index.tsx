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
import { fmtDateTime, fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { ErrorState, KpiSkeletonGrid, Notice, Skeleton } from "@/components/ui-bits";
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
import type { MetricDetail } from "@/lib/metric-detail";
import {
  businessSignals,
  insightDetails,
  overviewLeadTargetMetrics,
  overviewMetrics,
  type BusinessSignals,
  type OverviewResp,
} from "@/components/overview-metrics";
import { MultiLineChart } from "@/components/charts";
import {
  formatDisplayMoney,
  usdToDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/display-currency";
import { fxRatesFromFilters } from "@/lib/fx-rates";
import type { AgentAnalyticsResult } from "@/lib/agent-analytics.server";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { PLATFORM_LABEL, PLATFORMS, resolveSpendByPlatform } from "@/lib/constants";
import { OverviewSalesAttribution } from "@/components/overview-sales-attribution";

export const Route = createFileRoute("/")({ component: Overview });

type TrendGrain = "day" | "week";

interface MoneyPoint extends Record<string, string | number> {
  date: string;
  value: number;
}

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
  const leadGoals = useMemo(
    () => (data ? overviewLeadTargetMetrics(data.leadTargets, lang) : null),
    [data, lang],
  );
  const insights = useMemo(
    () => (data && business ? insightDetails(data, business, workforce.data, lang) : null),
    [data, business, workforce.data, lang],
  );

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (isLoading || !data || !metrics || !leadGoals || !insights || !business) {
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
  if (data.spendCoverage?.complete === false) {
    healthIssues.push({
      tone: "danger",
      message:
        lang === "ar"
          ? "صرف الإعلانات غير مكتمل للفترة المختارة."
          : "Ad spend is incomplete for the selected period.",
      impact:
        lang === "ar"
          ? "أُخفيت أرقام الصرف ومؤشرات التكلفة والعائد حتى يكتمل استرجاع الحسابات."
          : "Spend and cost/return KPIs are hidden until the missing account history is restored.",
      technical: data.spendCoverage.gaps
        .slice(0, 12)
        .map((gap) => `${gap.platform} · ${gap.account} · ${gap.from} → ${gap.to}`)
        .join(" | "),
    });
  }
  if (data.prevSpendCoverage?.complete === false) {
    healthIssues.push({
      tone: "warning",
      message:
        lang === "ar"
          ? "مقارنة صرف الشهر السابق غير مكتملة."
          : "Prior-period spend comparison is incomplete.",
      impact:
        lang === "ar"
          ? "أُخفي تغيّر الصرف ومؤشرات الكفاءة لحين اكتمال الفترة المقارنة."
          : "Spend and efficiency deltas are hidden until the comparison period is complete.",
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

  // The provisional-today warning joins the rest of the data notes, so every
  // caveat lives in one place: the data-health panel in the header.
  if (data.spendCoverage?.complete && data.spendCoverage.provisionalToday) {
    healthIssues.push({
      tone: "info",
      message: lang === "ar" ? "صرف النهارده لسه أولي" : "Today's spend is provisional",
      impact:
        lang === "ar"
          ? "النهارده لسه ماخلصش، فأرقامه لحد آخر مزامنة بس. الأيام اللي قبله اتراجعت."
          : "Today is not over, so its figures run to the latest sync only. Earlier days passed the coverage check.",
    });
  }

  // The meaning-changing notes, named in one line. Every one of them is also
  // in the data-health panel in full, with its technical detail.
  const dataNotes: string[] = [];
  if (health.platformsWithoutSpendTab?.length) {
    dataNotes.push(
      lang === "ar"
        ? `${health.platformsWithoutSpendTab.map((p) => p.platform).join(" و")} جابوا ليدز من غير ما صرفهم يتسجل، فالعائد هنا أعلى من الحقيقة`
        : `${health.platformsWithoutSpendTab.map((p) => p.platform).join(", ")} brought leads with no recorded spend, so returns read higher than reality`,
    );
  }
  if (data.spendCoverage?.complete === false) {
    dataNotes.push(
      lang === "ar"
        ? "صرف بعض الحسابات لسه بيتراجع، فأرقام الصرف والعائد مستخبية لحد ما تكمل"
        : "Some accounts' spend is still being verified, so spend and return are held back until it completes",
    );
  }

  const targets = workforce.data?.targets;
  const salesTarget = salesTargetMetric(targets, filters.from, filters.to, lang);

  const links: WorkspaceLink[] = [
    {
      to: "/acquisition",
      title: lang === "ar" ? "التسويق" : "Marketing",
      description:
        lang === "ar"
          ? "الحملات والمواد الإعلانية وخطة الميديا والميديا بايرز"
          : "Campaigns, creatives, media plan and media buyers",
      icon: <Megaphone size={17} />,
      tone: "sky",
    },
    {
      to: "/acquisition",
      search: { section: "leads" },
      title: lang === "ar" ? "العملاء المحتملون" : "Leads",
      description:
        lang === "ar"
          ? "الليدز جت منين ولأي كورس، ومين لسه مستني"
          : "Where leads came from, for which course, and who is waiting",
      icon: <Users size={17} />,
      tone: "violet",
    },
    {
      to: "/leads",
      title: lang === "ar" ? "CRM والمبيعات" : "CRM and sales",
      description:
        lang === "ar"
          ? "السجلات وفريق المبيعات والمفقودة"
          : "Records, the sales team and lost deals",
      icon: <UsersRound size={17} />,
      tone: "amber",
    },
    {
      to: "/accounting",
      title: lang === "ar" ? "الإيرادات" : "Revenue",
      description:
        lang === "ar"
          ? "التحصيل ومبيعات الكورسات والأسعار"
          : "Collection, course sales and pricing",
      icon: <Receipt size={17} />,
      tone: "mint",
    },
  ];

  return (
    <div>
      <DashboardPageHeader
        flush
        icon={<LayoutDashboard size={20} />}
        title={lang === "ar" ? "نظرة الإدارة" : "Management overview"}
        subtitle={
          lang === "ar"
            ? "الشهر ماشي إزاي: التارجت، الفلوس، العملاء، واللي محتاج قرار"
            : "How the month is going: targets, money, customers, and what needs a decision"
        }
        period={period}
        sync={<SyncStatus label={syncLabel} tone={healthTone} />}
        actions={<DataHealthButton issues={healthIssues} syncedLabel={syncLabel} />}
      />

      {dataNotes.length > 0 && (
        <div className="mt-3">
          <AlertBar
            title={lang === "ar" ? "خلي بالك وانت بتقرا الأرقام" : "Read these figures with care"}
          >
            {dataNotes.join(lang === "ar" ? "، و" : "; ")}
            {lang === "ar"
              ? ". التفاصيل كلها في «ملاحظات الداتا» فوق."
              : ". Every detail is in the data notes above."}
          </AlertBar>
        </div>
      )}

      <PageSections className="gap-after-header">
        {/* 1 — Are we on plan? The three promises the month was planned on. */}
        <PageSection
          level="headline"
          icon={<Target size={16} />}
          title={lang === "ar" ? "الشهر ماشي إزاي؟" : "Is the month on plan?"}
        >
          <KpiRow>
            {salesTarget ? (
              <MetricDetailTrigger
                detail={salesTarget.detail}
                card={{ index: 0, hero: true, sub: salesTarget.sub }}
              />
            ) : (
              <MetricDetailTrigger
                detail={{
                  id: "overview.salesTarget",
                  title: lang === "ar" ? "التحصيل مقابل التارجت" : "Collection against target",
                  value: workforce.isLoading ? "…" : "—",
                  tone: "mint",
                  definition:
                    lang === "ar"
                      ? "مفيش تارجت مبيعات منشور للفترة دي، فمفيش نسبة نحسبها."
                      : "No sales target is published for this period, so there is no percentage to compute.",
                }}
                card={{ index: 0, hero: true }}
              />
            )}
            <MetricDetailTrigger
              detail={leadGoals.courses}
              card={{
                index: 1,
                sub:
                  data.leadTargets.reason === null
                    ? `${fmtNum(data.leadTargets.courses.actual ?? 0)} / ${fmtNum(data.leadTargets.courses.target ?? 0)} ${lang === "ar" ? "ليد · هدف الشهر" : "leads · monthly target"}`
                    : lang === "ar"
                      ? "محتاج خطة الشهر وفلاتر عامة"
                      : "Requires a monthly plan and broad filters",
              }}
            />
            <MetricDetailTrigger
              detail={leadGoals.website}
              card={{
                index: 2,
                sub:
                  data.leadTargets.reason === null
                    ? `${fmtNum(data.leadTargets.website.actual ?? 0)} / ${fmtNum(data.leadTargets.website.target ?? 0)} ${lang === "ar" ? "ليد · هدف الشهر" : "leads · monthly target"}`
                    : lang === "ar"
                      ? "محتاج خطة الشهر وفلاتر عامة"
                      : "Requires a monthly plan and broad filters",
              }}
            />
          </KpiRow>
        </PageSection>

        {/* 2 — The money and the customers, five figures. */}
        <PageSection
          level="primary"
          icon={<TrendingUp size={16} />}
          title={lang === "ar" ? "الفلوس والعملاء" : "Money and customers"}
        >
          <KpiRow>
            <MetricDetailTrigger
              detail={metrics.revenue}
              card={{
                index: 0,
                spark: seriesOf("revenue"),
                sub:
                  lang === "ar"
                    ? `منه ${fmtUSD(T.attributedRevenue)} جه من حملات`
                    : `${fmtUSD(T.attributedRevenue)} came from campaigns`,
              }}
            />
            <MetricDetailTrigger
              detail={metrics.spend}
              card={{
                index: 1,
                spark: seriesOf("spend"),
                sub:
                  data.spendCoverage?.complete === false
                    ? lang === "ar"
                      ? "لسه بنراجع صرف بعض الحسابات"
                      : "Some accounts are still being verified"
                    : PLATFORMS.map((platform) => ({
                        platform,
                        spend: spendByPlatform[platform],
                      }))
                        .filter(({ spend }) => spend > 0)
                        .map(
                          ({ platform, spend }) =>
                            `${PLATFORM_LABEL[platform][lang]} ${fmtUSD(spend)}`,
                        )
                        .join(" · "),
              }}
            />
            <MetricDetailTrigger
              detail={metrics.roas}
              card={{
                index: 2,
                sub: lang === "ar" ? "فلوس الحملات ÷ صرف الإعلانات" : "Campaign revenue ÷ ad spend",
              }}
            />
            <MetricDetailTrigger
              detail={metrics.leads}
              card={{
                index: 3,
                spark: seriesOf("leads"),
                sub: `CRM ${fmtNum(T.crmLeads)} + Lost ${fmtNum(T.lost)}`,
              }}
            />
            <MetricDetailTrigger
              detail={metrics.won}
              card={{
                index: 4,
                spark: seriesOf("won"),
                sub: `${fmtPct(T.conversionRate, 1)} ${lang === "ar" ? "من الليدز" : "of leads"}`,
              }}
            />
          </KpiRow>
          {!data.prevComparable && data.prevRange && (
            <Notice tone="info" icon={<Info size={16} />}>
              {lang === "ar"
                ? `مفيش نسب تغيير، لأن الفترة اللي قبلها (${data.prevRange.from} → ${data.prevRange.to}) قبل ما الداتا تبدأ.`
                : `Change percentages are hidden because the previous period (${data.prevRange.from} → ${data.prevRange.to}) falls before the data begins.`}
            </Notice>
          )}
          {data.prevComparable && data.prevRange && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-surface-2/55 px-3 py-2 text-[12px] text-text-muted">
              <span className="font-semibold text-text">
                {lang === "ar" ? "بنقارن بإيه؟" : "Compared with"}
              </span>
              <span className="num">
                {data.prevRange.from} → {data.prevRange.to}
              </span>
              <span>
                {lang === "ar"
                  ? "كل نسبة تغيير في الكروت بتقارن بنفس الأيام من الشهر اللي فات."
                  : "Every card delta compares the same calendar dates from last month."}
              </span>
            </div>
          )}
        </PageSection>

        {/* 3 — What needs a decision. */}

        <PageSection
          level="insight"
          icon={<Lightbulb size={16} />}
          title={lang === "ar" ? "محتاج قرار" : "Needs a decision"}
        >
          <TodaysInsights signals={business} details={insights} lang={lang} />
        </PageSection>

        {/* 4 — The team against its target: who is ahead, who needs help. */}
        <PageSection
          level="primary"
          icon={<UsersRound size={16} />}
          title={lang === "ar" ? "الفريق مقابل التارجت" : "The team against target"}
        >
          <TeamTargetBoard data={workforce.data} loading={workforce.isLoading} lang={lang} />
        </PageSection>

        {/* 5 — Money over time, and where it came from. */}
        <PageSection
          level="primary"
          title={lang === "ar" ? "التحصيل مقابل الصرف" : "Collection against spend"}
        >
          <DashboardPanel
            icon={<TrendingUp size={16} />}
            title={
              lang === "ar" ? "الفلوس اللي دخلت والفلوس اللي اتصرفت" : "Money in and money out"
            }
            hint={
              lang === "ar"
                ? "التحصيل بيوم الدفع، والصرف بيوم ظهور الإعلان."
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
        </PageSection>

        {data.revenueLeadAttribution && (
          <PageSection
            level="primary"
            title={lang === "ar" ? "التحصيل جه منين؟" : "Where did the collection come from?"}
          >
            <OverviewSalesAttribution
              attribution={data.revenueLeadAttribution}
              courses={data.courseSales}
              lang={lang}
              comparisonAvailable={data.prevComparable}
            />
          </PageSection>
        )}

        {/* The period's written read, in full, for whoever wants the prose. */}
        <ExecutiveSummary title={lang === "ar" ? "الخلاصة" : t("exec_summary")}>
          {lang === "ar" ? data.summary.ar : data.summary.en}
        </ExecutiveSummary>

        <PageSection level="records" title={lang === "ar" ? "روح للتفاصيل" : "Go deeper"}>
          <WorkspaceLinks links={links} />
        </PageSection>
      </PageSections>
    </div>
  );
}

/**
 * Collection against the published sales target, with the pace the month
 * should be at by the last selected day. The pace only applies when the
 * window starts on the 1st and stays inside one month — otherwise there is no
 * honest "should be at" and only the plain percentage is shown.
 */
function salesTargetMetric(
  targets: AgentAnalyticsResult["targets"] | undefined,
  from: string | undefined,
  to: string | undefined,
  lang: "ar" | "en",
): { detail: MetricDetail; sub: string } | null {
  if (!targets || targets.totalTarget === null || targets.totalTarget <= 0) return null;
  const A = lang === "ar";
  const paid = targets.totalPaidRevenue;
  const target = targets.totalTarget;
  const pct = targets.totalAchievementPaid;
  let pace: number | null = null;
  if (from && to && from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01")) {
    const [y, m, d] = to.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    pace = (target * d) / days;
  }
  const remaining = Math.max(target - paid, 0);
  const sub =
    pace !== null
      ? A
        ? `${fmtUSD(paid)} من ${fmtUSD(target)} · المفروض لحد ${to}: ${fmtUSD(pace)}`
        : `${fmtUSD(paid)} of ${fmtUSD(target)} · pace by ${to}: ${fmtUSD(pace)}`
      : A
        ? `${fmtUSD(paid)} من ${fmtUSD(target)}`
        : `${fmtUSD(paid)} of ${fmtUSD(target)}`;
  return {
    sub,
    detail: {
      id: "overview.salesTarget",
      title: A ? "التحصيل مقابل التارجت" : "Collection against target",
      value: pct === null ? "—" : `${pct.toFixed(1)}%`,
      tone: pace !== null && paid < pace ? "amber" : "mint",
      icon: <Target size={16} />,
      definition: A
        ? "اتحصّل كام في المية من تارجت المبيعات بتاع الشهر."
        : "How much of the month's sales target has been collected.",
      source: A
        ? "التحصيل من الفواتير المدفوعة لكل موظف في الفريق، والتارجت من خطة المبيعات المنشورة للشهر."
        : "Collections from each employee's paid invoices; the target from the published monthly sales plan.",
      why: A
        ? "ده أهم سؤال للإدارة: إحنا ماشيين على الخطة ولا متأخرين، ومحتاجين نتحرك إمتى."
        : "The first question management asks: are we on plan or behind, and when do we need to act.",
      formula: A
        ? `${fmtUSD(paid)} ÷ ${fmtUSD(target)} = ${pct === null ? "—" : `${pct.toFixed(1)}%`}${pace !== null ? `. المفروض لحد ${to} (${fmtUSD(pace)}) = التارجت × الأيام اللي فاتت ÷ أيام الشهر.` : "."}`
        : `${fmtUSD(paid)} ÷ ${fmtUSD(target)} = ${pct === null ? "—" : `${pct.toFixed(1)}%`}${pace !== null ? `. Pace by ${to} (${fmtUSD(pace)}) = target × days elapsed ÷ days in month.` : "."}`,
      caveat: !targets.complete
        ? A
          ? `الفترة فيها ${targets.monthsMissing.length} شهر من غير تارجت منشور، فالنسبة على جزء من المدة بس.`
          : `The window spans ${targets.monthsMissing.length} month(s) with no published target, so the percentage covers part of the period only.`
        : undefined,
      supporting: [
        { key: "paid", label: A ? "اتحصّل" : "Collected", value: fmtUSD(paid) },
        { key: "target", label: A ? "التارجت" : "Target", value: fmtUSD(target) },
        { key: "remaining", label: A ? "فاضل" : "Remaining", value: fmtUSD(remaining) },
        ...(pace !== null
          ? [{ key: "pace", label: A ? `المفروض لحد ${to}` : `Pace by ${to}`, value: fmtUSD(pace) }]
          : []),
      ],
      report: {
        to: "/teams",
        label: A ? "افتح أداء فريق المبيعات" : "Open sales team performance",
      },
    },
  };
}

/**
 * Who is ahead of their quota and who needs help: the five highest and five
 * lowest achievements among people with a published target, each with what
 * they collected against what they owe. The full roster is one click away.
 */
function TeamTargetBoard({
  data,
  loading,
  lang,
}: {
  data: AgentAnalyticsResult | undefined;
  loading: boolean;
  lang: "ar" | "en";
}) {
  const A = lang === "ar";
  if (loading && !data) return <Skeleton className="h-64" />;
  const rows = (data?.agents ?? [])
    .filter((row) => row.target?.target && row.target.achievementPaid !== null)
    .sort((a, b) => (b.target!.achievementPaid ?? 0) - (a.target!.achievementPaid ?? 0));
  if (!rows.length)
    return (
      <Notice tone="info" icon={<Info size={16} />}>
        {A
          ? "مفيش تارجت منشور لحد في الفترة دي، فمفيش ترتيب نعرضه."
          : "No one has a published target in this period, so there is no ranking to show."}
      </Notice>
    );
  const top = rows.slice(0, 5);
  const bottom = rows.length > 5 ? rows.slice(-5).reverse() : [];
  const List = ({ title, items, tone }: { title: string; items: typeof rows; tone: string }) => (
    <div className="card pad-card">
      <div className="mb-3 text-[13px] font-bold text-text">{title}</div>
      <ul className="space-y-3">
        {items.map((row) => {
          const pct = row.target!.achievementPaid ?? 0;
          return (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate font-semibold text-text" title={row.displayName}>
                  {row.displayName}
                </span>
                <span className="num shrink-0 font-bold text-text">{pct.toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(pct, 100)}%`, background: tone }}
                />
              </div>
              <div className="num mt-1 text-[12px] text-text-muted">
                {fmtUSD(row.paidRevenue)} {A ? "من" : "of"} {fmtUSD(row.target!.target ?? 0)}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <div>
      <div className="card-grid md:grid-cols-2">
        <List
          title={A ? "الأقرب للتارجت" : "Closest to target"}
          items={top}
          tone="var(--mint-fill)"
        />
        {bottom.length > 0 && (
          <List title={A ? "محتاجين دعم" : "Need support"} items={bottom} tone="var(--rose-fill)" />
        )}
      </div>
      <a
        href="/teams"
        className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline"
      >
        {A
          ? `شوف الفريق كله (${fmtNum(rows.length)} بتارجت)`
          : `See the whole team (${fmtNum(rows.length)} with a target)`}
      </a>
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
          className={`inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-2.5 text-[12px] font-semibold transition-colors ${
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
            className={`min-h-7 cursor-pointer rounded-md px-2.5 text-[12px] font-semibold transition-colors ${
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
      <span className="num whitespace-nowrap text-[12px] text-text-subtle">
        1 USD = {sarRate.toLocaleString("en-US", { maximumFractionDigits: 4 })} SAR
      </span>
    </div>
  );
}
