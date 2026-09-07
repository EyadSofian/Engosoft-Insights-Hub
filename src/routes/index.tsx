import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookMarked,
  BookOpenCheck,
  BrainCircuit,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Info,
  Lightbulb,
  Megaphone,
  MessagesSquare,
  Receipt,
  TrendingUp,
  Users,
  UsersRound,
  type LucideIcon,
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

/* -------------------------------------------------------------------------
   "روح للتفاصيل" — THE ROUTE OUT OF THE SUMMARY

   The overview is not another long report to memorize. It is the one place a
   manager should be able to answer "where do I go next?" without knowing the
   left navigation by heart.

   Two things changed here. These sit AFTER the analysis, not in front of it:
   seven large cards at the top of the page were the first thing a reader met,
   and they pushed the figures the page exists to state below the fold. And
   they are compact — one row each, icon, name, one line, and the single real
   figure that report is currently showing. A card with no figure available in
   `/api/overview` simply has no figure line; it does not get a sentence
   dressed up to look like one.

   They are ordinary route Links, not faux tabs: browser history, deep links,
   middle-click and keyboard navigation all stay intact.
------------------------------------------------------------------------- */

type WorkspaceCard = {
  to: string;
  title: string;
  description: string;
  /** A real figure from this response, or nothing at all. */
  detail?: string;
  icon: LucideIcon;
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
        lang === "ar"
          ? "ترتيب الكورسات والإيراد وسعر البيع"
          : "Course ranking, revenue and selling price",
      detail: topCourse ? `${topCourse.course} · ${fmtUSD(topCourse.revenue)}` : undefined,
      icon: GraduationCap,
      tone: "amber",
    },
    {
      to: "/campaigns",
      title: lang === "ar" ? "الحملات والإعلانات" : "Campaigns and ads",
      description:
        lang === "ar"
          ? "العائد والإنفاق والحملات اللي محتاجة قرار"
          : "Return, spend and the campaigns needing a decision",
      detail: data.best ? `${data.best.name} · ${fmtRoas(data.best.roas)}` : undefined,
      icon: Megaphone,
      tone: "sky",
    },
    {
      to: "/accounting",
      title: lang === "ar" ? "المبيعات والتحصيل" : "Sales and collection",
      description:
        lang === "ar"
          ? "الفواتير المدفوعة والتحصيل والتارجت"
          : "Paid invoices, collection and targets",
      detail: `${fmtUSD(data.totals.revenue)} ${lang === "ar" ? "تحصيل في الفترة" : "collected in this period"}`,
      icon: Receipt,
      tone: "mint",
    },
    {
      to: "/leads",
      title: lang === "ar" ? "إدارة العملاء" : "CRM management",
      description:
        lang === "ar"
          ? "العملاء والمتابعة والخسائر في مكان واحد"
          : "Leads, follow-up and losses in one workspace",
      detail: `${fmtNum(data.totals.crmLeads)} ${lang === "ar" ? "عميل داخل CRM" : "CRM leads"}`,
      icon: Users,
      tone: "violet",
    },
    {
      to: "/pricing",
      title: lang === "ar" ? "الأسعار والالتزام" : "Pricing and compliance",
      description:
        lang === "ar"
          ? "دليل الأسعار والفواتير الخارجة عنه"
          : "The price book and the invoices outside it",
      icon: BookMarked,
      tone: "cyan",
    },
    {
      to: "/teams",
      title: lang === "ar" ? "أداء الفريق" : "Team performance",
      description:
        lang === "ar"
          ? "الأداء وجودة المكالمات وتحقيق التارجت"
          : "Performance, call quality and target progress",
      detail: workforceLoading
        ? lang === "ar"
          ? "جارٍ حساب الأداء…"
          : "Calculating performance…"
        : topEmployee
          ? `${topEmployee.name} · ${topEmployee.averageQualityScore?.toFixed(0) ?? "—"}/100`
          : undefined,
      icon: UsersRound,
      tone: "rose",
    },
    {
      to: "/social-media",
      title: lang === "ar" ? "السوشيال ميديا وOrganic" : "Social media and Organic",
      description:
        lang === "ar"
          ? "القنوات غير المدفوعة والسوشيال ميديا"
          : "Non-paid channels and social media",
      icon: MessagesSquare,
      tone: "slate",
    },
  ];

  return (
    <div
      className="card-grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      data-testid="executive-map"
    >
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.to}
            to={card.to}
            className="tone-surface lift stagger group flex min-w-0 items-center gap-3 p-[var(--pad-card)] text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tone-strong)]"
            style={{ ...toneVars(card.tone), "--i": index } as CSSProperties}
            aria-label={`${card.title} — ${lang === "ar" ? "فتح التقرير" : "Open report"}`}
          >
            <span
              className="grid size-9 shrink-0 place-items-center rounded-xl text-white shadow-sm"
              style={{ background: "var(--tone-strong)" }}
              aria-hidden="true"
            >
              <Icon size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold text-[var(--tone-ink)]">
                {card.title}
              </span>
              <span className="mt-0.5 block truncate text-[11px] leading-snug text-text-muted">
                {card.description}
              </span>
              {card.detail && (
                <bdi className="mt-1 block truncate text-[11.5px] font-semibold text-[var(--tone-ink)]">
                  {card.detail}
                </bdi>
              )}
            </span>
            <ChevronLeft
              size={17}
              className="shrink-0 text-[var(--tone-strong)] transition-transform duration-200 group-hover:-translate-x-0.5 rtl:rotate-180 rtl:group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        );
      })}
    </div>
  );
}

