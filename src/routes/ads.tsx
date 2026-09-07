import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  BadgeDollarSign,
  BarChart3,
  ChevronDown,
  CircleDollarSign,
  Globe2,
  Handshake,
  Info,
  MousePointerClick,
  Percent,
  Presentation,
  ScatterChart as ScatterIcon,
  TrendingUp,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { useFilters } from "@/lib/filter-store";
import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import {
  Card,
  EmptyState,
  ErrorState,
  Notice,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { DashboardPageHeader, KpiRow } from "@/components/dashboard-bits";
import { MetricCardDetailTrigger } from "@/components/metric-detail";
import { standardMetrics } from "@/components/standard-metrics";

import { useReportingPeriod } from "@/lib/use-reporting-period";
import { MultiLineChart, ScatterPlot } from "@/components/charts";
import { CompareBars } from "@/components/ads/CompareBars";
import { MetricCard, Unavailable } from "@/components/ads/MetricCard";
import { acosVerdict, roasVerdict, verdictWord } from "@/components/ads/verdict";
import { MetricInfo } from "@/components/ads/MetricInfo";
import { MetricsGlossaryButton } from "@/components/ads/MetricsGlossary";
import { FilterSummary } from "@/components/ads/FilterSummary";
import { MiniFunnel } from "@/components/ads/MiniFunnel";
import { PlatformSwitcher, type PlatformCoverage } from "@/components/ads/PlatformSwitcher";
import { PerfExplorer, type Grain } from "@/components/ads/PerfExplorer";
import { ratioCell } from "@/components/ads/cells";
import { METRICS, type MetricKey } from "@/lib/metric-catalog";
import { ACQUISITION_CHANNEL_LABEL, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/constants";
import { acquisitionChannel } from "@/lib/acquisition-channel";
import type { AcquisitionChannel, DataHealth, Maybe, PerfRow, Platform, Totals } from "@/lib/types";
import { topRows, type MetricDetail } from "@/lib/metric-detail";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

/**
 * The three figures in the second row that the shared catalogue does not carry.
 *
 * `standardMetrics` describes the ten metrics every report shares. Reach, the
 * lost rate and campaign-linked revenue are specific to this page, so their
 * descriptions live here rather than being pushed into a catalogue that other
 * surfaces would then have to ignore.
 */
function adsExtraMetrics(
  totals: Totals,
  rows: PerfRow[],
  lang: "ar" | "en",
): Record<"ctr" | "lostRate" | "attributedRevenue", MetricDetail> {
  const A = lang === "ar";
  const byCampaign = (
    pick: (row: PerfRow) => number,
    format: (n: number) => string,
    tone: "violet" | "rose" | "mint",
  ) => ({
    id: "campaigns",
    title: A ? "حسب الحملة" : "By campaign",
    rows: topRows(
      rows.map((row) => ({
        key: row.key,
        label: row.campaignName || row.name,
        value: pick(row),
        display: format(pick(row)),
        meta: `${fmtUSD(row.spend)} ${A ? "إنفاق" : "spend"}`,
        tone,
      })),
    ),
    moreTo: "/campaigns",
    moreLabel: A ? "فتح تقرير الحملات" : "Open the campaigns report",
    emptyLabel: A ? "لا توجد حملات في الفترة" : "No campaigns in this period",
  });

  return {
    ctr: {
      id: "ads.ctrAll",
      title: A ? "نسبة النقر (الكل)" : "Click-through rate (all)",
      value: fmtPct(totals.ctrAll, 2),
      tone: "violet",
      icon: <MousePointerClick size={16} />,
      definition: A
        ? "نسبة من رأى الإعلان ثم نقر عليه، بأي نوع نقرة أبلغت عنها المنصة."
        : "The share of people who saw an ad and clicked it, counting every click type the platform reports.",
      formula: `${fmtNum(totals.clicksAll)} ÷ ${fmtNum(totals.impressions)} = ${fmtPct(totals.ctrAll, 2)}`,
      caveat: A
        ? "النسبة موزونة: النقرات كلها ÷ مرات الظهور كلها، لا متوسط نِسَب الصفوف."
        : "Weighted: total clicks ÷ total impressions, not an average of row percentages.",
      supporting: [
        {
          key: "clicks",
          label: A ? "البسط · النقرات" : "Numerator · clicks",
          value: fmtNum(totals.clicksAll),
        },
        {
          key: "impressions",
          label: A ? "المقام · الظهور" : "Denominator · impressions",
          value: fmtNum(totals.impressions),
        },
        { key: "cpc", label: "CPC", value: fmtUSDFull(totals.cpc) },
        { key: "cpm", label: "CPM", value: fmtUSDFull(totals.cpm) },
      ],
      breakdowns: [byCampaign((row) => row.clicksAll, fmtNum, "violet")],
      report: { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" },
    },

    lostRate: {
      id: "ads.lostRate",
      title: A ? "نسبة الخسارة" : "Lost rate",
      value: fmtPct(totals.lostRate, 2),
      tone: "rose",
      icon: <Percent size={16} />,
      deltaInvert: true,
      definition: A
        ? "نسبة العملاء المحتملين الذين انتهوا إلى خسارة، من إجمالي ليدز أودو في الفترة."
        : "The share of leads that ended as lost, out of all Odoo leads in the period.",
      formula: `${fmtNum(totals.lost)} ÷ ${fmtNum(totals.totalLeads)} = ${fmtPct(totals.lostRate, 2)}`,
      supporting: [
        {
          key: "lost",
          label: A ? "البسط · الخاسرة" : "Numerator · lost",
          value: fmtNum(totals.lost),
        },
        {
          key: "leads",
          label: A ? "المقام · الليدز" : "Denominator · leads",
          value: fmtNum(totals.totalLeads),
        },
        { key: "won", label: A ? "الصفقات" : "Won", value: fmtNum(totals.won) },
        {
          key: "conversion",
          label: A ? "نسبة الإغلاق" : "Conversion",
          value: fmtPct(totals.conversionRate, 2),
        },
      ],
      breakdowns: [byCampaign((row) => row.lost, fmtNum, "rose")],
      report: { to: "/lost", label: A ? "فتح تقرير الخسارة" : "Open the Lost report" },
    },

    attributedRevenue: {
      id: "ads.attributedRevenue",
      title: A ? "الإيراد المرتبط بالحملات" : "Campaign-linked revenue",
      value: fmtUSD(totals.attributedRevenue),
      tone: "mint",
      icon: <CircleDollarSign size={16} />,
      definition: A
        ? "الجزء من التحصيل الذي يمكن نسبته إلى حملة أنفقت في هذه الفترة. باقي التحصيل حقيقي أيضًا، لكنه لا يحمل حملة."
        : "The share of collection that can be traced to a campaign which spent in this window. The rest of the collection is just as real, but carries no campaign.",
      formula: `${fmtUSD(totals.attributedRevenue)} ÷ ${fmtUSD(totals.revenue)} = ${fmtPct((totals.attributedRevenue / (totals.revenue || 1)) * 100, 1)}`,
      supporting: [
        {
          key: "revenue",
          label: A ? "كل التحصيل" : "All collection",
          value: fmtUSD(totals.revenue),
        },
        {
          key: "unlinked",
          label: A ? "غير مرتبط بحملة" : "Not linked to a campaign",
          value: fmtUSD(totals.revenue - totals.attributedRevenue),
        },
        { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSD(totals.spend) },
        {
          key: "attributedRoas",
          label: A ? "عائد الجزء المرتبط" : "Linked return",
          value:
            totals.spend > 0 ? `${(totals.attributedRevenue / totals.spend).toFixed(2)}×` : "—",
        },
      ],
      breakdowns: [byCampaign((row) => row.revenue, fmtUSD, "mint")],
      report: { to: "/accounting", label: A ? "فتح تقرير الحسابات" : "Open the Accounting report" },
    },
  };
}

export const Route = createFileRoute("/ads")({ component: Ads });

interface PlatformBlock {
  platform: Platform;
  rows: number;
  spend: number;
  impressions: number;
  clicksAll: number;
  linkClicks: Maybe;
  platformLeads: Maybe;
  viewCompletions: Maybe;
  ctrAll: Maybe;
  ctrLink: Maybe;
  cpm: Maybe;
  cpc: Maybe;
  platformCpl: Maybe;
  accounts: string[];
  dateMin: string;
  dateMax: string;
}

interface Resp {
  totals: Totals;
  byPlatform: PlatformBlock[];
  platformCoverage: PlatformCoverage[];
  platformCoverageAll: {
    spend: number;
    crmLeads: number;
    won: number;
    lost: number;
    revenue: number;
  };
  byDay: ({ date: string; impressions: number; clicks: number } & Record<Platform, number>)[];
  trend: { date: string; spend: number; revenue: number; leads: number; won: number }[];
  spendSections: CampaignSpendSection[];
  grain: Grain;
  rows: PerfRow[];
  unknownAdsetKey: string;
  accounts: { name: string; objective: string; spend: number; platformLeads: number | null }[];
  health: DataHealth;
}

interface CampaignSpendSection {
  purpose: "website" | "webinar";
  spend: number;
  campaigns: number;
  spendDays: number;
  averageDailySpend: number | null;
  platformResults: number | null;
  rows: {
    key: string;
    campaign: string;
    platform: Platform;
    spend: number;
    spendDays: number;
    averageDailySpend: number | null;
    platformResults: number | null;
  }[];
}

function Ads() {
  const reportingPeriod = useReportingPeriod();
  const { t, lang } = useI18n();
  const filters = useFilters();
  const [grain, setGrain] = useState<Grain>("campaign");
  // Declares this page to ENGO Nexus, so "حلل الصفحة دي" and "التاب ده"
  // have something to resolve against. Ids and state only — no figures.
  useRegisterNexusView("ads", { tab: grain });
  const [showAllKpis, setShowAllKpis] = useState(false);
  const { data, isLoading, error, refetch } = useApi<Resp>(`/api/ads?grain=${grain}`);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const selected = acquisitionChannel(filters);
  const coverage = data?.platformCoverage ?? [];
  const selectedCoverage = selected ? coverage.find((c) => c.platform === selected) : undefined;

  // A platform with no ad tab is not a platform that spent nothing. Every
  // spend-derived figure below reads "not available" instead of zero, and says
  // why — that distinction is the whole point of the TikTok row.
  const noSpendTab = !!selectedCoverage && !selectedCoverage.spendAvailable;
  const totals = data?.totals;
  const spend = totals?.spend ?? 0;

  const spendNote = noSpendTab
    ? lang === "ar"
      ? `${ACQUISITION_CHANNEL_LABEL[selected!][lang]} مالهاش تبويب إنفاق في المصدر الحالي، فالإنفاق وكل المؤشرات المبنية عليه غير متاحة.`
      : `${ACQUISITION_CHANNEL_LABEL[selected!][lang]} has no spend tab in the current source, so spend and every metric built on it are unavailable.`
    : undefined;

  const unavailableReason = noSpendTab
    ? spendNote
    : spend <= 0
      ? lang === "ar"
        ? "مفيش إنفاق مسجّل في الفترة المختارة."
        : "No recorded spend in the selected period."
      : undefined;

  // Built from the response already on screen, so opening a figure costs a
  // render and never a request.
  const metrics = totals
    ? standardMetrics({
        totals,
        rows: data?.rows ?? [],
        trend: data?.trend ?? [],
        surface: "ads",
        lang,
        reports: {
          revenue: {
            to: "/accounting",
            label: lang === "ar" ? "فتح تقرير الحسابات" : "Open the Accounting report",
          },
          leads: {
            to: "/leads",
            label: lang === "ar" ? "فتح تقرير العملاء" : "Open the leads report",
          },
          spend: {
            to: "/campaigns",
            label: lang === "ar" ? "فتح تقرير الحملات" : "Open the campaigns report",
          },
          roas: {
            to: "/campaigns",
            label: lang === "ar" ? "فتح تقرير الحملات" : "Open the campaigns report",
          },
          cpl: {
            to: "/campaigns",
            label: lang === "ar" ? "فتح تقرير الحملات" : "Open the campaigns report",
          },
          conversion: {
            to: "/leads",
            label: lang === "ar" ? "فتح تقرير العملاء" : "Open the leads report",
          },
        },
      })
    : null;

  const extras = totals ? adsExtraMetrics(totals, data?.rows ?? [], lang) : null;

  const nothingAtAll =
    !!selectedCoverage &&
    selectedCoverage.adRows === 0 &&
    selectedCoverage.crmLeads === 0 &&
    selectedCoverage.revenue === 0;

  return (
    <div className="page-sections">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <DashboardPageHeader
          flush
          icon={<BarChart3 size={20} />}
          title={t("ads_tech")}
          subtitle={
            lang === "ar"
              ? "الإنفاق والعملاء والتحصيل في مكان واحد. كل رقم عليه علامة استفهام بتقول جاي منين وبيتحسب إزاي، واللي مش متاح بيظهر شرطة مش صفر."
              : "Spend, leads and collections in one place. Every figure carries an info button explaining where it comes from, and anything unmeasurable renders as a dash, never a zero."
          }
          period={reportingPeriod}
        />
        <MetricsGlossaryButton className="mt-0.5" />
      </div>

      <FilterSummary />

      {isLoading || !data || !totals ? (
        <>
          <Skeleton className="h-16" />
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[124px]" />
            ))}
          </div>
          <Skeleton className="h-72" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          <PlatformSwitcher
            coverage={coverage}
            // Falls back to the scoped totals if an older payload is still
            // cached, so a mid-deploy client degrades instead of blanking.
            overall={
              data.platformCoverageAll ?? {
                spend: totals.spend,
                crmLeads: totals.totalLeads,
                revenue: totals.revenue,
              }
            }
          />

          <PlatformState
            selected={selected}
            coverage={selectedCoverage}
            health={data.health}
            allCoverage={coverage}
          />

          {nothingAtAll ? (
            <Card>
              <EmptyState
                label={
                  lang === "ar"
                    ? `مفيش أي بيانات لـ${ACQUISITION_CHANNEL_LABEL[selected!][lang]} في الفترة دي`
                    : `No ${ACQUISITION_CHANNEL_LABEL[selected!].en} data in this period`
                }
                hint={
                  lang === "ar"
                    ? "جرّب توسّع الفترة من فوق، أو ارجع لعرض «الكل»."
                    : "Widen the period above, or switch back to All platforms."
                }
              />
            </Card>
          ) : (
            <>
              {/* Six primary KPIs. The rest sit one click away so the first
                  screen answers "did this work?" and not much else. */}
              <KpiRow>
                <MetricCardDetailTrigger
                  detail={metrics!.spend}
                  card={{
                    metric: "spend",
                    index: 0,
                    icon: <Wallet size={14} />,
                    value: fmtUSD(totals.spend),
                    unavailableReason: noSpendTab ? spendNote : undefined,
                    sub: <SpendSplit totals={totals} />,
                    note: spendNote,
                  }}
                />
                <MetricCardDetailTrigger
                  detail={{
                    ...metrics!.leads,
                    id: "ads.platformLeads",
                    title: lang === "ar" ? "ليدز أبلغت عنها المنصات" : "Platform-reported leads",
                    value: totals.platformLeads === null ? "—" : fmtNum(totals.platformLeads),
                    definition:
                      lang === "ar"
                        ? "عدد العملاء الذي تبلّغ عنه المنصة الإعلانية نفسها. يختلف عن عدد العملاء في أودو: المنصة تعدّ نموذجًا مُرسلًا، وأودو يعدّ صفًا وصل فعلًا."
                        : "The lead count the ad platform itself reports. It differs from the Odoo count: the platform counts a submitted form, Odoo counts a row that actually arrived.",
                    formula:
                      lang === "ar"
                        ? `${fmtNum(totals.platformLeads ?? 0)} حسب المنصات، مقابل ${fmtNum(totals.totalLeads)} في أودو.`
                        : `${fmtNum(totals.platformLeads ?? 0)} per the platforms, against ${fmtNum(totals.totalLeads)} in Odoo.`,
                  }}
                  card={{
                    metric: "platformLeads",
                    index: 1,
                    icon: <Users size={14} />,
                    value:
                      totals.platformLeads === null ? (
                        <Unavailable
                          reason={
                            lang === "ar"
                              ? "المنصة دي مبتبلّغش عن عدد ليدز"
                              : "This platform reports no lead metric"
                          }
                        />
                      ) : (
                        fmtNum(totals.platformLeads)
                      ),
                    sub:
                      lang === "ar"
                        ? `${fmtNum(totals.totalLeads)} في أودو`
                        : `${fmtNum(totals.totalLeads)} in Odoo`,
                  }}
                />
                <MetricCardDetailTrigger
                  detail={metrics!.cpl}
                  card={{
                    metric: "cpl",
                    index: 2,
                    icon: <BadgeDollarSign size={14} />,
                    value: ratioCell(totals.cpl, spend, fmtUSDFull),
                    unavailableReason,
                    note: spendNote,
                  }}
                />
                <MetricCardDetailTrigger
                  detail={metrics!.revenue}
                  card={{
                    metric: "revenue",
                    index: 3,
                    icon: <CircleDollarSign size={14} />,
                    value: fmtUSD(totals.revenue),
                    sub:
                      lang === "ar"
                        ? `منها ${fmtUSD(totals.attributedRevenue)} مربوط بحملات`
                        : `${fmtUSD(totals.attributedRevenue)} linked to campaigns`,
                  }}
                />
                <MetricCardDetailTrigger
                  detail={metrics!.roas}
                  card={{
                    metric: "roas",
                    index: 4,
                    icon: <TrendingUp size={14} />,
                    value: ratioCell(totals.roas, spend, (v) => `${v.toFixed(2)}×`),
                    unavailableReason,
                    note:
                      spendNote ??
                      (lang === "ar"
                        ? `البسط هنا هو كل التحصيل في الفترة (${fmtUSD(totals.revenue)})، مش الجزء المربوط بحملات (${fmtUSD(totals.attributedRevenue)}) — ده تعريف الإدارة المعتمد.`
                        : `The numerator is all revenue collected in the window (${fmtUSD(totals.revenue)}), not only the campaign-linked share (${fmtUSD(totals.attributedRevenue)}) — that is the approved definition.`),
                    verdict: roasVerdict(totals.roas, spend) ?? undefined,
                    verdictLabel: verdictWord(roasVerdict(totals.roas, spend), lang),
                  }}
                />
                <MetricCardDetailTrigger
                  detail={metrics!.conversion}
                  card={{
                    metric: "conversionRate",
                    index: 5,
                    icon: <Handshake size={14} />,
                    value: ratioCell(totals.conversionRate, totals.totalLeads, (v) => fmtPct(v, 2)),
                    sub:
                      lang === "ar"
                        ? `${fmtNum(totals.won)} من ${fmtNum(totals.totalLeads)}`
                        : `${fmtNum(totals.won)} of ${fmtNum(totals.totalLeads)}`,
                  }}
                />
              </KpiRow>

              <button
                onClick={() => setShowAllKpis((v) => !v)}
                aria-expanded={showAllKpis}
                className="inline-flex items-center gap-1.5 text-[13px] text-brand hover:underline cursor-pointer"
              >
                <ChevronDown
                  size={15}
                  className={`transition-transform ${showAllKpis ? "rotate-180" : ""}`}
                />
                {showAllKpis
                  ? lang === "ar"
                    ? "اخفي باقي المؤشرات"
                    : "Hide the rest"
                  : lang === "ar"
                    ? "وريني باقي المؤشرات"
                    : "Show the remaining metrics"}
              </button>

              {/* The rest of the figures. `KpiRow` measures the content column
                  instead of the viewport, so seven cards settle into balanced
                  rows rather than being squeezed six across. Each one opens the
                  same panel the headline figures do. */}
              {showAllKpis && (
                <KpiRow>
                  <MetricCardDetailTrigger
                    detail={extras!.ctr}
                    card={{
                      metric: "ctrAll",
                      index: 0,
                      icon: <MousePointerClick size={14} />,
                      value: ratioCell(totals.ctrAll, totals.impressions, (v) => fmtPct(v, 2)),
                      sub:
                        lang === "ar"
                          ? `${fmtNum(totals.clicksAll)} نقرة`
                          : `${fmtNum(totals.clicksAll)} clicks`,
                      note:
                        lang === "ar"
                          ? "النسبة موزونة: النقرات كلها ÷ مرات الظهور كلها، مش متوسط نِسَب الصفوف."
                          : "Weighted: total clicks ÷ total impressions, not an average of row percentages.",
                    }}
                  />
                  <MetricCardDetailTrigger
                    detail={metrics!.won}
                    card={{
                      metric: "won",
                      index: 1,
                      icon: <UserPlus size={14} />,
                      value: fmtNum(totals.won),
                    }}
                  />
                  <MetricCardDetailTrigger
                    detail={metrics!.lost}
                    card={{
                      metric: "lost",
                      index: 2,
                      icon: <UserMinus size={14} />,
                      value: fmtNum(totals.lost),
                    }}
                  />
                  <MetricCardDetailTrigger
                    detail={extras!.lostRate}
                    card={{
                      metric: "lostRate",
                      index: 3,
                      icon: <Percent size={14} />,
                      value: ratioCell(totals.lostRate, totals.totalLeads, (v) => fmtPct(v, 2)),
                    }}
                  />
                  <MetricCardDetailTrigger
                    detail={metrics!.cpa}
                    card={{
                      metric: "cpa",
                      index: 4,
                      icon: <BadgeDollarSign size={14} />,
                      value: ratioCell(totals.cpa, spend, fmtUSDFull),
                      unavailableReason,
                      note: spendNote,
                      sub:
                        lang === "ar"
                          ? `الأساس: ${filters.cpaBasis === "invoices" ? "عدد الفواتير" : "الصفقات الرابحة"}`
                          : `Basis: ${filters.cpaBasis === "invoices" ? "invoice count" : "won deals"}`,
                    }}
                  />
                  <MetricCardDetailTrigger
                    detail={metrics!.acos}
                    card={{
                      metric: "acos",
                      index: 5,
                      icon: <Percent size={14} />,
                      value: ratioCell(totals.acos, spend, (v) => fmtPct(v, 1)),
                      unavailableReason,
                      note:
                        spendNote ??
                        (lang === "ar"
                          ? "المقام هنا هو كل التحصيل في الفترة، زي ROAS بالظبط."
                          : "The denominator is all revenue collected in the window, exactly as in ROAS."),
                      verdict: (spend > 0 ? acosVerdict(totals.acos) : null) ?? undefined,
                      verdictLabel: verdictWord(spend > 0 ? acosVerdict(totals.acos) : null, lang),
                    }}
                  />
                  <MetricCardDetailTrigger
                    detail={extras!.attributedRevenue}
                    card={{
                      metric: "attributedRevenue",
                      index: 6,
                      icon: <CircleDollarSign size={14} />,
                      value: fmtUSD(totals.attributedRevenue),
                      sub:
                        lang === "ar"
                          ? `${fmtPct((totals.attributedRevenue / (totals.revenue || 1)) * 100, 1)} من التحصيل`
                          : `${fmtPct((totals.attributedRevenue / (totals.revenue || 1)) * 100, 1)} of collections`,
                    }}
                  />
                </KpiRow>
              )}

              <CampaignPurposeSpend sections={data.spendSections ?? []} />

              {/* --- charts ------------------------------------------------ */}
              <div className="card-grid lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <SectionTitle
                    hint={
                      lang === "ar"
                        ? "الإنفاق والتحصيل على المحور الشمال، وعدد الليدز على محور لوحده عشان ما يتلغيش جنبهم"
                        : "Spend and collections on the left axis; lead counts on their own axis so they stay visible"
                    }
                  >
                    {lang === "ar" ? "الحركة اليومية" : "Day by day"}
                  </SectionTitle>
                  <MultiLineChart
                    data={data.trend}
                    height={280}
                    format={(v) => fmtNum(v)}
                    series={[
                      {
                        key: "spend",
                        name: lang === "ar" ? "الإنفاق" : "Spend",
                        color: "var(--chart-1)",
                      },
                      {
                        key: "revenue",
                        name: lang === "ar" ? "الإيراد المحصّل" : "Collected revenue",
                        color: "var(--chart-2)",
                      },
                      {
                        key: "leads",
                        name: lang === "ar" ? "الليدز" : "Leads",
                        color: "var(--chart-3)",
                        axis: "right",
                      },
                    ]}
                  />
                </Card>

                <Card>
                  <SectionTitle
                    hint={
                      lang === "ar"
                        ? "من ليد المنصة لحد الصفقة"
                        : "From a platform lead to a closed deal"
                    }
                  >
                    {t("funnel")}
                  </SectionTitle>
                  <MiniFunnel
                    platformLeads={totals.platformLeads}
                    crmLeads={totals.totalLeads}
                    won={totals.won}
                    lost={totals.lost}
                    conversionRate={totals.conversionRate}
                    lostRate={totals.lostRate}
                    spendAvailable={!noSpendTab}
                  />
                </Card>
              </div>

              <div className="card-grid lg:grid-cols-2">
                <Card>
                  <SectionTitle
                    action={<GrainPill grain={grain} />}
                    hint={
                      lang === "ar"
                        ? "كل الصفوف اللي صرفت في الفترة؛ الأزرق إنفاق والبرتقالي تحصيل. مرّر داخل الكارت لعرضهم كلهم."
                        : "Every row with period spend; blue is spend and orange is collected revenue. Scroll inside the card to see them all."
                    }
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <BarChart3 size={15} className="text-text-subtle" />
                      {lang === "ar" ? "الإنفاق مقابل التحصيل" : "Spend against collections"}
                    </span>
                  </SectionTitle>
                  <div className="max-h-[720px] overflow-y-auto pe-1 scrollbar-thin">
                    <CompareBars
                      rows={[...data.rows]
                        .filter((r) => r.spend > 0)
                        .sort((a, b) => b.spend - a.spend)}
                      emptyLabel={
                        noSpendTab
                          ? lang === "ar"
                            ? "المنصة دي مالهاش بيانات إنفاق في المصدر الحالي، فمفيش مقارنة إنفاق تتعرض"
                            : "This platform has no spend data in the current source, so there is nothing to compare"
                          : undefined
                      }
                    />
                  </div>
                </Card>

                <Card>
                  <SectionTitle
                    action={<GrainPill grain={grain} />}
                    hint={
                      lang === "ar"
                        ? "كل نقطة صف واحد. اللي فوق الخط المتقطّع رجّع أكتر مما صرف."
                        : "Each dot is one row. Anything above the dashed line returned more than it cost."
                    }
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <ScatterIcon size={15} className="text-text-subtle" />
                      {lang === "ar"
                        ? "هل الإنفاق الأكبر بيجيب تحصيل أكبر؟"
                        : "Does more spend buy more?"}
                    </span>
                  </SectionTitle>
                  <ScatterPlot
                    height={320}
                    emptyLabel={
                      noSpendTab
                        ? lang === "ar"
                          ? "المنصة دي مالهاش بيانات إنفاق في المصدر الحالي، فمفيش مقارنة إنفاق تتعرض"
                          : "This platform has no spend data in the current source, so there is nothing to compare"
                        : undefined
                    }
                    breakEven
                    xName={lang === "ar" ? "الإنفاق" : "Spend"}
                    yName={lang === "ar" ? "الإيراد المحصّل" : "Collected revenue"}
                    points={data.rows
                      .filter((r) => r.spend > 0)
                      .map((r) => ({
                        x: r.spend,
                        y: r.revenue,
                        label: r.name || "—",
                        color: PLATFORM_COLOR[r.platforms[0] ?? "meta"],
                      }))}
                  />
                </Card>
              </div>

              <PlatformDetails blocks={data.byPlatform} byDay={data.byDay} />

              <PerfExplorer
                rows={data.rows}
                grain={grain}
                onGrainChange={setGrain}
                unknownAdsetKey={data.unknownAdsetKey}
                csvPrefix="engosoft-ads"
                spendAvailable={!noSpendTab}
                spendNote={spendNote}
                title={lang === "ar" ? "الجدول التفصيلي" : "The detailed table"}
                subtitle={
                  lang === "ar"
                    ? "الحملة ← المجموعة الإعلانية ← الإعلان. دوس على أي صف تشوف تفاصيله والمستوى اللي تحته."
                    : "Campaign → ad set → ad. Click any row for its detail and the level beneath it."
                }
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function GrainPill({ grain }: { grain: Grain }) {
  const { t } = useI18n();
  return (
    <Pill tone="neutral">
      {grain === "campaign" ? t("campaign") : grain === "adset" ? t("ad_set") : t("ad_name")}
    </Pill>
  );
}

function SpendSplit({ totals }: { totals: Totals }) {
  const { lang } = useI18n();
  const parts = [
    totals.spendMeta > 0 ? `${PLATFORM_LABEL.meta[lang]} ${fmtUSD(totals.spendMeta)}` : "",
    totals.spendSnap > 0 ? `${PLATFORM_LABEL.snapchat[lang]} ${fmtUSD(totals.spendSnap)}` : "",
    totals.spendTikTok > 0 ? `${PLATFORM_LABEL.tiktok[lang]} ${fmtUSD(totals.spendTikTok)}` : "",
    totals.spendGoogle > 0 ? `${PLATFORM_LABEL.google[lang]} ${fmtUSD(totals.spendGoogle)}` : "",
  ].filter(Boolean);
  return <>{parts.join(" · ")}</>;
}

function CampaignPurposeSpend({ sections }: { sections: CampaignSpendSection[] }) {
  const { lang } = useI18n();
  if (!sections.some((section) => section.spend > 0)) return null;

  return (
    <section>
      <SectionTitle
        hint={
          lang === "ar"
            ? "تصنيف مباشر من اسم الحملة؛ الويبنار لا يدخل ضمن حملات الموقع."
            : "Classified directly from campaign names; webinar spend never enters Website."
        }
      >
        {lang === "ar" ? "الصرف حسب غرض الحملة" : "Spend by campaign purpose"}
      </SectionTitle>
      <div className="card-grid lg:grid-cols-2">
        {sections.map((section) => {
          const website = section.purpose === "website";
          const color = website ? "var(--brand)" : "var(--warning)";
          const soft = website ? "var(--brand-soft)" : "var(--warning-soft)";
          const Icon = website ? Globe2 : Presentation;
          return (
            <Card
              key={section.purpose}
              className="overflow-hidden"
              style={{
                background: `linear-gradient(145deg, ${soft}, var(--surface) 55%)`,
                borderColor: `color-mix(in oklab, ${color} 25%, var(--border))`,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                    style={{ background: soft, color }}
                  >
                    <Icon size={19} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-text">
                      {website
                        ? lang === "ar"
                          ? "حملات الموقع · web / web con / con"
                          : "Website · web / web con / con"
                        : lang === "ar"
                          ? "حملات الويبنار"
                          : "Webinar campaigns"}
                    </h3>
                    <p className="mt-0.5 text-[10.5px] text-text-muted">
                      {website
                        ? lang === "ar"
                          ? "صرف زيارات وتحويلات الموقع"
                          : "Website traffic and conversion spend"
                        : lang === "ar"
                          ? "سيكشن مستقل عن الموقع"
                          : "Reported separately from Website"}
                    </p>
                  </div>
                </div>
                {website && (
                  <Link
                    to="/website"
                    className="shrink-0 text-[11px] font-semibold text-brand hover:underline"
                  >
                    {lang === "ar" ? "تفاصيل الموقع" : "Website detail"}
                  </Link>
                )}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <PurposeFact
                  label={lang === "ar" ? "إجمالي الصرف" : "Total spend"}
                  value={fmtUSDFull(section.spend)}
                />
                <PurposeFact
                  label={lang === "ar" ? "حملات صرفت" : "Spending campaigns"}
                  value={fmtNum(section.campaigns)}
                />
                <PurposeFact
                  label={lang === "ar" ? "نتائج المنصة" : "Platform results"}
                  value={fmtNum(section.platformResults)}
                />
              </div>

              <div className="mt-4 space-y-2 border-t border-border/70 pt-3">
                {section.rows.slice(0, 4).map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: PLATFORM_COLOR[row.platform] }}
                      />
                      <span className="truncate text-text" dir="auto" title={row.campaign}>
                        {row.campaign}
                      </span>
                    </div>
                    <span className="num shrink-0 font-semibold text-text">
                      {fmtUSD(row.spend)}
                    </span>
                  </div>
                ))}
                {!section.rows.length && (
                  <p className="py-2 text-center text-xs text-text-muted">
                    {lang === "ar" ? "لا يوجد صرف في الفترة" : "No spend in this period"}
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function PurposeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/75 p-2.5">
      <div className="text-[9.5px] leading-tight text-text-muted">{label}</div>
      <div className="num mt-1 text-sm font-semibold text-text">{value}</div>
    </div>
  );
}

/* --- per-platform state ---------------------------------------------------- */

/**
 * The honest paragraph about the selected platform.
 *
 * Snapchat reports native leads but no link clicks; TikTok produces thousands of
 * CRM leads with no spend tab at all. Both are stated here in words rather than
 * being left for the reader to infer from a column of dashes.
 */
function PlatformState({
  selected,
  coverage,
  allCoverage,
  health,
}: {
  selected?: AcquisitionChannel;
  coverage?: PlatformCoverage;
  allCoverage: PlatformCoverage[];
  health: DataHealth;
}) {
  const { lang } = useI18n();

  if (!selected) {
    const noSpend = allCoverage.filter((c) => !c.spendAvailable && c.crmLeads > 0);
    if (!noSpend.length) return null;
    return (
      <Notice
        tone="warning"
        title={lang === "ar" ? "إنفاق ناقص من المصدر" : "Missing spend in the source"}
        icon={<Info size={16} />}
      >
        {lang === "ar"
          ? `${noSpend
              .map(
                (c) => `${ACQUISITION_CHANNEL_LABEL[c.platform].ar} (${fmtNum(c.crmLeads)} عميل)`,
              )
              .join(
                "، ",
              )} بتجيب عملاء لكن مفيش لها تبويب إنفاق في الملف. يعني تكلفة العميل وتكلفة الصفقة بيظهروا أرخص من الحقيقة، والعائد أعلى من الحقيقة. الأرقام بتتظبط أول ما يتعمل التبويب.`
          : `${noSpend
              .map(
                (c) => `${ACQUISITION_CHANNEL_LABEL[c.platform].en} (${fmtNum(c.crmLeads)} leads)`,
              )
              .join(
                ", ",
              )} produce leads but have no spend tab in the workbook, so CPL and CPA read cheaper than reality and ROAS reads higher. The figures correct themselves the moment the tab exists.`}
      </Notice>
    );
  }

  if (!coverage) return null;

  if (selected === "organic") {
    return (
      <Notice
        tone="info"
        title={
          lang === "ar"
            ? "أورجانيك: مبيعات من مصادر Odoo غير المدفوعة"
            : "Organic: sales from non-paid Odoo sources"
        }
        icon={<Info size={16} />}
      >
        {lang === "ar"
          ? `التقرير ده بيجمع مصادر Odoo غير المدفوعة زي الموقع وUChat وواتساب والترشيحات والمكالمات والـwebinars. فيه ${fmtNum(coverage.crmLeads)} عميل، ${fmtNum(coverage.won)} صفقة رابحة، وتحصيل ${fmtUSD(coverage.revenue)}. الإنفاق الإعلاني صفر لأن الصفوف دي مش من منصات الإعلانات.`
          : `This view groups non-paid Odoo sources such as Website, UChat, WhatsApp, recommendations, phone calls and webinars. It contains ${fmtNum(coverage.crmLeads)} leads, ${fmtNum(coverage.won)} won deals and ${fmtUSD(coverage.revenue)} collected. Paid-media spend is zero because these rows do not come from ad platforms.`}
      </Notice>
    );
  }

  if (!coverage.spendAvailable) {
    return (
      <Notice
        tone="warning"
        title={
          lang === "ar"
            ? `${ACQUISITION_CHANNEL_LABEL[selected].ar}: بيانات الإنفاق والحملات غير متاحة في المصدر الحالي`
            : `${ACQUISITION_CHANNEL_LABEL[selected].en}: spend and campaign data are not available in the current source`
        }
        icon={<Info size={16} />}
      >
        {lang === "ar"
          ? `اللي متاح دلوقتي هو ${fmtNum(coverage.crmLeads)} عميل محتمل جايين من الـCRM، منهم ${fmtNum(coverage.won)} صفقة رابحة و${fmtNum(coverage.lost)} ضايعة، وتحصيل ${fmtUSD(coverage.revenue)}. مفيش تبويب إعلانات للمنصة دي، فتكلفة العميل وتكلفة الصفقة والعائد ونسبة الإنفاق للإيراد كلها بتظهر شرطة — إحنا مش بنفترض إنفاق مش موجود.`
          : `What exists today is ${fmtNum(coverage.crmLeads)} CRM leads, of which ${fmtNum(coverage.won)} won and ${fmtNum(coverage.lost)} lost, plus ${fmtUSD(coverage.revenue)} collected. There is no ad tab for this platform, so CPL, CPA, ROAS and ACOS all render as a dash — no spend is assumed that the source does not have.`}
      </Notice>
    );
  }

  const gaps: string[] = [];
  if (coverage.linkClicks === null)
    gaps.push(lang === "ar" ? "نقرات الرابط ونسبة نقر الرابط" : "link clicks and link CTR");
  if (coverage.platformLeads === null)
    gaps.push(lang === "ar" ? "عدد الليدز من المنصة" : "the platform lead count");

  if (!gaps.length) return null;

  return (
    <Notice
      tone="info"
      title={
        lang === "ar"
          ? `${ACQUISITION_CHANNEL_LABEL[selected].ar}: مؤشرات مش موجودة في التصدير`
          : `${ACQUISITION_CHANNEL_LABEL[selected].en}: metrics absent from the export`
      }
      icon={<Info size={16} />}
    >
      {lang === "ar"
        ? `التصدير الحالي مفيهوش ${gaps.join(" و")}. المؤشرات دي بتظهر شرطة مش صفر، وباقي الأرقام سليمة.`
        : `The current export does not contain ${gaps.join(" and ")}. Those render as a dash rather than a zero; everything else is unaffected.`}
      {health.adsetResolutionRate < 1 && (
        <span className="block mt-1 opacity-90">
          {lang === "ar"
            ? `نسبة استنتاج المجموعات الإعلانية دلوقتي ${fmtPct(health.adsetResolutionRate * 100, 1)}.`
            : `Ad-set resolution currently stands at ${fmtPct(health.adsetResolutionRate * 100, 1)}.`}
        </span>
      )}
    </Notice>
  );
}

/* --- per-platform technical detail ----------------------------------------- */

function PlatformDetails({
  blocks,
  byDay,
}: {
  blocks: PlatformBlock[];
  byDay: ({ date: string; impressions: number; clicks: number } & Record<Platform, number>)[];
}) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);

  if (!blocks.length) return null;

  return (
    <Card padded={false}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 text-start cursor-pointer hover:bg-surface-2 transition-colors rounded-lg"
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-text">
            {lang === "ar" ? "تفاصيل كل منصة" : "Per-platform detail"}
          </span>
          <span className="block text-xs text-text-muted mt-0.5">
            {lang === "ar"
              ? "الأرقام الخام لكل منصة: الظهور والنقرات وتكلفة الألف وتكلفة النقرة، والإنفاق اليومي"
              : "Raw per-platform figures: impressions, clicks, CPM, CPC and daily spend"}
          </span>
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-5 space-y-4 border-t border-border pt-4">
          <div className="card-grid md:grid-cols-2 xl:grid-cols-3">
            {blocks.map((b) => (
              <PlatformBlockCard key={b.platform} block={b} />
            ))}
          </div>

          <div>
            <SectionTitle
              hint={lang === "ar" ? "الإنفاق اليومي لكل منصة" : "Daily spend per platform"}
            >
              {lang === "ar" ? "الإنفاق حسب اليوم" : "Spend by day"}
            </SectionTitle>
            <MultiLineChart
              data={byDay}
              format={fmtUSD}
              series={blocks.map(({ platform }) => ({
                key: platform,
                name: PLATFORM_LABEL[platform][lang],
                color: PLATFORM_COLOR[platform],
              }))}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function PlatformBlockCard({ block }: { block: PlatformBlock }) {
  const { lang } = useI18n();
  const rows: { key: MetricKey; value: React.ReactNode }[] = [
    { key: "spend", value: fmtUSDFull(block.spend) },
    { key: "impressions", value: fmtNum(block.impressions) },
    { key: "clicks", value: fmtNum(block.clicksAll) },
    { key: "ctrAll", value: ratioCell(block.ctrAll, block.impressions, (v) => fmtPct(v, 2)) },
    { key: "ctrLink", value: ratioCell(block.ctrLink, block.linkClicks ?? 0, (v) => fmtPct(v, 2)) },
    { key: "cpm", value: ratioCell(block.cpm, block.spend, fmtUSDFull) },
    { key: "cpc", value: ratioCell(block.cpc, block.spend, fmtUSDFull) },
    {
      key: "platformLeads",
      value: block.platformLeads === null ? <Unavailable compact /> : fmtNum(block.platformLeads),
    },
    { key: "cpl", value: ratioCell(block.platformCpl, block.spend, fmtUSDFull) },
  ];

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: PLATFORM_COLOR[block.platform] }}
            />
            <span className="text-[14px] font-semibold text-text">
              {PLATFORM_LABEL[block.platform][lang]}
            </span>
          </span>
          <p className="text-[11px] text-text-muted mt-0.5 num">
            {block.dateMin} → {block.dateMax} · {fmtNum(block.rows)} {lang === "ar" ? "صف" : "rows"}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <dt className="text-text-muted py-1 border-b border-border/60 flex items-center gap-1 min-w-0">
              <span className="truncate">{METRICS[r.key][lang].short}</span>
              <MetricInfo metric={r.key} size={11} />
            </dt>
            <dd className="text-end num font-medium py-1 border-b border-border/60">{r.value}</dd>
          </div>
        ))}
      </dl>

      {block.viewCompletions !== null && (
        <p className="text-[11px] text-text-muted mt-2">
          {lang === "ar" ? "مشاهدات مكتملة" : "View completions"}:{" "}
          <span className="num">{fmtNum(block.viewCompletions)}</span>
        </p>
      )}

      <p className="mt-3 text-[11px] text-text-subtle leading-relaxed">
        {lang === "ar" ? "الحسابات الإعلانية" : "Ad accounts"}: {block.accounts.join(" · ")}
      </p>
    </div>
  );
}
