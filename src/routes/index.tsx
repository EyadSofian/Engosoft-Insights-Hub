import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
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
import {
  fmtCompact,
  fmtDateTime,
  fmtNum,
  fmtPct,
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
  MoreDetails,
  PageSection,
  PageSections,
  SyncStatus,
  WorkspaceLinks,
  type DataHealthIssue,
  type WorkspaceLink,
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
import { TelegramPanel } from "@/components/TelegramPanel";
import { HBarChart, MultiLineChart } from "@/components/charts";
import { CampaignActivityPanel } from "@/components/CampaignActivityPanel";
import { useClosedLoop } from "@/components/acquisition/ClosedLoop";
import { KpiFigure } from "@/components/acquisition/ManagementOverview";
import {
  formatDisplayMoney,
  usdToDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/display-currency";
import { fxRatesFromFilters } from "@/lib/fx-rates";
import type { AgentAnalyticsResult } from "@/lib/agent-analytics.server";
import type { PerfRow } from "@/lib/types";
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

function LeadOriginCard({ data, lang }: { data: OverviewResp; lang: "ar" | "en" }) {
  const { t } = useI18n();
  return (
    <>
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
    </>
  );
}

function BudgetLeaksCard({ rows, lang }: { rows: PerfRow[]; lang: "ar" | "en" }) {
  const { t } = useI18n();
  return (
    <>
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
        {rows.length === 0 ? (
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
                {rows.map((r) => (
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
    </>
  );
}

function AccountsCard({
  accounts,
  nonLeadSpend,
  lang,
}: {
  accounts: OverviewResp["accounts"];
  nonLeadSpend: number;
  lang: "ar" | "en";
}) {
  const { t } = useI18n();
  return (
    <>
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
              {accounts.map((a) => (
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

      {nonLeadSpend > 0 && (
        <Notice tone="warning" title={t("non_lead_spend")} icon={<Info size={16} />}>
          {lang === "ar"
            ? `${fmtUSDFull(nonLeadSpend)} أُنفقت على حسابات زيارات أو حسابات بلا اسم. المبلغ داخل إجمالي الإنفاق وكل معادلات الكفاءة طبقاً لتعريف الإدارة.`
            : `${fmtUSDFull(nonLeadSpend)} ran on traffic or unnamed accounts. It remains included in total spend and every efficiency formula by the approved management definition.`}
        </Notice>
      )}
    </>
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
    },
    {
      to: "/leads",
      title: lang === "ar" ? "المبيعات والعملاء" : "Sales & CRM",
      description:
        lang === "ar" ? "العملاء والمتابعة والصفقات المفقودة" : "Leads, follow-up and lost deals",
      figure: `${fmtNum(T.totalLeads)} ${lang === "ar" ? "عميل" : "leads"}`,
      icon: <Users size={17} />,
    },
    {
      to: "/accounting",
      title: lang === "ar" ? "الإيرادات" : "Revenue",
      description:
        lang === "ar" ? "التحصيل والفواتير والكورسات" : "Collection, invoices and courses",
      figure: `${fmtUSD(T.revenue)} ${lang === "ar" ? "تحصيل" : "collected"}`,
      icon: <Receipt size={17} />,
    },
    {
      to: "/teams",
      title: lang === "ar" ? "أداء الفريق" : "Team",
      description: lang === "ar" ? "فريق المبيعات والميديا بايرز" : "Sales team and media buyers",
      figure: business.bestEmployee?.name,
      icon: <UsersRound size={17} />,
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
                      style={{ background: "var(--brand)" }}
                      aria-hidden="true"
                    />
                    {lang === "ar" ? "التحصيل" : "Collection"}
                    <b className="num text-text">{money(totalRevenueShown)}</b>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: "var(--text-subtle)" }}
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
                    color: "var(--brand)",
                  },
                  {
                    key: "spend",
                    name: lang === "ar" ? "الصرف" : "Spend",
                    color: "var(--text-subtle)",
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

        {/* LEVEL 3 — everything else the page used to lead with, one click away. */}
        <MoreDetails
          testId="overview-more-details"
          label={lang === "ar" ? "تفاصيل أكثر" : "More details"}
          hint={
            lang === "ar"
              ? "أفضل الكورسات، حالة البيانات، السجلات، مؤشرات الكفاءة والملخص المكتوب"
              : "Top courses, data health, records, efficiency figures and the written summary"
          }
        >
          <TopCoursesPanel
            rows={data.courseSales}
            currency={displayCurrency}
            sarRate={sarRate}
            lang={lang}
          />

          <PageSection level="records" title={lang === "ar" ? "حالة البيانات" : "Data health"}>
            <DataHealthSummary issues={healthIssues} syncedLabel={syncLabel} />
            {blockingIssues.map((issue, i) => (
              <Notice
                key={i}
                tone="danger"
                title={issue.message}
                icon={<AlertTriangle size={16} />}
              >
                {issue.impact}
              </Notice>
            ))}
          </PageSection>

          <PageSection
            level="records"
            title={lang === "ar" ? "مؤشرات الكفاءة والمتابعة" : "Efficiency and follow-up"}
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
                card={{
                  index: 1,
                  compact: true,
                  sub: `${fmtNum(T.won)} / ${fmtNum(T.totalLeads)}`,
                }}
              />
              <MetricDetailTrigger
                detail={efficiency.closeTime}
                card={{
                  index: 2,
                  compact: true,
                  sub: T.closeSample
                    ? `${t("based_on")} ${fmtNum(T.closeSample)} ${t("closed_leads")}`
                    : undefined,
                }}
              />
              <MetricDetailTrigger
                detail={efficiency.acos}
                card={{
                  index: 3,
                  compact: true,
                  sub: lang === "ar" ? "الإنفاق ÷ الإيراد المحصّل" : "Spend ÷ collected revenue",
                }}
              />
              <MetricDetailTrigger
                detail={efficiency.cpl}
                card={{
                  index: 4,
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
                  index: 5,
                  compact: true,
                  sub:
                    lang === "ar"
                      ? `${fmtUSD(T.spend)} ÷ ${fmtNum(T.won)} صفقة`
                      : `${fmtUSD(T.spend)} ÷ ${fmtNum(T.won)} won`,
                }}
              />
            </KpiRow>
          </PageSection>

          <PageSection
            level="records"
            title={lang === "ar" ? "التفاصيل والسجلات" : "Detailed records"}
          >
            <DashboardPanel
              icon={<BookOpenCheck size={16} />}
              title={
                lang === "ar"
                  ? "مساهمة الكورسات ومتوسط سعر البيع"
                  : "Course contribution and average sale price"
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

            <LeadOriginCard data={data} lang={lang} />

            <BudgetLeaksCard rows={data.topLeaks} lang={lang} />

            <AccountsCard accounts={data.accounts} nonLeadSpend={T.nonLeadSpend} lang={lang} />
          </PageSection>

          <ExecutiveSummary title={t("exec_summary")}>
            {lang === "ar" ? data.summary.ar : data.summary.en}
          </ExecutiveSummary>

          <TelegramPanel />
        </MoreDetails>
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
