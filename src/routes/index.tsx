import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Award,
  BookOpenCheck,
  BrainCircuit,
  CalendarDays,
  Crown,
  DollarSign,
  Info,
  Lightbulb,
  Percent,
  Target,
  TrendingDown,
  TrendingUp,
  UserRoundCheck,
  Users,
  Timer,
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
  KpiCard,
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
  InfoDot,
  InsightCard,
  InsightRow,
  KpiRow,
  SecondaryMetrics,
  SupportingFacts,
  SyncStatus,
  type DataHealthIssue,
} from "@/components/dashboard-bits";
import { AcosPill, CloseTime, CountPct, RoasCell } from "@/components/metric-bits";
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
import type {
  CampaignActivity,
  DataHealth,
  Deltas,
  ExecSummary,
  FunnelStep,
  Grouped,
  PerfRow,
  Totals,
} from "@/lib/types";

export const Route = createFileRoute("/")({ component: Overview });

interface OriginCohort {
  key: "campaign" | "other";
  leads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  lostRate: number | null;
  revenue: number;
  avgCloseDays: number | null;
  closeSample: number;
}

interface OverviewResp {
  totals: Totals;
  deltas: Deltas;
  prevRange: { from: string; to: string } | null;
  prevComparable: boolean;
  trend: { date: string; spend: number; revenue: number; leads: number; won: number }[];
  courseSales: CourseSaleContribution[];
  funnel: FunnelStep[];
  origin: { cohorts: OriginCohort[]; otherBySource: Grouped[] };
  best: PerfRow | null;
  leak: PerfRow | null;
  bestCPL: PerfRow | null;
  activity: CampaignActivity;
  topLeaks: PerfRow[];
  topByROAS: PerfRow[];
  topSpend: PerfRow[];
  accounts: { name: string; objective: string; spend: number; platformLeads: number | null }[];
  summary: ExecSummary;
  health: DataHealth;
  syncedAt: string;
  fetchErrors: string[];
  staleTabs: string[];
}

interface CourseSaleContribution {
  course: string;
  mainCategory: string;
  revenue: number;
  contribution: number;
  paidInvoices: number;
  averageSalePrice: number | null;
}

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

interface BusinessSignals {
  topCourse: CourseSaleContribution | null;
  courseTargetShare: number | null;
  targetComplete: boolean;
  bestEmployee: AgentAnalyticsResult["agents"][number] | null;
  bestCampaign: PerfRow | null;
  risk: { title: string; detail: string };
  decision: { title: string; detail: string; href: string };
}

