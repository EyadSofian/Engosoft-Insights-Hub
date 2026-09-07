import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Award,
  BookOpenCheck,
  BrainCircuit,
  CalendarDays,
  ChevronLeft,
  Crown,
  DollarSign,
  Info,
  LayoutGrid,
  Lightbulb,
  Percent,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { useFilters } from "@/lib/filter-store";
import {
  fmtCompact,
  fmtDateTime,
  fmtNum,
  fmtPct,
  fmtRoas,
  fmtUSD,
  fmtUSDFull,
  useI18n,
} from "@/lib/i18n";
import {
  Card,
  EmptyState,
  ErrorState,
  FunnelBars,
  KpiSkeletonGrid,
  Notice,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import {
  AlertBar,
  DashboardPageHeader,
  DashboardPanel,
  DataHealthSummary,
  ExecutiveSummary,
  InsightRow,
  KpiRow,
  PageSection,
  PageSections,
  SupportingFacts,
  SyncStatus,
  type DataHealthIssue,
} from "@/components/dashboard-bits";
import { AcosPill, CloseTime, CountPct, RoasCell } from "@/components/metric-bits";
import { InsightDetailTrigger, MetricDetailTrigger } from "@/components/metric-detail";
import {
  businessSignals,
  insightDetails,
  overviewEfficiencyMetrics,
  overviewMetrics,
  type BusinessSignals,
  type CourseSaleContribution,
  type OverviewResp,
} from "@/components/overview-metrics";
import type { MetricDetail } from "@/lib/metric-detail";
import { toneVars, type Tone } from "@/lib/dashboard-tone";
import { TelegramPanel } from "@/components/TelegramPanel";
import { HBarChart, MultiLineChart } from "@/components/charts";
import { CampaignActivityPanel } from "@/components/CampaignActivityPanel";
import {
  formatDisplayMoney,
  usdToDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/display-currency";
import { fxRatesFromFilters } from "@/lib/fx-rates";
import type { AgentAnalyticsResult } from "@/lib/agent-analytics.server";
import type { PerfRow } from "@/lib/types";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

export const Route = createFileRoute("/")({ component: Overview });

type TrendGrain = "day" | "week";

interface MoneyPoint extends Record<string, string | number> {
  date: string;
  value: number;
}

const FUNNEL_LABELS: Record<string, { ar: string; en: string }> = {
  impressions: { ar: "مرات الظهور", en: "Impressions" },
  clicks: { ar: "النقرات", en: "Clicks" },
  platform_leads: { ar: "عملاء أبلغت عنهم المنصة", en: "Platform leads" },
  crm_leads: { ar: "عملاء دخلوا النظام", en: "CRM leads" },
  won: { ar: "صفقات مغلقة", en: "Won" },
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
 * "What you need to know today" — the three readings of the period a manager
 * is expected to act on.
 *
 * Every value comes from `businessSignals`, which is unchanged. What did change
 * is that each card now opens: the verdict, the figures behind it, and the
 * report it came from, in the same panel every KPI uses.
 */
function TodaysInsights({
  signals,
  details,
  workforceLoading,
  lang,
}: {
  signals: BusinessSignals;
  details: ReturnType<typeof insightDetails>;
  workforceLoading: boolean;
  lang: "ar" | "en";
}) {
  const course = signals.topCourse;
  const campaign = signals.bestCampaign;
  const employee = signals.bestEmployee;

  return (
    <>
      <InsightRow>
        <InsightDetailTrigger
          detail={details.best}
          card={{
            index: 0,
            kind: "best",
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
            actionLabel: lang === "ar" ? "لماذا هذه الدورة؟" : "Why this course?",
          }}
        />

        <InsightDetailTrigger
          detail={details.risk}
          card={{
            index: 1,
            kind: "attention",
            title: signals.risk.title,
            detail: signals.risk.detail,
            actionLabel: lang === "ar" ? "ما الذي أدى لهذا؟" : "What led to this?",
          }}
        />

        <InsightDetailTrigger
          detail={details.decision}
          card={{
            index: 2,
            kind: "opportunity",
            eyebrow: lang === "ar" ? "القرار المقترح" : "Recommended decision",
            title: signals.decision.title,
            detail: signals.decision.detail,
            actionLabel: lang === "ar" ? "على أي أساس؟" : "On what basis?",
          }}
        />
      </InsightRow>

      {/* The two supporting readings the cockpit also carried. They are facts,
          not calls to action, so they share one divided strip rather than
          taking a near-empty card each. */}
      <SupportingFacts
        items={[
          {
            key: "campaign",
            tone: "mint",
            icon: <Crown size={16} />,
            label: lang === "ar" ? "أفضل حملة" : "Best campaign",
            value: campaign?.name ?? "—",
            detail: campaign
              ? `${fmtRoas(campaign.roas)} · ${fmtUSD(campaign.revenue)} ${lang === "ar" ? "إيراد" : "revenue"}`
              : lang === "ar"
                ? "لا توجد حملة مؤهلة في الفترة"
                : "No eligible campaign in this period",
          },
          {
            key: "employee",
            tone: "violet",
            icon: <UserRoundCheck size={16} />,
            label: lang === "ar" ? "أفضل موظف" : "Top employee",
            value: workforceLoading
              ? lang === "ar"
                ? "جارٍ الحساب…"
                : "Calculating…"
              : (employee?.name ?? "—"),
            detail: employee
              ? `${employee.averageQualityScore?.toFixed(0) ?? "—"}/100 · ${fmtNum(employee.analyzedCalls)} ${lang === "ar" ? "مكالمة" : "calls"}`
              : lang === "ar"
                ? "لا توجد مكالمات محلّلة"
                : "No analyzed calls",
          },
          {
            key: "course",
            tone: "amber",
            icon: <BookOpenCheck size={16} />,
            label: lang === "ar" ? "أهم دورة" : "Top course",
            value: course?.course ?? "—",
            detail: course
              ? `${fmtUSD(course.revenue)} · ${fmtPct(course.contribution, 1)} ${lang === "ar" ? "من إيراد الدورات" : "of course revenue"}`
              : lang === "ar"
                ? "لا توجد مبيعات دورات مصنفة"
                : "No classified course sales",
          },
        ]}
      />
    </>
  );
}

/* -------------------------------------------------------------------------
   THE EXECUTIVE MAP

   The overview is not another long report to memorize. It is the one place a
   manager should be able to answer "where do I go next?" without knowing the
   left navigation by heart. These are ordinary route Links, not faux tabs:
   browser history, deep links and keyboard navigation stay intact.
------------------------------------------------------------------------- */

type WorkspaceCard = {
  to: string;
  title: string;
  description: string;
  detail: string;
  icon: typeof Award;
  tone: Tone;
};

function ExecutiveMap({
  data,
  signals,
  workforceLoading,
  lang,
}: {
  data: OverviewResp;
  signals: BusinessSignals;
  workforceLoading: boolean;
  lang: "ar" | "en";
}) {
  const topCourse = signals.topCourse;
  const topEmployee = signals.bestEmployee;
  const cards: WorkspaceCard[] = [
    {
      to: "/courses",
      title: lang === "ar" ? "أفضل الكورسات" : "Top courses",
      description:
        lang === "ar" ? "ترتيب الدورات، الإيراد، وسعر البيع" : "Course ranking, revenue and selling price",
      detail: topCourse
        ? `${topCourse.course} · ${fmtUSD(topCourse.revenue)}`
        : lang === "ar"
          ? "افتح تحليل الكورسات"
          : "Open course analysis",
      icon: BookOpenCheck,
      tone: "amber",
    },
    {
      to: "/campaigns",
      title: lang === "ar" ? "الحملات والإعلانات" : "Campaigns and ads",
      description:
        lang === "ar" ? "تابع العائد والإنفاق والحملات المحتاجة قرار" : "Review return, spend and campaigns needing action",
      detail: data.best
        ? `${data.best.name} · ${fmtRoas(data.best.roas)}`
        : lang === "ar"
          ? "تحليل أداء الحملات"
          : "Campaign performance analysis",
      icon: Target,
      tone: "sky",
    },
    {
      to: "/accounting",
      title: lang === "ar" ? "المبيعات والتحصيل" : "Sales and collection",
      description:
        lang === "ar" ? "الفواتير المدفوعة، التحصيل، والتارجت" : "Paid invoices, collection and targets",
      detail: `${fmtUSD(data.totals.revenue)} ${lang === "ar" ? "تحصيل في الفترة" : "collected in this period"}`,
      icon: DollarSign,
      tone: "mint",
    },
    {
      to: "/leads",
      title: lang === "ar" ? "إدارة العملاء" : "CRM management",
      description:
        lang === "ar" ? "العملاء، المتابعة، والخسائر في مكان واحد" : "Leads, follow-up and losses in one workspace",
      detail: `${fmtNum(data.totals.crmLeads)} ${lang === "ar" ? "عميل داخل CRM" : "CRM leads"}`,
      icon: Users,
      tone: "violet",
    },
    {
      to: "/pricing",
      title: lang === "ar" ? "الأسعار والالتزام" : "Pricing and compliance",
      description:
        lang === "ar" ? "راجع دليل الأسعار والفواتير الاستثنائية" : "Review the price book and invoice exceptions",
      detail: lang === "ar" ? "دليل السعر والفواتير" : "Price book and invoices",
      icon: Percent,
      tone: "cyan",
    },
    {
      to: "/teams",
      title: lang === "ar" ? "أداء الفريق" : "Team performance",
      description:
        lang === "ar" ? "الأداء، جودة المكالمات، وتحقيق التارجت" : "Performance, call quality and target progress",
      detail: workforceLoading
        ? lang === "ar"
          ? "جارٍ حساب الأداء…"
          : "Calculating performance…"
        : topEmployee
          ? `${topEmployee.name} · ${topEmployee.averageQualityScore?.toFixed(0) ?? "—"}/100`
          : lang === "ar"
            ? "افتح أداء الفريق"
            : "Open team performance",
      icon: UserRoundCheck,
      tone: "rose",
    },
    {
      to: "/social-media",
      title: lang === "ar" ? "قنوات النمو" : "Growth channels",
      description:
        lang === "ar" ? "السوشيال ميديا والمصادر غير المدفوعة" : "Social media and non-paid sources",
      detail: lang === "ar" ? "السوشيال ميديا وOrganic" : "Social media and Organic",
      icon: TrendingUp,
      tone: "slate",
    },
  ];

  return (
    <div className="card-grid sm:grid-cols-2 xl:grid-cols-4" data-testid="executive-map">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.to}
            to={card.to}
            className="tone-surface lift stagger group relative flex min-h-[154px] flex-col overflow-hidden p-[var(--pad-card)] text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tone-strong)]"
            style={{ ...toneVars(card.tone), "--i": index } as CSSProperties}
            aria-label={`${card.title} — ${lang === "ar" ? "فتح التقرير" : "Open report"}`}
          >
            <span
              className="mb-4 grid size-9 place-items-center rounded-xl text-white shadow-sm"
              style={{ background: "var(--tone-strong)" }}
              aria-hidden="true"
            >
              <Icon size={18} />
            </span>
            <span className="text-[14px] font-bold text-[var(--tone-ink)]">{card.title}</span>
            <span className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-text-muted">
              {card.description}
            </span>
            <span className="mt-auto flex items-end justify-between gap-2 pt-3">
              <bdi className="min-w-0 truncate text-[11.5px] font-semibold text-[var(--tone-ink)]">
                {card.detail}
              </bdi>
              <ChevronLeft
                size={17}
                className="shrink-0 text-[var(--tone-strong)] transition-transform duration-200 group-hover:-translate-x-0.5 rtl:rotate-180 rtl:group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          </Link>
        );
      })}
    </div>
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

  const { totals: T, deltas, health } = data;

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
  if (health.platformsWithoutSpendTab?.length) {
    healthIssues.push({
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
    });
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
          ? "الصفقات الضائعة تأتي من مصدر واحد معتمد فقط."
          : "Lost deals come from one approved source only.",
      technical:
        lang === "ar"
          ? `Lost Analysis: ${fmtNum(T.lostArchived)} صفقة مؤرشفة${T.archivedWon > 0 ? ` · ${fmtNum(T.archivedWon)} صفاً مؤرشفاً حالته Won يدخل في إجمالي الليدز والصفقات الرابحة ولا يدخل في Lost` : ""}. أي صف Stage=Lost في CRM مستبعد تماماً.`
          : `Lost Analysis: ${fmtNum(T.lostArchived)} archived losses${T.archivedWon > 0 ? ` · ${fmtNum(T.archivedWon)} archived Won rows counted in total leads and wins, not in Lost` : ""}. CRM Stage=Lost rows are fully excluded.`,
    });
  }

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

  return (
    <div>
      <DashboardPageHeader
        flush
        icon={<BrainCircuit size={20} />}
        title={lang === "ar" ? "الملخص العام" : "Executive summary"}
        subtitle={
          lang === "ar"
            ? "صورة سريعة للأداء، ثم طريق واضح لكل تقرير تحتاجه"
            : "A quick read of performance, then a clear route to every report"
        }
        period={period}
        sync={<SyncStatus label={syncLabel} tone={healthIssues.length ? "warning" : "success"} />}
      />

      {/* Only the one class of problem that changes what the figures MEAN is
          allowed to interrupt the report: spend that exists in reality but not
          in the workbook makes every efficiency ratio look better than it is.
          Everything else — a tab served from the last good copy, an excluded
          stage, the Lost source — is stated in the data-health card at the
          foot of the page, and the global bar already flags a failed pull. */}
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
        {/* LEVEL 2 — the five figures the page exists to state. No heading of
            their own: at this size and in these colours the figures ARE the
            heading, and a label above them would only push them down. */}
        <PageSection
          level="headline"
          aria-label={lang === "ar" ? "المؤشرات الأساسية" : "Headline figures"}
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
                sub: [
                  `${lang === "ar" ? "ميتا" : "Meta"} ${fmtUSD(T.spendMeta)}`,
                  `${lang === "ar" ? "سناب" : "Snap"} ${fmtUSD(T.spendSnap)}`,
                  T.spendTikTok > 0
                    ? `${lang === "ar" ? "تيك توك" : "TikTok"} ${fmtUSD(T.spendTikTok)}`
                    : "",
                  T.spendGoogle > 0
                    ? `${lang === "ar" ? "جوجل" : "Google"} ${fmtUSD(T.spendGoogle)}`
                    : "",
                ]
                  .filter(Boolean)
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
            <MetricDetailTrigger
              detail={metrics.won}
              card={{
                index: 3,
                spark: seriesOf("won"),
                sub: `${fmtPct(T.conversionRate, 1)} ${lang === "ar" ? "معدل التحويل" : "conversion"}`,
              }}
            />
            <MetricDetailTrigger
              detail={metrics.roas}
              card={{
                index: 4,
                sub: `${t("attributed_roas")} ${fmtRoas(T.attributedRoas)}`,
              }}
            />
          </KpiRow>
        </PageSection>

        {/* LEVEL 3 — the readings. Lighter than the figures above and than the
            analysis below, and every one of them opens. */}
        <PageSection
          level="insight"
          tone="amber"
          icon={<Lightbulb size={16} />}
          title={lang === "ar" ? "أهم ما تحتاج معرفته اليوم" : "What you need to know today"}
          hint={
            lang === "ar"
              ? "اضغط أي بطاقة لترى الأرقام التي أدت إلى هذا الحكم."
              : "Open any card to see the figures that produced the verdict."
          }
        >
          <TodaysInsights
            signals={business}
            details={insights}
            workforceLoading={workforce.isLoading}
            lang={lang}
          />
        </PageSection>

        <PageSection
          level="primary"
          tone="violet"
          icon={<LayoutGrid size={16} />}
          title={lang === "ar" ? "من الملخص إلى التفاصيل" : "From summary to detail"}
          hint={
            lang === "ar"
              ? "اختر مساحة العمل المطلوبة؛ كل بطاقة تفتح التقرير المناسب مباشرة."
              : "Choose the workspace you need; every card opens its report directly."
          }
        >
          <ExecutiveMap
            data={data}
            signals={business}
            workforceLoading={workforce.isLoading}
            lang={lang}
          />
        </PageSection>

        {!data.prevComparable && data.prevRange && (
          <Notice tone="info" icon={<Info size={16} />}>
            {lang === "ar"
              ? `لا تُعرض نسب التغيّر لأن الفترة السابقة (${data.prevRange.from} → ${data.prevRange.to}) تقع قبل بداية البيانات في الملف، وأي مقارنة معها ستكون مضلّلة. اختر فترة أقصر لرؤية التغيّر.`
              : `Change percentages are hidden because the previous period (${data.prevRange.from} → ${data.prevRange.to}) falls before the data begins, so any comparison against it would mislead. Pick a shorter range to see deltas.`}
          </Notice>
        )}

        {/* LEVEL 4 — the analysis the figures rest on. One heading over white
            panels, each of which carries its own quieter title. */}
        <PageSection
          level="primary"
          tone="sky"
          icon={<TrendingUp size={16} />}
          title={lang === "ar" ? "تحليل الفترة" : "The period in detail"}
          hint={
            lang === "ar"
              ? "من أين جاء التحصيل، وأين ذهب الصرف، وكيف تحرك المسار."
              : "Where the collection came from, where the spend went, and how the funnel moved."
          }
        >
          {/* One chart, two series, at two-thirds width — with the funnel beside
              it. Spend and collection are the same question asked twice, and
              plotting them apart in two equal cards made the reader hold one
              shape in their head to compare it with the other. */}
          <div className="card-grid lg:grid-cols-3">
            <DashboardPanel
              className="lg:col-span-2"
              tone="mint"
              icon={<TrendingUp size={16} />}
              title={lang === "ar" ? "حركة الصرف والتحصيل" : "Spend and collection"}
              hint={
                lang === "ar"
                  ? "الصرف بتاريخ الإعلان، والتحصيل بتاريخ الدفع."
                  : "Spend follows ad date; collection follows Payment Date."
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
                height={300}
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
              tone="sky"
              icon={<Users size={16} />}
              title={t("funnel")}
              hint={
                lang === "ar" ? "من الظهور إلى الصفقة المغلقة" : "From impression to closed deal"
              }
              footer={
                lang === "ar"
                  ? "عدد العملاء في النظام قد يتجاوز ما تُبلغ عنه المنصات، لأن بعضهم يأتي من واتساب والترشيحات."
                  : "CRM leads can exceed platform-reported leads: some arrive from WhatsApp and referrals."
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

          <DashboardPanel
            tone="amber"
            icon={<BookOpenCheck size={16} />}
            title={
              lang === "ar"
                ? "مساهمة الدورات ومتوسط سعر البيع"
                : "Course contribution and average sale price"
            }
            hint={
              lang === "ar"
                ? "المساهمة = إيراد الدورة ÷ إجمالي إيراد الدورات المصنّف."
                : "Contribution = course revenue ÷ classified course revenue."
            }
          >
            <CourseContributionChart
              rows={data.courseSales}
              currency={displayCurrency}
              sarRate={sarRate}
              lang={lang}
            />
          </DashboardPanel>

          <CampaignActivityPanel activity={data.activity} />
        </PageSection>

        {/* LEVEL 5 — the rows behind the analysis. A deliberately quieter
            heading: this is where a reader goes to check something, not where
            they start. */}
        <PageSection
          level="records"
          title={lang === "ar" ? "السجلات التفصيلية" : "Detailed records"}
          hint={
            lang === "ar"
              ? "الصفوف التي تقف خلف الأرقام أعلاه."
              : "The rows the figures above are built from."
          }
        >
          <Card>
            <SectionTitle hint={t("origin_note")}>{t("lead_origin")}</SectionTitle>
            <div className="card-grid sm:grid-cols-2">
              {data.origin.cohorts.map((c) => (
                <div key={c.key} className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-text">
                      {c.key === "campaign" ? t("from_campaigns") : t("other_sources")}
                    </span>
                    <Pill tone={c.key === "campaign" ? "brand" : "neutral"}>{fmtNum(c.leads)}</Pill>
                  </div>
                  <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
                    <dt className="text-text-muted">{t("won")}</dt>
                    <dd className="text-end">
                      <CountPct count={c.won} pct={c.conversionRate} />
                    </dd>
                    <dt className="text-text-muted">{t("lost_count")}</dt>
                    <dd className="text-end">
                      <CountPct count={c.lost} pct={c.lostRate} />
                    </dd>
                    <dt className="text-text-muted">{t("revenue")}</dt>
                    <dd className="num text-end font-medium">{fmtUSD(c.revenue)}</dd>
                    <dt className="text-text-muted">{t("avg_close_time")}</dt>
                    <dd className="text-end text-[12px]">
                      <CloseTime days={c.avgCloseDays} sample={c.closeSample} />
                    </dd>
                  </dl>
                </div>
              ))}
            </div>
            {data.origin.otherBySource.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-text-muted">
                  {lang === "ar"
                    ? "توزيع العملاء بلا حملة حسب المصدر"
                    : "Non-campaign leads by source"}
                </div>
                <HBarChart
                  data={data.origin.otherBySource
                    .slice(0, 8)
                    .map((g) => ({ label: g.label, value: g.count }))}
                  format={fmtNum}
                  name={t("leads")}
                  color="var(--chart-3)"
                  height={200}
                />
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "حملات أنفقت ولم تُعد ما يساوي إنفاقها"
                  : "Campaigns that spent more than they returned"
              }
            >
              {t("where_budget_goes")}
            </SectionTitle>
            {data.topLeaks.length === 0 ? (
              <EmptyState
                label={
                  lang === "ar"
                    ? "لا توجد حملات خاسرة في هذه الفترة"
                    : "No loss-making campaigns in this period"
                }
                compact
              />
            ) : (
              <div className="table-wrap scroll-hint-x">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                      <th className="py-2 text-start">{t("campaign")}</th>
                      <th className="py-2 text-end">{t("spend")}</th>
                      <th className="py-2 text-end">{t("revenue")}</th>
                      <th className="py-2 text-end">{t("crm_leads")}</th>
                      <th className="py-2 text-end">{t("roas")}</th>
                      <th className="py-2 text-end">{t("acos")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topLeaks.map((r) => (
                      <tr key={r.key} className="border-t border-border">
                        <td className="max-w-[240px] truncate py-2.5 pe-3" title={r.name}>
                          {r.name}
                        </td>
                        <td className="num py-2.5 text-end">{fmtUSD(r.spend)}</td>
                        <td className="num py-2.5 text-end">{fmtUSD(r.revenue)}</td>
                        <td className="num py-2.5 text-end">{fmtNum(r.crmLeads)}</td>
                        <td className="py-2.5 text-end">
                          <RoasCell roas={r.roas} spend={r.spend} />
                        </td>
                        <td className="py-2.5 text-end">
                          <AcosPill acos={r.acos} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "كل الحسابات، بما فيها «زيارات» و«غير معروف»، داخلة في إجمالي الإنفاق ومعادلات الكفاءة"
                  : "Every account, including traffic and unknown, is included in total spend and efficiency formulas"
              }
            >
              {t("account")}
            </SectionTitle>
            <div className="table-wrap scroll-hint-x">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="py-2 text-start">{t("account")}</th>
                    <th className="py-2 text-end">{t("spend")}</th>
                    <th className="py-2 text-end">{t("platform_leads")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((a) => (
                    <tr key={a.name} className="border-t border-border">
                      <td className="py-2.5 pe-3">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <span className="max-w-[200px] truncate" title={a.name}>
                            {a.name}
                          </span>
                          {a.objective !== "leads" && (
                            <Pill tone="warning">
                              {a.objective === "traffic"
                                ? lang === "ar"
                                  ? "زيارات"
                                  : "traffic"
                                : lang === "ar"
                                  ? "غير معروف"
                                  : "unknown"}
                            </Pill>
                          )}
                        </span>
                      </td>
                      <td className="num py-2.5 text-end">{fmtUSDFull(a.spend)}</td>
                      <td className="num py-2.5 text-end">
                        {a.platformLeads === null ? (
                          <span className="text-text-subtle">—</span>
                        ) : (
                          fmtNum(a.platformLeads)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {T.nonLeadSpend > 0 && (
            <Notice tone="warning" title={t("non_lead_spend")} icon={<Info size={16} />}>
              {lang === "ar"
                ? `${fmtUSDFull(T.nonLeadSpend)} أُنفقت على حسابات زيارات أو حسابات بلا اسم. المبلغ داخل إجمالي الإنفاق وكل معادلات الكفاءة طبقاً لتعريف الإدارة.`
                : `${fmtUSDFull(T.nonLeadSpend)} ran on traffic or unnamed accounts. It remains included in total spend and every efficiency formula by the approved management definition.`}
            </Notice>
          )}
        </PageSection>

        {/* The qualifying figures. Every one of them opens the same way the
            five above do — a rate with no numerator is not checkable. */}
        <PageSection
          level="records"
          title={lang === "ar" ? "مؤشرات الكفاءة والمتابعة" : "Efficiency and follow-up"}
          hint={
            lang === "ar"
              ? "اضغط أي مؤشر لترى البسط والمقام وطريقة الحساب."
              : "Open any figure to see its numerator, its denominator and how it is calculated."
          }
        >
          <KpiRow>
            <MetricDetailTrigger
              detail={efficiency.lost}
              card={{
                index: 0,
                compact: true,
                sub: `${lang === "ar" ? "من مصدر الخسائر المعتمد" : "Approved Lost source"} · ${fmtPct(T.lostRate, 1)}`,
              }}
            />
            <MetricDetailTrigger
              detail={efficiency.conversion}
              card={{ index: 1, compact: true, sub: `${fmtNum(T.won)} / ${fmtNum(T.totalLeads)}` }}
            />
            <MetricDetailTrigger
              detail={efficiency.lostRate}
              card={{ index: 2, compact: true, sub: `${fmtNum(T.lost)} / ${fmtNum(T.totalLeads)}` }}
            />
            <MetricDetailTrigger
              detail={efficiency.closeTime}
              card={{
                index: 3,
                compact: true,
                sub: T.closeSample
                  ? `${t("based_on")} ${fmtNum(T.closeSample)} ${t("closed_leads")}`
                  : undefined,
              }}
            />
            <MetricDetailTrigger
              detail={efficiency.acos}
              card={{
                index: 4,
                compact: true,
                sub: lang === "ar" ? "الإنفاق ÷ الإيراد المحصّل" : "Spend ÷ collected revenue",
              }}
            />
            <MetricDetailTrigger
              detail={efficiency.cpl}
              card={{
                index: 5,
                compact: true,
                sub:
                  lang === "ar"
                    ? `${fmtUSD(T.spend)} ÷ ${fmtNum(T.platformLeads ?? 0)} ليد إعلانية`
                    : `${fmtUSD(T.spend)} ÷ ${fmtNum(T.platformLeads ?? 0)} ad leads`,
              }}
            />
            <MetricDetailTrigger
              detail={efficiency.cpa}
              card={{
                index: 6,
                compact: true,
                sub:
                  lang === "ar"
                    ? `${fmtUSD(T.spend)} ÷ ${fmtNum(T.won)} صفقة`
                    : `${fmtUSD(T.spend)} ÷ ${fmtNum(T.won)} won`,
              }}
            />
          </KpiRow>
        </PageSection>

        {/* The generated read of the period. It is worth reading and it is not
            worth five KPIs of screen: it sits after the analysis it describes,
            where somebody who wants the prose can find it. */}
        <ExecutiveSummary title={t("exec_summary")}>
          {lang === "ar" ? data.summary.ar : data.summary.en}
        </ExecutiveSummary>

        <TelegramPanel />

        <DataHealthSummary issues={healthIssues} syncedLabel={syncLabel} />
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

function CourseContributionChart({
  rows,
  currency,
  sarRate,
  lang,
}: {
  rows: CourseSaleContribution[];
  currency: DisplayCurrency;
  sarRate: number;
  lang: "ar" | "en";
}) {
  if (!rows.length)
    return (
      <EmptyState
        label={lang === "ar" ? "لا توجد مبيعات دورات في الفترة" : "No course sales in this period"}
        compact
      />
    );
  return (
    <div>
      <div className="mb-2 grid grid-cols-[minmax(72px,0.8fr)_minmax(108px,1.5fr)_minmax(70px,0.7fr)] gap-2 px-2 text-[9.5px] font-semibold uppercase tracking-wide text-text-subtle sm:grid-cols-[minmax(100px,0.8fr)_minmax(160px,2fr)_minmax(88px,0.7fr)] sm:gap-3">
        <span>{lang === "ar" ? "الدورة" : "Course"}</span>
        <span>{lang === "ar" ? "المساهمة في المبيعات" : "Sales contribution"}</span>
        <span className="text-end">
          {lang === "ar" ? "متوسط البيع" : "Average sale"} ({currency})
        </span>
      </div>
      <div className="max-h-[390px] space-y-1.5 overflow-y-auto pe-1">
        {rows.map((row, index) => (
          <div
            key={row.course}
            className="grid grid-cols-[minmax(72px,0.8fr)_minmax(108px,1.5fr)_minmax(70px,0.7fr)] items-center gap-2 rounded-xl border border-border bg-surface-2/45 px-2.5 py-2.5 sm:grid-cols-[minmax(100px,0.8fr)_minmax(160px,2fr)_minmax(88px,0.7fr)] sm:gap-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="num text-[9px] text-text-subtle">#{index + 1}</span>
                <span className="truncate text-xs font-semibold text-text" title={row.course}>
                  {row.course}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[9.5px] text-text-muted">
                {fmtNum(row.paidInvoices)} {lang === "ar" ? "فاتورة مدفوعة" : "paid invoices"}
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                <span className="num font-semibold text-brand">{fmtPct(row.contribution, 1)}</span>
                <span className="num text-text-muted">
                  {formatDisplayMoney(
                    usdToDisplayCurrency(row.revenue, currency, sarRate),
                    currency,
                    lang,
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-border/70">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-500"
                  style={{ width: `${Math.min(100, Math.max(1.5, row.contribution))}%` }}
                />
              </div>
            </div>
            <div className="text-end">
              <div className="num text-xs font-semibold text-text">
                {formatDisplayMoney(
                  usdToDisplayCurrency(row.averageSalePrice, currency, sarRate),
                  currency,
                  lang,
                  true,
                )}
              </div>
              <div className="mt-0.5 text-[9px] text-text-muted">
                {lang === "ar" ? "لكل فاتورة" : "per invoice"}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Link to="/courses" className="text-[11px] font-semibold text-brand hover:underline">
          {lang === "ar" ? "فتح تقرير الدورات الكامل ←" : "Open full courses report →"}
        </Link>
      </div>
    </div>
  );
}
