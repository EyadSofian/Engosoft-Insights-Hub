import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  BadgeDollarSign,
  BarChart3,
  ChevronDown,
  CircleDollarSign,
  Handshake,
  Info,
  MousePointerClick,
  Percent,
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
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
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
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/constants";
import type { DataHealth, Maybe, PerfRow, Platform, Totals } from "@/lib/types";

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
  grain: Grain;
  rows: PerfRow[];
  unknownAdsetKey: string;
  accounts: { name: string; objective: string; spend: number; platformLeads: number | null }[];
  health: DataHealth;
}

function Ads() {
  const { t, lang } = useI18n();
  const filters = useFilters();
  const [grain, setGrain] = useState<Grain>("campaign");
  const [showAllKpis, setShowAllKpis] = useState(false);
  const { data, isLoading, error, refetch } = useApi<Resp>(`/api/ads?grain=${grain}`);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const selected = filters.platform;
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
      ? `${PLATFORM_LABEL[selected!][lang]} مالهاش تبويب إنفاق في المصدر الحالي، فالإنفاق وكل المؤشرات المبنية عليه غير متاحة.`
      : `${PLATFORM_LABEL[selected!][lang]} has no spend tab in the current source, so spend and every metric built on it are unavailable.`
    : undefined;

  const unavailableReason = noSpendTab
    ? spendNote
    : spend <= 0
      ? lang === "ar"
        ? "مفيش إنفاق مسجّل في الفترة المختارة."
        : "No recorded spend in the selected period."
      : undefined;

  const nothingAtAll =
    !!selectedCoverage && selectedCoverage.adRows === 0 && selectedCoverage.crmLeads === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={t("ads_tech")}
          subtitle={
            lang === "ar"
              ? "الإنفاق والعملاء والتحصيل في مكان واحد. كل رقم عليه علامة استفهام بتقول جاي منين وبيتحسب إزاي، واللي مش متاح بيظهر شرطة مش صفر."
              : "Spend, leads and collections in one place. Every figure carries an info button explaining where it comes from, and anything unmeasurable renders as a dash, never a zero."
          }
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
              data.platformCoverageAll ?? { spend: totals.spend, crmLeads: totals.totalLeads }
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
                    ? `مفيش أي بيانات لـ${PLATFORM_LABEL[selected!][lang]} في الفترة دي`
                    : `No ${PLATFORM_LABEL[selected!].en} data in this period`
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
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                <MetricCard
                  metric="spend"
                  index={0}
                  icon={<Wallet size={14} />}
                  value={fmtUSD(totals.spend)}
                  unavailableReason={noSpendTab ? spendNote : undefined}
                  sub={<SpendSplit totals={totals} />}
                  note={spendNote}
                />
                <MetricCard
                  metric="platformLeads"
                  index={1}
                  icon={<Users size={14} />}
                  value={
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
                    )
                  }
                  sub={
                    lang === "ar"
                      ? `${fmtNum(totals.totalLeads)} في أودو`
                      : `${fmtNum(totals.totalLeads)} in Odoo`
                  }
                />
                <MetricCard
                  metric="cpl"
                  index={2}
                  icon={<BadgeDollarSign size={14} />}
                  value={ratioCell(totals.cpl, spend, fmtUSDFull)}
                  unavailableReason={unavailableReason}
                  note={spendNote}
                />
                <MetricCard
                  metric="revenue"
                  index={3}
                  icon={<CircleDollarSign size={14} />}
                  value={fmtUSD(totals.revenue)}
                  sub={
                    lang === "ar"
                      ? `منها ${fmtUSD(totals.attributedRevenue)} مربوط بحملات`
                      : `${fmtUSD(totals.attributedRevenue)} linked to campaigns`
                  }
                />
                <MetricCard
                  metric="roas"
                  index={4}
                  icon={<TrendingUp size={14} />}
                  value={ratioCell(totals.roas, spend, (v) => `${v.toFixed(2)}×`)}
                  unavailableReason={unavailableReason}
                  note={
                    spendNote ??
                    (lang === "ar"
                      ? `البسط هنا هو كل التحصيل في الفترة (${fmtUSD(totals.revenue)})، مش الجزء المربوط بحملات (${fmtUSD(totals.attributedRevenue)}) — ده تعريف الإدارة المعتمد.`
                      : `The numerator is all revenue collected in the window (${fmtUSD(totals.revenue)}), not only the campaign-linked share (${fmtUSD(totals.attributedRevenue)}) — that is the approved definition.`)
                  }
                  verdict={roasVerdict(totals.roas, spend) ?? undefined}
                  verdictLabel={verdictWord(roasVerdict(totals.roas, spend), lang)}
                />
                <MetricCard
                  metric="conversionRate"
                  index={5}
                  icon={<Handshake size={14} />}
                  value={ratioCell(totals.conversionRate, totals.totalLeads, (v) => fmtPct(v, 2))}
                  sub={
                    lang === "ar"
                      ? `${fmtNum(totals.won)} من ${fmtNum(totals.totalLeads)}`
                      : `${fmtNum(totals.won)} of ${fmtNum(totals.totalLeads)}`
                  }
                />
              </div>

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

              {showAllKpis && (
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                  <MetricCard
                    metric="ctrAll"
                    index={0}
                    icon={<MousePointerClick size={14} />}
                    value={ratioCell(totals.ctrAll, totals.impressions, (v) => fmtPct(v, 2))}
                    sub={
                      lang === "ar"
                        ? `${fmtNum(totals.clicksAll)} نقرة`
                        : `${fmtNum(totals.clicksAll)} clicks`
                    }
                    note={
                      lang === "ar"
                        ? "النسبة موزونة: النقرات كلها ÷ مرات الظهور كلها، مش متوسط نِسَب الصفوف."
                        : "Weighted: total clicks ÷ total impressions, not an average of row percentages."
                    }
                  />
                  <MetricCard
                    metric="won"
                    index={1}
                    icon={<UserPlus size={14} />}
                    value={fmtNum(totals.won)}
                  />
                  <MetricCard
                    metric="lost"
                    index={2}
                    icon={<UserMinus size={14} />}
                    value={fmtNum(totals.lost)}
                  />
                  <MetricCard
                    metric="lostRate"
                    index={3}
                    icon={<Percent size={14} />}
                    value={ratioCell(totals.lostRate, totals.totalLeads, (v) => fmtPct(v, 2))}
                  />
                  <MetricCard
                    metric="cpa"
                    index={4}
                    icon={<BadgeDollarSign size={14} />}
                    value={ratioCell(totals.cpa, spend, fmtUSDFull)}
                    unavailableReason={unavailableReason}
                    note={spendNote}
                    sub={
                      lang === "ar"
                        ? `الأساس: ${filters.cpaBasis === "invoices" ? "عدد الفواتير" : "الصفقات المكسوبة"}`
                        : `Basis: ${filters.cpaBasis === "invoices" ? "invoice count" : "won deals"}`
                    }
                  />
                  <MetricCard
                    metric="acos"
                    index={5}
                    icon={<Percent size={14} />}
                    value={ratioCell(totals.acos, spend, (v) => fmtPct(v, 1))}
                    unavailableReason={unavailableReason}
                    note={
                      spendNote ??
                      (lang === "ar"
                        ? "المقام هنا هو كل التحصيل في الفترة، زي ROAS بالظبط."
                        : "The denominator is all revenue collected in the window, exactly as in ROAS.")
                    }
                    verdict={(spend > 0 ? acosVerdict(totals.acos) : null) ?? undefined}
                    verdictLabel={verdictWord(spend > 0 ? acosVerdict(totals.acos) : null, lang)}
                  />
                  <MetricCard
                    metric="attributedRevenue"
                    index={6}
                    icon={<CircleDollarSign size={14} />}
                    value={fmtUSD(totals.attributedRevenue)}
                    sub={
                      lang === "ar"
                        ? `${fmtPct((totals.attributedRevenue / (totals.revenue || 1)) * 100, 1)} من التحصيل`
                        : `${fmtPct((totals.attributedRevenue / (totals.revenue || 1)) * 100, 1)} of collections`
                    }
                  />
                </div>
              )}

              {/* --- charts ------------------------------------------------ */}
              <div className="grid gap-4 lg:grid-cols-3">
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

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <SectionTitle
                    action={<GrainPill grain={grain} />}
                    hint={
                      lang === "ar"
                        ? "أعلى ٨ صفوف إنفاقًا، وتحت كل واحدة عمودين: الأزرق الإنفاق والبرتقالي التحصيل"
                        : "The eight biggest spenders, each with spend in blue above the revenue it brought back in orange"
                    }
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <BarChart3 size={15} className="text-text-subtle" />
                      {lang === "ar" ? "الإنفاق مقابل التحصيل" : "Spend against collections"}
                    </span>
                  </SectionTitle>
                  <CompareBars
                    rows={[...data.rows]
                      .filter((r) => r.spend > 0)
                      .sort((a, b) => b.spend - a.spend)
                      .slice(0, 8)}
                    emptyLabel={
                      noSpendTab
                        ? lang === "ar"
                          ? "المنصة دي مالهاش بيانات إنفاق في المصدر الحالي، فمفيش مقارنة إنفاق تتعرض"
                          : "This platform has no spend data in the current source, so there is nothing to compare"
                        : undefined
                    }
                  />
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
  selected?: Platform;
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
              .map((c) => `${PLATFORM_LABEL[c.platform].ar} (${fmtNum(c.crmLeads)} عميل)`)
              .join(
                "، ",
              )} بتجيب عملاء لكن مفيش لها تبويب إنفاق في الملف. يعني تكلفة العميل وتكلفة الصفقة بيظهروا أرخص من الحقيقة، والعائد أعلى من الحقيقة. الأرقام بتتظبط أول ما يتعمل التبويب.`
          : `${noSpend
              .map((c) => `${PLATFORM_LABEL[c.platform].en} (${fmtNum(c.crmLeads)} leads)`)
              .join(
                ", ",
              )} produce leads but have no spend tab in the workbook, so CPL and CPA read cheaper than reality and ROAS reads higher. The figures correct themselves the moment the tab exists.`}
      </Notice>
    );
  }

  if (!coverage) return null;

  if (!coverage.spendAvailable) {
    return (
      <Notice
        tone="warning"
        title={
          lang === "ar"
            ? `${PLATFORM_LABEL[selected].ar}: بيانات الإنفاق والحملات غير متاحة في المصدر الحالي`
            : `${PLATFORM_LABEL[selected].en}: spend and campaign data are not available in the current source`
        }
        icon={<Info size={16} />}
      >
        {lang === "ar"
          ? `اللي متاح دلوقتي هو ${fmtNum(coverage.crmLeads)} عميل محتمل جايين من الـCRM، منهم ${fmtNum(coverage.won)} صفقة مكسوبة و${fmtNum(coverage.lost)} ضايعة، وتحصيل ${fmtUSD(coverage.revenue)}. مفيش تبويب إعلانات للمنصة دي، فتكلفة العميل وتكلفة الصفقة والعائد ونسبة الإنفاق للإيراد كلها بتظهر شرطة — إحنا مش بنفترض إنفاق مش موجود.`
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
          ? `${PLATFORM_LABEL[selected].ar}: مؤشرات مش موجودة في التصدير`
          : `${PLATFORM_LABEL[selected].en}: metrics absent from the export`
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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