function businessSignals(
  data: OverviewResp,
  workforce: AgentAnalyticsResult | undefined,
  lang: "ar" | "en",
): BusinessSignals {
  const topCourse = data.courseSales[0] ?? null;
  const target = workforce?.targets.totalTarget ?? null;
  const courseTargetShare =
    topCourse && target !== null && target > 0 ? (topCourse.revenue / target) * 100 : null;
  const bestEmployee =
    [...(workforce?.agents ?? [])]
      .filter((agent) => agent.averageQualityScore !== null && (agent.analyzedCalls ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.averageQualityScore ?? 0) - (a.averageQualityScore ?? 0) ||
          (b.analyzedCalls ?? 0) - (a.analyzedCalls ?? 0),
      )[0] ?? null;

  let risk: BusinessSignals["risk"];
  if (data.fetchErrors.length || data.staleTabs.length) {
    // This card used to print the raw connector errors — "Archived Lost
    // unavailable: direct Odoo is not configured or could not be reached" —
    // into an executive summary. The count and the consequence are what a
    // reader here can act on; the connector names are stated in full in the
    // data-health card at the foot of the page.
    const affected = data.fetchErrors.length + data.staleTabs.length;
    risk = {
      title: lang === "ar" ? "بيانات تحتاج مراجعة" : "Data needs review",
      detail:
        lang === "ar"
          ? `${affected} من المصادر لم تُحدَّث بعد. راجع بطاقة صحة البيانات أسفل الصفحة قبل اتخاذ قرار مالي.`
          : `${affected} source${affected === 1 ? "" : "s"} have not refreshed. Check the data-health card at the foot of the page before making a budget call.`,
    };
  } else if (data.leak) {
    risk = {
      title: data.leak.name || (lang === "ar" ? "حملة عالية المخاطرة" : "High-risk campaign"),
      detail:
        lang === "ar"
          ? `صرف ${fmtUSD(data.leak.spend)} مقابل ${fmtUSD(data.leak.revenue)} إيراد مرتبط.`
          : `${fmtUSD(data.leak.spend)} spend versus ${fmtUSD(data.leak.revenue)} linked revenue.`,
    };
  } else if ((data.totals.lostRate ?? 0) >= 35) {
    risk = {
      title: lang === "ar" ? "نسبة Lost مرتفعة" : "High Lost rate",
      detail: `${fmtPct(data.totals.lostRate, 1)} · ${fmtNum(data.totals.lost)} ${lang === "ar" ? "ليد" : "leads"}`,
    };
  } else {
    risk = {
      title: lang === "ar" ? "لا يوجد إنذار حرج ظاهر" : "No critical alert detected",
      detail:
        lang === "ar"
          ? "استمر في مراقبة الصرف وجودة الليد يوميًا."
          : "Keep monitoring spend and lead quality daily.",
    };
  }

  let decision: BusinessSignals["decision"];
  if (data.fetchErrors.length || data.staleTabs.length) {
    decision = {
      title:
        lang === "ar"
          ? "ثبّت مصادر الداتا قبل تغيير الميزانية"
          : "Stabilize data before changing budget",
      detail:
        lang === "ar"
          ? "القرار المالي المبني على مصدر ناقص أو نسخة قديمة قد يكون مضللاً؛ راجع المصادر المتأثرة أولاً."
          : "A budget decision based on missing or stale sources can mislead; fix the affected feeds first.",
      href: "/guide",
    };
  } else if (data.leak && data.leak.spend > data.leak.revenue) {
    decision = {
      title:
        lang === "ar" ? `راجع أو خفّض ${data.leak.name}` : `Review or reduce ${data.leak.name}`,
      detail:
        lang === "ar"
          ? "الحملة تصرف أكثر من الإيراد المرتبط بها في الفترة. افحص جودة الليد والتتبع قبل ضخ ميزانية إضافية."
          : "This campaign spends more than its linked revenue. Audit lead quality and attribution before adding budget.",
      href: "/campaigns",
    };
  } else if ((data.totals.lostRate ?? 0) >= 35) {
    decision = {
      title:
        lang === "ar"
          ? "الأولوية لتحسين المتابعة لا لزيادة الصرف"
          : "Prioritize follow-up before more spend",
      detail:
        lang === "ar"
          ? "نسبة Lost الحالية تشير أن تحسين سرعة وجودة المتابعة قد يحقق نتيجة أكبر من توسيع الحملات."
          : "The current Lost rate suggests follow-up quality can create more value than campaign expansion.",
      href: "/lost",
    };
  } else if (data.best) {
    decision = {
      title:
        lang === "ar"
          ? `اختبر زيادة منضبطة لـ ${data.best.name}`
          : `Test a controlled increase for ${data.best.name}`,
      detail:
        lang === "ar"
          ? "ابدأ بزيادة 10–15% مع مراقبة CPL وجودة الليد، ولا تعتبر ROAS وحده ضمانًا للاستمرار."
          : "Start with a 10–15% increase while watching CPL and lead quality; ROAS alone is not a guarantee.",
      href: "/campaigns",
    };
  } else {
    decision = {
      title:
        lang === "ar"
          ? "اجمع عينة أكبر قبل تغيير الخطة"
          : "Collect a larger sample before changing course",
      detail:
        lang === "ar"
          ? "لا توجد حملة مؤهلة بما يكفي لقرار توسّع أو إيقاف موثوق في الفترة الحالية."
          : "No campaign has enough reliable evidence for a scale-or-stop decision in this period.",
      href: "/campaigns",
    };
  }

  return {
    topCourse,
    courseTargetShare,
    targetComplete: workforce?.targets.complete ?? false,
    bestEmployee,
    bestCampaign: data.best,
    risk,
    decision,
  };
}

/**
 * "What you need to know today" — the three readings of the period a manager
 * is expected to act on.
 *
 * Every value comes from `businessSignals`, which is unchanged: this is the
 * same best-result / risk / recommended-decision triple the navy cockpit
 * carried, laid out as three light semantic cards instead of a dark slab that
 * owned a fifth of the first screen.
 */