/**
 * "أفضل الكورسات في الفترة" — the shortest honest answer to "what is selling".
 *
 * Five rows out of `data.courseSales`, which is already sorted by revenue, and
 * a link to the full report. Rank, name, revenue and — where the response
 * carries it — how many paid invoices are behind that revenue, because "أعلى
 * إيراد" from three invoices and from ninety are different facts.
 *
 * Deliberately not a table: the column that would answer the next question is
 * on /courses, and this card's job is to get the reader there.
 */
function TopCoursesPanel({
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
  const shown = rows.slice(0, 5);
  return (
    <DashboardPanel
      tone="amber"
      icon={<BookOpenCheck size={16} />}
      title={lang === "ar" ? "أفضل الكورسات في الفترة" : "Top courses this period"}
      hint={lang === "ar" ? "مرتبة بالإيراد المحصّل." : "Ranked by collected revenue."}
      footer={
        <Link
          to="/courses"
          className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
        >
          {lang === "ar" ? "عرض كل الكورسات" : "View all courses"}
          {lang === "ar" ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </Link>
      }
    >
      {shown.length === 0 ? (
        <EmptyState
          label={
            lang === "ar" ? "لا توجد مبيعات كورسات في الفترة" : "No course sales in this period"
          }
          compact
        />
      ) : (
        <ol className="space-y-2.5">
          {shown.map((row, index) => (
            <li key={row.course} className="flex items-center gap-2.5">
              <span
                className="num grid size-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold"
                style={
                  index === 0
                    ? { background: "var(--amber-strong)", color: "#fff" }
                    : { background: "var(--amber-surface)", color: "var(--amber-ink)" }
                }
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[13px] font-semibold text-text"
                  title={row.course}
                >
                  {row.course}
                </span>
                {row.paidInvoices > 0 && (
                  <span className="block text-[10.5px] text-text-muted">
                    {fmtNum(row.paidInvoices)} {lang === "ar" ? "فاتورة مدفوعة" : "paid invoices"}
                  </span>
                )}
              </span>
              <bdi className="num shrink-0 text-[13px] font-bold text-text">
                {formatDisplayMoney(
                  usdToDisplayCurrency(row.revenue, currency, sarRate),
                  currency,
                  lang,
                )}
              </bdi>
            </li>
          ))}
        </ol>
      )}
    </DashboardPanel>
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
          ? "الصفقات الضائعة تأتي من مصدر واحد معتمد فقط."
          : "Lost deals come from one approved source only.",
      technical:
        lang === "ar"
          ? `Lost Analysis: ${fmtNum(T.lostArchived)} صفقة مؤرشفة${T.archivedWon > 0 ? ` · ${fmtNum(T.archivedWon)} صفاً مؤرشفاً حالته Won يدخل في إجمالي الليدز والصفقات الرابحة ولا يدخل في Lost` : ""}. أي صف Stage=Lost في CRM مستبعد تماماً.`
          : `Lost Analysis: ${fmtNum(T.lostArchived)} archived losses${T.archivedWon > 0 ? ` · ${fmtNum(T.archivedWon)} archived Won rows counted in total leads and wins, not in Lost` : ""}. CRM Stage=Lost rows are fully excluded.`,
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

  return (
    <div>
      <DashboardPageHeader
        flush
        icon={<BrainCircuit size={20} />}
        title={lang === "ar" ? "الملخص العام" : "Executive summary"}
        subtitle={
          lang === "ar"
            ? "صورة سريعة للأداء، ثم طريق واضح للتقارير المهمة"
            : "A quick read of performance, then a clear route to the reports that matter"
        }
        period={period}
        sync={<SyncStatus label={syncLabel} tone={healthTone} />}
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
        {/* LEVEL 2 — the five figures the page exists to state. The heading is
            the lightest one on the page: the figures under it are large and
            coloured and carry themselves, so this line is here to name the
            group and to say the figures open, not to compete with them. */}
        <PageSection
          level="headline"
          tone="slate"
          icon={<BarChart3 size={16} />}
          title={lang === "ar" ? "أهم الأرقام" : "Headline figures"}
          hint={
            lang === "ar"
              ? "اضغط أي رقم تشوف مكوناته والتفاصيل اللي وراه."
              : "Open any figure to see what it is made of."
          }
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
            analysis below, and every one of them opens. Three, and only three:
            a reader who is given six things that all "need to know" has been
            given none. */}
        <PageSection
          level="insight"
          tone="amber"
          icon={<Lightbulb size={16} />}
          title={lang === "ar" ? "أهم حاجة محتاج تعرفها" : "What you need to know today"}
          hint={
            lang === "ar"
              ? "اضغط أي بطاقة تشوف الأرقام اللي طلّعت الكلام ده."
              : "Open any card to see the figures that produced the verdict."
          }
        >
          <TodaysInsights signals={business} details={insights} lang={lang} />
        </PageSection>

        {!data.prevComparable && data.prevRange && (
          <Notice tone="info" icon={<Info size={16} />}>
            {lang === "ar"
              ? `لا تُعرض نسب التغيّر لأن الفترة السابقة (${data.prevRange.from} → ${data.prevRange.to}) تقع قبل بداية البيانات في الملف، وأي مقارنة معها ستكون مضلّلة. اختر فترة أقصر لرؤية التغيّر.`
              : `Change percentages are hidden because the previous period (${data.prevRange.from} → ${data.prevRange.to}) falls before the data begins, so any comparison against it would mislead. Pick a shorter range to see deltas.`}
          </Notice>
        )}

        {/* LEVEL 4 — the analysis the figures rest on, and the most important
            row on the page. One heading over white panels, each of which
            carries its own quieter title. */}
        <PageSection
          level="primary"
          tone="sky"
          icon={<TrendingUp size={16} />}
          title={lang === "ar" ? "تفاصيل الأداء" : "The period in detail"}
          hint={
            lang === "ar"
              ? "التحصيل والإنفاق، مسار التحويل، وأفضل الكورسات في الفترة."
              : "Collection against spend, the funnel, and the courses that sold."
          }
        >
          {/* Three columns, deliberately unequal. The trend is the widest
              because a line needs length to have a shape; the funnel is a
              column of five bars and asks for less; the course ranking is five
              short rows and asks for least.
              Below `xl` the trend takes the full width and the two narrow
              panels pair up under it; below `lg` they stack in reading order.
              Spend and collection stay on ONE chart — they are the same
              question asked twice, and two equal cards made the reader hold
              one shape in their head to compare it with the other. */}
          <div className="card-grid lg:grid-cols-2 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
            <DashboardPanel
              className="lg:col-span-2 xl:col-span-1"
              tone="mint"
              icon={<TrendingUp size={16} />}
              title={lang === "ar" ? "اتجاه التحصيل والإنفاق" : "Collection and spend trend"}
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
              title={lang === "ar" ? "مسار التحويل" : "Conversion funnel"}
              hint={
                lang === "ar" ? "من الظهور للصفقة المقفولة." : "From impression to closed deal."
              }
              footer={
                lang === "ar"
                  ? "عدد العملاء في النظام ممكن يزيد عن اللي المنصات بتقوله، لأن فيه ناس بتيجي من واتساب والترشيحات."
                  : "CRM leads can exceed platform-reported leads: some arrive from WhatsApp and referrals."
              }
            >
              {/* The stages, and the rate between them, exactly as the response
                  states them. A stage the API returns as null shows a dash, not
                  a zero — "we did not measure it" and "it was none" are two
                  different sentences. */}
              <FunnelBars
                steps={data.funnel.map((s) => ({
                  label: FUNNEL_LABELS[s.key]?.[lang] ?? s.key,
                  value: s.value ?? 0,
                  display: s.value === null ? "—" : fmtCompact(s.value),
                }))}
              />
            </DashboardPanel>

            <TopCoursesPanel
              rows={data.courseSales}
              currency={displayCurrency}
              sarRate={sarRate}
              lang={lang}
            />
          </div>
        </PageSection>

        {/* The secondary row: what the reader should know about the numbers
            themselves before acting on them.

            The chip states the level honestly — a note that does not move a
            figure stays green, because an amber badge for "Lost comes from one
            approved source" teaches a reader to ignore the badge. Anything that
            DOES change what the figures mean is spelled out here in full,
            without them having to open anything. */}
        <PageSection
          level="records"
          title={lang === "ar" ? "حالة البيانات" : "Data health"}
          hint={
            lang === "ar"
              ? "آخر مزامنة والمصادر اللي مش داخلة في الأرقام."
              : "Last sync, and the sources these figures do not include."
          }
        >
          <DataHealthSummary issues={healthIssues} syncedLabel={syncLabel} />
          {blockingIssues.map((issue, i) => (
            <Notice key={i} tone="danger" title={issue.message} icon={<AlertTriangle size={16} />}>
              {issue.impact}
            </Notice>
          ))}
        </PageSection>

        {/* "روح للتفاصيل" — where to go next, AFTER the analysis rather than
            in front of it. Compact rows, real routes, and a figure only where
            this response actually carries one. */}
        <PageSection
          level="records"
          title={lang === "ar" ? "روح للتفاصيل" : "From summary to detail"}
          hint={
            lang === "ar"
              ? "اختار مساحة العمل اللي محتاجها؛ كل بطاقة بتفتح تقريرها على طول."
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

        {/* LEVEL 5 — the rows behind the analysis. A deliberately quieter
            heading: this is where a reader goes to check something, not where
            they start.

            The course-contribution chart and the campaign activity table used
            to sit in the analysis row above. They are both worth keeping and
            neither is a headline: contribution restates, at length, the ranking
            the top-courses card already gives, and the activity table is a list
            of rows. They are checks, so they live where a reader goes to
            check. */}
        <PageSection
          level="records"
          title={lang === "ar" ? "التفاصيل والسجلات" : "Detailed records"}
          hint={
            lang === "ar"
              ? "الصفوف اللي واقفة ورا الأرقام اللي فوق."
              : "The rows the figures above are built from."
          }
        >
          <DashboardPanel
            tone="amber"
            icon={<BookOpenCheck size={16} />}
            title={
              lang === "ar"
                ? "مساهمة الكورسات ومتوسط سعر البيع"
                : "Course contribution and average sale price"
            }
            hint={
              lang === "ar"
                ? "المساهمة = إيراد الكورس ÷ إجمالي إيراد الكورسات المصنّف."
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