function TodaysInsights({
  signals,
  workforceLoading,
  lang,
}: {
  signals: BusinessSignals;
  workforceLoading: boolean;
  lang: "ar" | "en";
}) {
  const course = signals.topCourse;
  const campaign = signals.bestCampaign;
  const employee = signals.bestEmployee;

  return (
    <section
      aria-label={lang === "ar" ? "أهم ما تحتاج معرفته اليوم" : "What you need to know today"}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <Lightbulb size={16} className="text-warning" aria-hidden="true" />
        <h2 className="text-[14px] font-semibold text-text sm:text-[15px]">
          {lang === "ar" ? "أهم ما تحتاج معرفته اليوم" : "What you need to know today"}
        </h2>
      </div>

      <InsightRow>
        <InsightCard
          index={0}
          kind="best"
          title={
            course
              ? lang === "ar"
                ? `كورس ${course.course} حقق أعلى إيراد`
                : `${course.course} produced the most revenue`
              : lang === "ar"
                ? "لا توجد مبيعات دورات مصنفة"
                : "No classified course sales"
          }
          value={course ? fmtUSD(course.revenue) : undefined}
          detail={
            course
              ? signals.courseTargetShare !== null
                ? `${fmtPct(signals.courseTargetShare, 1)} ${lang === "ar" ? "من التارجت" : "of target"}${signals.targetComplete ? "" : ` · ${lang === "ar" ? "تارجت جزئي" : "partial target"}`}`
                : `${fmtPct(course.contribution, 1)} ${lang === "ar" ? "من إجمالي إيراد الدورات" : "of total course revenue"}`
              : undefined
          }
          to={course ? "/courses" : undefined}
          actionLabel={lang === "ar" ? "افتح الكورسات ←" : "Open courses →"}
        />

        <InsightCard
          index={1}
          kind="attention"
          title={signals.risk.title}
          detail={signals.risk.detail}
        />

        <InsightCard
          index={2}
          kind="opportunity"
          eyebrow={lang === "ar" ? "القرار المقترح" : "Recommended decision"}
          title={signals.decision.title}
          detail={signals.decision.detail}
          to={signals.decision.href}
          actionLabel={lang === "ar" ? "افتح التحليل ←" : "Open the analysis →"}
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
    </section>
  );
}

function Overview() {
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

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28" />
        <KpiSkeletonGrid count={12} />
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
  const revenueSpark = seriesOf("revenue");
  const spendSpark = seriesOf("spend");
  const leadsSpark = seriesOf("leads");
  const wonSpark = seriesOf("won");

  // The same bands the ROAS pill uses everywhere else, so the KPI tint and the
  // table cell can never disagree about whether a return is healthy.
  // A ratio's family is amber by convention, and drops to rose only when the
  // return is genuinely below cost. Keeping it mint whenever it was healthy
  // put two mint cards in a five-card row and cost the row a distinct colour.
  const roasTone = T.roas !== null && isFinite(T.roas) && T.roas < 1 ? "rose" : "amber";

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

  const mobileAlertCount = [
    data.fetchErrors.length > 0,
    data.staleTabs?.length > 0,
    health.platformsWithoutSpendTab?.length > 0,
    health.excludedStages?.length > 0,
    T.lostArchived > 0,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <DashboardPageHeader
        icon={<BrainCircuit size={20} />}
        title={t("business_analytics")}
        subtitle={
          lang === "ar"
            ? "رؤية شاملة لأداء أعمالك عبر جميع القنوات"
            : "A single read of business performance across every channel"
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
        <AlertBar title={t("missing_spend_tab")}>
          {health.platformsWithoutSpendTab
            .map((p) => `${p.platform}: ${fmtNum(p.leads)} ${lang === "ar" ? "عميلاً" : "leads"}`)
            .join(" · ")}
          {" — "}
          {t("missing_spend_tab_note")}
        </AlertBar>
      )}

      <KpiRow columns={5}>
        <Link
          to="/campaigns"
          search={{ view: "attributedRevenue" }}
          className="group block rounded-xl outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          aria-label={
            lang === "ar"
              ? `افتح الحملات المرتبطة بإيراد ${fmtUSD(T.attributedRevenue)}`
              : `Open campaigns linked to ${fmtUSD(T.attributedRevenue)} of revenue`
          }
        >
          <KpiCard
            index={0}
            label={t("revenue")}
            value={fmtUSD(T.revenue)}
            delta={deltas.revenue}
            hero
            tone="mint"
            icon={<TrendingUp size={16} />}
            spark={revenueSpark}
            sub={
              lang === "ar"
                ? `منه ${fmtUSD(T.attributedRevenue)} مرتبط بحملات`
                : `${fmtUSD(T.attributedRevenue)} campaign-linked`
            }
          />
        </Link>

        <KpiCard
          index={1}
          label={t("spend")}
          value={fmtUSD(T.spend)}
          delta={deltas.spend}
          deltaInvert
          tone="rose"
          icon={<DollarSign size={16} />}
          spark={spendSpark}
          sub={[
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
            .join(" · ")}
        />

        <KpiCard
          index={2}
          label={t("crm_leads")}
          value={fmtNum(T.totalLeads)}
          delta={deltas.totalLeads}
          tone="sky"
          icon={<Users size={16} />}
          spark={leadsSpark}
          sub={`CRM ${fmtNum(T.crmLeads)} + Lost ${fmtNum(T.lost)}`}
        />

        <KpiCard
          index={3}
          label={t("won")}
          value={fmtNum(T.won)}
          delta={deltas.won}
          tone="violet"
          icon={<Award size={16} />}
          spark={wonSpark}
          sub={`${fmtPct(T.conversionRate, 1)} ${lang === "ar" ? "معدل التحويل" : "conversion"}`}
        />

        <KpiCard
          index={4}
          label={t("roas")}
          value={fmtRoas(T.roas)}
          delta={deltas.roas}
          tone={roasTone}
          icon={<Target size={16} />}
          sub={`${t("attributed_roas")} ${fmtRoas(T.attributedRoas)}`}
          info={
            <InfoDot
              text={
                lang === "ar"
                  ? "الإيراد المحصّل من Accounting ÷ الإنفاق الإعلاني."
                  : "Collected Accounting revenue ÷ ad spend."
              }
            />
          }
        />
      </KpiRow>

      <TodaysInsights signals={business!} workforceLoading={workforce.isLoading} lang={lang} />

      {!data.prevComparable && data.prevRange && (
        <Notice tone="info" icon={<Info size={16} />}>
          {lang === "ar"
            ? `لا تُعرض نسب التغيّر لأن الفترة السابقة (${data.prevRange.from} → ${data.prevRange.to}) تقع قبل بداية البيانات في الملف، وأي مقارنة معها ستكون مضلّلة. اختر فترة أقصر لرؤية التغيّر.`
            : `Change percentages are hidden because the previous period (${data.prevRange.from} → ${data.prevRange.to}) falls before the data begins, so any comparison against it would mislead. Pick a shorter range to see deltas.`}
        </Notice>
      )}

      {/* One chart, two series, at two-thirds width — with the funnel beside
          it. Spend and collection are the same question asked twice, and
          plotting them apart in two equal cards made the reader hold one shape
          in their head to compare it with the other. */}
      <div className="grid gap-4 lg:grid-cols-3">
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
          hint={lang === "ar" ? "من الظهور إلى الصفقة المغلقة" : "From impression to closed deal"}
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

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardPanel
          className="lg:col-span-2"
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
      </div>

      <CampaignActivityPanel activity={data.activity} />

      <Card>
        <SectionTitle hint={t("origin_note")}>{t("lead_origin")}</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4">
          {data.origin.cohorts.map((c) => (
            <div key={c.key} className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
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
                <dd className="text-end num font-medium">{fmtUSD(c.revenue)}</dd>
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
            <div className="text-xs font-medium text-text-muted mb-2">
              {lang === "ar" ? "توزيع العملاء بلا حملة حسب المصدر" : "Non-campaign leads by source"}
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
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="text-start py-2">{t("campaign")}</th>
                  <th className="text-end py-2">{t("spend")}</th>
                  <th className="text-end py-2">{t("revenue")}</th>
                  <th className="text-end py-2">{t("crm_leads")}</th>
                  <th className="text-end py-2">{t("roas")}</th>
                  <th className="text-end py-2">{t("acos")}</th>
                </tr>
              </thead>
              <tbody>
                {data.topLeaks.map((r) => (
                  <tr key={r.key} className="border-t border-border">
                    <td className="py-2.5 pe-3 max-w-[240px] truncate" title={r.name}>
                      {r.name}
                    </td>
                    <td className="py-2.5 text-end num">{fmtUSD(r.spend)}</td>
                    <td className="py-2.5 text-end num">{fmtUSD(r.revenue)}</td>
                    <td className="py-2.5 text-end num">{fmtNum(r.crmLeads)}</td>
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
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="text-start py-2">{t("account")}</th>
                <th className="text-end py-2">{t("spend")}</th>
                <th className="text-end py-2">{t("platform_leads")}</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.name} className="border-t border-border">
                  <td className="py-2.5 pe-3">
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      <span className="truncate max-w-[200px]" title={a.name}>
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
                  <td className="py-2.5 text-end num">{fmtUSDFull(a.spend)}</td>
                  <td className="py-2.5 text-end num">
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

      <SecondaryMetrics
        label={lang === "ar" ? "مؤشرات الكفاءة والمتابعة" : "Efficiency and follow-up metrics"}
        count={7}
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">
          <KpiCard
            index={0}
            label={t("lost_count")}
            value={fmtNum(T.lost)}
            delta={deltas.lost}
            deltaInvert
            compact
            tone="rose"
            icon={<TrendingDown size={14} />}
            sub={`${lang === "ar" ? "من Lost Analysis فقط" : "Lost Analysis only"} · ${fmtPct(T.lostRate, 1)}`}
          />
          <KpiCard
            index={1}
            label={t("conversion_rate")}
            value={fmtPct(T.conversionRate, 2)}
            delta={deltas.conversionRate}
            compact
            tone="violet"
            icon={<Percent size={14} />}
            sub={`${fmtNum(T.won)} / ${fmtNum(T.totalLeads)}`}
          />
          <KpiCard
            index={2}
            label={t("lost_rate")}
            value={fmtPct(T.lostRate, 2)}
            delta={deltas.lostRate}
            deltaInvert
            compact
            tone="rose"
            icon={<Percent size={14} />}
            sub={`${fmtNum(T.lost)} / ${fmtNum(T.totalLeads)}`}
          />
          <KpiCard
            index={3}
            label={t("avg_close_time")}
            value={T.avgCloseDays === null ? "—" : T.avgCloseDays.toFixed(1)}
            compact
            tone="slate"
            icon={<Timer size={14} />}
            sub={
              T.closeSample
                ? `${t("based_on")} ${fmtNum(T.closeSample)} ${t("closed_leads")}`
                : undefined
            }
          />
          <KpiCard
            index={4}
            label={t("acos")}
            value={fmtPct(T.acos, 1)}
            delta={deltas.acos}
            deltaInvert
            compact
            tone="amber"
            icon={<Percent size={14} />}
            sub={
              lang === "ar"
                ? "الإنفاق ÷ الإيراد المحصّل من Accounting"
                : "Spend ÷ collected Accounting revenue"
            }
          />
          <KpiCard
            index={5}
            label={t("cpl")}
            value={fmtUSDFull(T.cpl)}
            delta={deltas.cpl}
            deltaInvert
            compact
            tone="amber"
            icon={<DollarSign size={14} />}
            sub={
              lang === "ar"
                ? `${fmtUSD(T.spend)} ÷ ${fmtNum(T.platformLeads ?? 0)} leads إعلانية`
                : `${fmtUSD(T.spend)} ÷ ${fmtNum(T.platformLeads ?? 0)} ad leads`
            }
          />
          <CpaCard totals={T} />
        </div>
      </SecondaryMetrics>

      {/* The generated read of the period. It is worth reading and it is not
          worth five KPIs of screen: it now sits after the analysis it
          describes, where somebody who wants the prose can find it. */}
      <ExecutiveSummary title={t("exec_summary")}>
        {lang === "ar" ? data.summary.ar : data.summary.en}
      </ExecutiveSummary>

      <TelegramPanel />

      <DataHealthSummary issues={healthIssues} syncedLabel={syncLabel} />
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

function CpaCard({ totals }: { totals: Totals }) {
  const { t, lang } = useI18n();

  return (
    <div
      className="card stagger p-4 sm:p-5 relative overflow-hidden"
      style={{ "--i": 11 } as React.CSSProperties}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted truncate">
          {t("cpa")}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted whitespace-nowrap">
          {t("cpa_won")}
        </span>
      </div>
      <div className="num mt-2 font-semibold leading-none text-[22px] sm:text-[27px] text-text">
        {fmtUSDFull(totals.cpa)}
      </div>
      <div className="mt-2 text-[11px] text-text-muted leading-snug">
        {lang === "ar"
          ? `${fmtUSD(totals.spend)} ÷ ${fmtNum(totals.won)} صفقة Won`
          : `${fmtUSD(totals.spend)} ÷ ${fmtNum(totals.won)} won deals`}
      </div>
    </div>
  );
}

function DataHealthPanel({ health }: { health: DataHealth }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const pct = (n: number) => fmtPct(n * 100, 1);
  const adBearing =
    health.adsetExact + health.adsetDerived + health.adsetAmbiguous + health.adsetUnknown;

  const items: { label: string; value: string; warn?: boolean }[] = [
    {
      label: lang === "ar" ? "مصدر CRM وLost" : "CRM & Lost source",
      value:
        health.crmAuthority === "odoo-direct"
          ? lang === "ar"
            ? "Odoo مباشر"
            : "Odoo direct"
          : health.crmAuthority === "postgres-last-good"
            ? lang === "ar"
              ? "آخر نسخة سليمة من Odoo"
              : "Odoo last-good copy"
            : health.crmAuthority === "google-sheet"
              ? lang === "ar"
                ? "Google Sheets — نفس مصدر Power BI"
                : "Google Sheets — Power BI canonical source"
              : lang === "ar"
                ? "نسخة Google Sheets الاحتياطية"
                : "Google Sheets fallback",
      warn: health.crmAuthority === "google-sheet-fallback",
    },
    {
      label: t("adset_resolution"),
      value: `${pct(health.adsetResolutionRate)} (${fmtNum(adBearing - health.adsetUnknown)} / ${fmtNum(adBearing)})`,
      warn: health.adsetResolutionRate < 0.9,
    },
    {
      label:
        lang === "ar" ? "منها تقديرية (اسم إعلان مكرر)" : "of which ambiguous (duplicate ad name)",
      value: fmtNum(health.adsetAmbiguous),
      warn: health.adsetAmbiguous > 0,
    },
    {
      label: t("match_rate"),
      value: pct(health.campaignMatchRate),
      warn: health.campaignMatchRate < 0.8,
    },
    {
      label: t("revenue_coverage"),
      value: `${pct(health.revenueCampaignCoverage)} ${lang === "ar" ? "من الصفوف" : "of rows"} · ${pct(health.revenueCampaignShare)} ${lang === "ar" ? "من الإيراد" : "of revenue"}`,
      warn: health.revenueCampaignShare < 0.6,
    },
    {
      label: lang === "ar" ? "تغطية اسم الإعلان في النظام" : "CRM ad-name coverage",
      value: pct(health.crmAdCoverage),
      warn: health.crmAdCoverage < 0.8,
    },
    {
      label: lang === "ar" ? "تغطية اسم الإعلان في الحسابات" : "Accounting ad-name coverage",
      value: pct(health.accountingAdCoverage),
      warn: health.accountingAdCoverage < 0.8,
    },
    {
      label: lang === "ar" ? "قياس زمن الإغلاق" : "Close-time measurability",
      value: `${fmtNum(health.closeSample)} ${lang === "ar" ? "صفقة" : "leads"} (${pct(health.closeCoverage)})`,
      warn: true,
    },
    {
      label: t("no_spend_source"),
      value: fmtNum(health.leadsWithoutSpendSource),
      warn: health.leadsWithoutSpendSource > 0,
    },
    {
      label:
        lang === "ar" ? "بنود خصم سالبة داخل الفواتير" : "Negative discount lines inside invoices",
      value: `${fmtNum(health.negativeRevenueRows)} · ${fmtUSDFull(health.negativeRevenue)}`,
    },
  ];

  return (
    <Card>
      <SectionTitle
        action={
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-surface-2 transition-colors cursor-pointer"
          >
            {open ? t("show_less") : t("show_more")}
          </button>
        }
      >
        {t("data_health")}
      </SectionTitle>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
        {items.slice(0, open ? items.length : 4).map((it) => (
          <div
            key={it.label}
            className="flex items-baseline justify-between gap-3 py-1 border-b border-border/60"
          >
            <span className="text-text-muted min-w-0">{it.label}</span>
            <span
              className="num font-medium shrink-0"
              style={it.warn ? { color: "var(--warning)" } : { color: "var(--text)" }}
            >
              {it.value}
            </span>
          </div>
        ))}
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <Notice tone="info" title={t("upstream_fix")} icon={<Info size={16} />}>
            {t("upstream_adset")}
          </Notice>
          <Notice tone="warning" title={t("no_spend_source")} icon={<AlertTriangle size={16} />}>
            {t("no_spend_source_note")}
            {health.unpricedSources.length > 0 && (
              <span className="block mt-1.5 num text-[11px]">
                {health.unpricedSources
                  .slice(0, 6)
                  .map((s) => `${s.label} ${fmtNum(s.count)}`)
                  .join(" · ")}
              </span>
            )}
          </Notice>
        </div>
      )}
    </Card>
  );
}
