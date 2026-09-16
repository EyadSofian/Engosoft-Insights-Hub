import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  CircleDollarSign,
  Megaphone,
  TrendingUp,
  Target,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { useFilters } from "@/lib/filter-store";
import { hasReportableLost } from "@/lib/lost-authority";
import { fmtNum, fmtPct, fmtRoas, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { Card, ErrorState, Pill, SectionTitle, Skeleton } from "@/components/ui-bits";
import {
  DashboardPageHeader,
  DataHealthSummary,
  InsightCard,
  InsightRow,
  KpiRow,
  MoreDetails,
  PageSection,
  PageSections,
} from "@/components/dashboard-bits";
import { MetricCardDetailTrigger, MetricDrilldown } from "@/components/metric-detail";
import { standardMetrics } from "@/components/standard-metrics";
import type { MetricDetail } from "@/lib/metric-detail";
import { campaignReturnBand } from "@/lib/campaign-return-band";
import { CompareBars } from "@/components/ads/CompareBars";
import { CampaignActivityPanel } from "@/components/CampaignActivityPanel";
import { OverviewCampaignRecords } from "@/components/overview-records";
import { CampaignDetail, type CampaignTab } from "@/components/campaigns/CampaignDetail";
import { roasVerdict, verdictWord } from "@/components/ads/verdict";
import { MetricsGlossaryButton } from "@/components/ads/MetricsGlossary";
import { FilterSummary } from "@/components/ads/FilterSummary";
import { PerfExplorer, type Grain } from "@/components/ads/PerfExplorer";
import { ratioCell } from "@/components/ads/cells";
import type { CampaignActivity, DataHealth, PerfRow, Totals } from "@/lib/types";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

type CampaignsSearch = {
  view?: "attributedRevenue";
  /** The campaign whose detail is open, by its stable performance key. */
  campaign?: string;
  tab?: CampaignTab;
};

const CAMPAIGN_TABS: CampaignTab[] = ["overview", "ads", "sales"];

export const Route = createFileRoute("/campaigns")({
  validateSearch: (search: Record<string, unknown>): CampaignsSearch => ({
    view: search.view === "attributedRevenue" ? "attributedRevenue" : undefined,
    campaign: typeof search.campaign === "string" && search.campaign ? search.campaign : undefined,
    tab: CAMPAIGN_TABS.includes(search.tab as CampaignTab)
      ? (search.tab as CampaignTab)
      : undefined,
  }),
  component: Campaigns,
});

interface Resp {
  grain: Grain;
  rows: PerfRow[];
  totals: Totals;
  activity: CampaignActivity;
  unknownAdsetKey: string;
  health: DataHealth;
}

interface WebsiteChannelData {
  totals?: { leads: number; won: number; sales: number };
}

const CHANNEL_TONES = [
  { accent: "var(--sky-strong)", surface: "var(--sky-surface)" },
  { accent: "var(--mint-strong)", surface: "var(--mint-surface)" },
  { accent: "var(--violet-strong)", surface: "var(--violet-surface)" },
  { accent: "var(--amber-strong)", surface: "var(--amber-surface)" },
  { accent: "var(--rose-strong)", surface: "var(--rose-surface)" },
  { accent: "var(--sky-strong)", surface: "var(--sky-surface)" },
] as const;

function ChannelCard({
  label,
  icon,
  to,
  value,
  detail,
  connected,
  index,
  lang,
}: {
  label: string;
  icon: ReactNode;
  to: string;
  value: string;
  detail: string;
  connected: boolean;
  index: number;
  lang: "ar" | "en";
}) {
  const tone = CHANNEL_TONES[index % CHANNEL_TONES.length];
  return (
    <Link to={to as never} className="block min-w-0">
      <Card
        className="h-full overflow-hidden border-border/80 p-3 transition-transform hover:-translate-y-0.5"
        style={{ borderTop: `3px solid ${tone.accent}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <span
            className="grid size-8 place-items-center rounded-xl"
            style={{ background: tone.surface, color: tone.accent }}
            aria-hidden="true"
          >
            {icon}
          </span>
          <span className="text-[11px] font-bold text-text-subtle">↗</span>
        </div>
        <p className="mt-3 truncate text-[12px] font-bold text-text" title={label}>
          {label}
        </p>
        <p className="mt-1 text-lg font-black tracking-tight text-text">{value}</p>
        <p className={`mt-1 text-[10.5px] ${connected ? "text-text-muted" : "text-text-subtle"}`}>
          {detail}
        </p>
        {!connected && (
          <p className="mt-2 text-[10px] font-semibold text-text-subtle">
            {lang === "ar" ? "المصدر غير متصل" : "Source not connected"}
          </p>
        )}
      </Card>
    </Link>
  );
}

/**
 * The three campaigns worth naming, read straight off the rows the API already
 * returned for this window.
 *
 * This is a presentation view model and nothing more: no row is re-scored and
 * no threshold is invented. "Best" and "needs attention" are decided by
 * `campaignReturnBand`, the same scale the table cells and the return-band
 * tests use, so a campaign can never be green in one place and red in another.
 */
function campaignHeadlines(rows: PerfRow[]) {
  const spending = rows.filter((row) => row.spend > 0);

  const best =
    spending
      .filter((row) => campaignReturnBand(row.spend, row.revenue) === "strong")
      .sort((a, b) => b.revenue - a.revenue)[0] ?? null;

  const leak =
    spending
      .filter((row) => campaignReturnBand(row.spend, row.revenue) === "loss")
      .sort((a, b) => b.spend - b.revenue - (a.spend - a.revenue))[0] ?? null;

  const bestCpl =
    spending
      .filter((row) => row.crmLeads > 0 && row.cpl !== null && isFinite(row.cpl))
      .sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity))[0] ?? null;

  return { best, leak, bestCpl, any: spending.length > 0 };
}

/**
 * Why each named campaign was named.
 *
 * An insight card that states a verdict and cannot be opened is an assertion.
 * These are the figures behind each one, so a reader can check the call before
 * acting on it.
 */
function headlineDetails(
  headline: ReturnType<typeof campaignHeadlines>,
  lang: "ar" | "en",
): { best: MetricDetail; leak: MetricDetail; bestCpl: MetricDetail } {
  const A = lang === "ar";
  const row = (
    id: string,
    title: string,
    value: string,
    tone: MetricDetail["tone"],
    definition: string,
    perf: PerfRow | null,
  ): MetricDetail => ({
    id,
    title,
    value,
    tone,
    definition,
    supporting: perf
      ? [
          { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSD(perf.spend) },
          {
            key: "revenue",
            label: A ? "الإيراد المرتبط" : "Linked revenue",
            value: fmtUSD(perf.revenue),
          },
          { key: "leads", label: A ? "عملاء" : "Leads", value: fmtNum(perf.crmLeads) },
          { key: "won", label: A ? "صفقات رابحة" : "Won", value: fmtNum(perf.won) },
        ]
      : undefined,
    report: { to: "/campaigns", label: A ? "افتح جدول الحملات" : "Open the campaign table" },
  });

  return {
    best: row(
      "campaigns.roas",
      A ? "أفضل حملة في الفترة" : "Best campaign this period",
      headline.best ? fmtUSD(headline.best.revenue) : "—",
      "mint",
      headline.best
        ? A
          ? `اختيرت لأنها أعادت أكثر من ضعف تكلفتها (${fmtRoas(headline.best.roas)}) وهي الأعلى إيرادًا بين الحملات التي بلغت هذا الحد.`
          : `Named because it returned more than twice its cost (${fmtRoas(headline.best.roas)}) and is the highest-earning campaign to clear that bar.`
        : A
          ? "لا توجد حملة صرفت وأعادت أكثر من ضعف تكلفتها في هذه الفترة، فلا توجد حملة تتصدر."
          : "No campaign both spent and returned more than twice its cost this period, so none leads.",
      headline.best,
    ),
    leak: row(
      "campaigns.spend",
      A ? "حملة تحتاج متابعة" : "Campaign needing attention",
      headline.leak ? fmtUSD(headline.leak.spend - headline.leak.revenue) : "—",
      "rose",
      headline.leak
        ? A
          ? `اختيرت لأن إنفاقها تجاوز الإيراد المرتبط بها، وهي أكبر فارق بين الإنفاق والعائد في الفترة. الفارق نفسه هو الرقم المعروض.`
          : `Named because its spend exceeded the revenue linked to it, by the largest margin in the period. That margin is the figure shown.`
        : A
          ? "كل حملة صرفت في الفترة غطّت تكلفتها على الأقل."
          : "Every campaign that spent this period at least covered its cost.",
      headline.leak,
    ),
    bestCpl: row(
      "campaigns.cpl",
      A ? "أفضل تكلفة لكل عميل محتمل" : "Best cost per lead",
      headline.bestCpl ? fmtUSDFull(headline.bestCpl.cpl ?? 0) : "—",
      "cyan",
      headline.bestCpl
        ? A
          ? "اختيرت لأنها أقل تكلفة لكل عميل محتمل بين الحملات التي صرفت وجاء منها عملاء في الفترة."
          : "Named because it has the lowest cost per lead among campaigns that both spent and produced leads this period."
        : A
          ? "لا توجد حملة صرفت وجاء منها عملاء في الفترة، فلا توجد تكلفة قابلة للمقارنة."
          : "No campaign both spent and produced leads this period, so there is no comparable cost.",
      headline.bestCpl,
    ),
  };
}

function Campaigns() {
  const { t, lang } = useI18n();
  const { view: initialView, campaign: openCampaign, tab: campaignTab } = Route.useSearch();
  const navigate = useNavigate({ from: "/campaigns" });
  const filters = useFilters();
  const [grain, setGrain] = useState<Grain>("campaign");
  // One panel for the three readings: whichever card was pressed last.
  // Declares this page to ENGO Nexus, so "حلل الصفحة دي" and "التاب ده"
  // have something to resolve against. Ids and state only — no figures.
  useRegisterNexusView("campaigns", { tab: "decision" });
  const { data, isLoading, error, refetch } = useApi<Resp>(`/api/campaigns?grain=${grain}`);
  const { data: websiteChannelData } = useApi<WebsiteChannelData>("/api/website");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const unknownRow = data?.rows.find((r) => r.key === data.unknownAdsetKey);
  const totals = data?.totals;
  const spend = totals?.spend ?? 0;
  const headline = campaignHeadlines(data?.rows ?? []);
  const metaRows = data?.rows.filter((row) => row.platforms.includes("meta")) ?? [];
  const metaLeads = metaRows.reduce((sum, row) => sum + (row.platformLeads ?? 0), 0);
  const websiteLeads = websiteChannelData?.totals?.leads ?? null;
  const websiteWon = websiteChannelData?.totals?.won ?? null;
  const period = filters.from && filters.to ? `${filters.from} → ${filters.to}` : undefined;
  // Built from the response already on screen — the drill-down never re-queries
  // and so can never disagree with the card that opened it.
  const metrics = totals
    ? standardMetrics({
        totals,
        rows: data?.rows ?? [],
        surface: "campaigns",
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
          won: {
            to: "/sales",
            label: lang === "ar" ? "فتح تقرير المبيعات" : "Open the sales report",
          },
        },
      })
    : null;
  const insights = headlineDetails(headline, lang);
  // The campaign the reader opened, if any: its own screen replaces the list
  // rather than unfolding underneath it.
  const detailRow = openCampaign
    ? (data?.rows.find((entry) => entry.key === openCampaign) ??
      data?.rows.find((entry) => entry.campaignKey === openCampaign))
    : undefined;
  const openDetail = (key: string) =>
    void navigate({
      search: (prev: CampaignsSearch) => ({ ...prev, campaign: key, tab: undefined }),
    });
  const closeDetail = () =>
    void navigate({
      search: (prev: CampaignsSearch) => ({ ...prev, campaign: undefined, tab: undefined }),
    });

  if (openCampaign && data && detailRow)
    return (
      <CampaignDetail
        row={detailRow}
        rows={data.rows}
        state={Object.values(data.activity.delivery).find(
          (entry) =>
            entry.campaignKey === detailRow.campaignKey || entry.campaignKey === detailRow.key,
        )}
        lostAvailable={hasReportableLost(data.health.lostAuthority)}
        tab={campaignTab ?? "overview"}
        onTab={(next) =>
          void navigate({
            search: (prev: CampaignsSearch) => ({
              ...prev,
              tab: next === "overview" ? undefined : next,
            }),
          })
        }
        onBack={closeDetail}
        period={period}
      />
    );

  return (
    <div>
      <DashboardPageHeader
        flush
        icon={<Megaphone size={20} />}
        title={lang === "ar" ? "نظرة عامة على التسويق" : "Marketing Overview"}
        subtitle={
          lang === "ar"
            ? "أداء حملاتك التسويقية عبر جميع القنوات"
            : "How your marketing campaigns performed across every channel"
        }
        period={period}
        actions={<MetricsGlossaryButton />}
      />

      <PageSections className="gap-after-header">
        <PageSection
          level="headline"
          aria-label={lang === "ar" ? "مؤشرات الفترة" : "Period figures"}
        >
          <FilterSummary />

          <div className="mt-4">
            <SectionTitle
              hint={
                lang === "ar"
                  ? "نظرة سريعة على القنوات؛ افتح أي بطاقة للتفاصيل."
                  : "A compact view of the channels; open a card for its report."
              }
            >
              {lang === "ar" ? "ملخص القنوات" : "Channel summary"}
            </SectionTitle>
            <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
              <ChannelCard
                label="Meta Ads"
                icon={<Megaphone size={15} />}
                to="/ads"
                value={data ? fmtNum(metaLeads) : "—"}
                detail={lang === "ar" ? "ليدز أبلغت عنها المنصة" : "platform-reported leads"}
                connected={Boolean(data)}
                index={0}
                lang={lang}
              />
              <ChannelCard
                label="Website"
                icon={<TrendingUp size={15} />}
                to="/website"
                value={websiteLeads === null ? "—" : fmtNum(websiteLeads)}
                detail={
                  websiteWon === null
                    ? lang === "ar"
                      ? "ليدز من مصدر Website"
                      : "leads from CRM source Website"
                    : lang === "ar"
                      ? `${fmtNum(websiteWon)} رابحة`
                      : `${fmtNum(websiteWon)} won`
                }
                connected={websiteLeads !== null}
                index={1}
                lang={lang}
              />
              <ChannelCard
                label="Landing Pages"
                icon={<Target size={15} />}
                to="/landing-pages"
                value="—"
                detail={lang === "ar" ? "التسليم التفصيلي" : "delivery detail"}
                connected={false}
                index={2}
                lang={lang}
              />
              <ChannelCard
                label="Lead Forms"
                icon={<Users size={15} />}
                to="/acquisition"
                value="—"
                detail={lang === "ar" ? "نماذج Meta" : "Meta forms"}
                connected={false}
                index={3}
                lang={lang}
              />
              <ChannelCard
                label="WhatsApp"
                icon={<Activity size={15} />}
                to="/acquisition"
                value="—"
                detail={lang === "ar" ? "مصدر الرسائل" : "message source"}
                connected={false}
                index={4}
                lang={lang}
              />
              <ChannelCard
                label="Messenger"
                icon={<BarChart3 size={15} />}
                to="/acquisition"
                value="—"
                detail={lang === "ar" ? "مصدر الرسائل" : "message source"}
                connected={false}
                index={5}
                lang={lang}
              />
            </div>
          </div>

          {/* The period's five figures, and the three readings of it worth
              acting on. Both describe the selected window rather than any one
              workspace tab, so they sit above the tabs: two of the three tabs
              used to open straight onto a table with no headline context at
              all. Every card opens its own explanation. */}
          {totals && metrics && (
            <KpiRow>
              <MetricCardDetailTrigger
                detail={metrics.spend}
                card={{ metric: "spend", index: 0, icon: <Wallet size={14} /> }}
              />
              <MetricCardDetailTrigger
                detail={{
                  ...metrics.revenue,
                  title: lang === "ar" ? "الإيراد المرتبط بالحملات" : "Campaign-linked revenue",
                  value: fmtUSD(totals.attributedRevenue),
                  definition:
                    lang === "ar"
                      ? "الإيراد المحصّل الذي يمكن نسبته إلى حملة أنفقت في هذه الفترة. باقي التحصيل حقيقي أيضًا، لكنه لا يحمل حملة."
                      : "Collected revenue that can be traced to a campaign which spent in this window. The rest of the collection is just as real, but carries no campaign.",
                }}
                card={{
                  metric: "attributedRevenue",
                  index: 1,
                  icon: <CircleDollarSign size={14} />,
                  value: fmtUSD(totals.attributedRevenue),
                  sub:
                    lang === "ar"
                      ? `${fmtUSD(totals.revenue)} إجمالي التحصيل`
                      : `${fmtUSD(totals.revenue)} collected in total`,
                }}
              />
              <MetricCardDetailTrigger
                detail={metrics.leads}
                card={{
                  metric: "crmLeads",
                  index: 2,
                  icon: <Users size={14} />,
                  value: fmtNum(totals.totalLeads),
                  sub:
                    totals.platformLeads === null
                      ? lang === "ar"
                        ? "المنصة لا تبلّغ عن عدد ليدز"
                        : "Platform reports no lead metric"
                      : lang === "ar"
                        ? `${fmtNum(totals.platformLeads)} أبلغت عنهم المنصة`
                        : `${fmtNum(totals.platformLeads)} reported by the platform`,
                }}
              />
              <MetricCardDetailTrigger
                detail={metrics.won}
                card={{
                  metric: "won",
                  index: 3,
                  icon: <UserPlus size={14} />,
                  value: fmtNum(totals.won),
                  sub: fmtPct(totals.conversionRate, 1),
                }}
              />
              <MetricCardDetailTrigger
                detail={metrics.roas}
                card={{
                  metric: "collectionsToSpend",
                  index: 4,
                  icon: <TrendingUp size={14} />,
                  value: ratioCell(totals.roas, spend, (v) => `${v.toFixed(2)}×`),
                  unavailableReason:
                    spend <= 0
                      ? lang === "ar"
                        ? "مفيش إنفاق مسجّل في الفترة المختارة."
                        : "No recorded spend in the selected period."
                      : undefined,
                  verdict: roasVerdict(totals.roas, spend) ?? undefined,
                  verdictLabel: verdictWord(roasVerdict(totals.roas, spend), lang),
                  note:
                    lang === "ar"
                      ? `البسط هنا كل التحصيل في الفترة (${fmtUSD(totals.revenue)})، مش الجزء المربوط بحملات (${fmtUSD(totals.attributedRevenue)}).`
                      : `The numerator is all revenue collected in the window (${fmtUSD(totals.revenue)}), not only the campaign-linked share (${fmtUSD(totals.attributedRevenue)}).`,
                }}
              />
            </KpiRow>
          )}
        </PageSection>

        {headline.any && (
          <PageSection
            level="insight"
            tone="amber"
            icon={<Target size={16} />}
            title={lang === "ar" ? "ثلاث قراءات للفترة" : "Three readings of the period"}
            hint={
              lang === "ar"
                ? "اضغط أي بطاقة لترى لماذا اختيرت هذه الحملة تحديدًا."
                : "Open any card to see why that campaign was named."
            }
          >
            <InsightRow>
              <MetricDrilldown detail={insights.best}>
                {(open) => (
                  <InsightCard
                    index={0}
                    kind="best"
                    eyebrow={lang === "ar" ? "أفضل حملة" : "Best campaign"}
                    title={
                      headline.best
                        ? headline.best.name
                        : lang === "ar"
                          ? "لا توجد حملة مؤهلة"
                          : "No eligible campaign"
                    }
                    value={headline.best ? fmtUSD(headline.best.revenue) : undefined}
                    detail={
                      headline.best
                        ? lang === "ar"
                          ? `${fmtUSD(headline.best.spend)} إنفاق مقابل إيراد مرتبط`
                          : `${fmtUSD(headline.best.spend)} spent against linked revenue`
                        : lang === "ar"
                          ? "لا توجد حملة صرفت وحققت إيراداً مرتبطاً في الفترة."
                          : "No campaign both spent and returned linked revenue this period."
                    }
                    onClick={open}
                    actionLabel={lang === "ar" ? "لماذا هذه الحملة؟" : "Why this campaign?"}
                  />
                )}
              </MetricDrilldown>
              <MetricDrilldown detail={insights.leak}>
                {(open) => (
                  <InsightCard
                    index={1}
                    kind="attention"
                    eyebrow={lang === "ar" ? "حملة تحتاج متابعة" : "Campaign needing attention"}
                    title={
                      headline.leak
                        ? headline.leak.name
                        : lang === "ar"
                          ? "لا توجد حملة خاسرة"
                          : "No loss-making campaign"
                    }
                    value={
                      headline.leak
                        ? fmtUSD(headline.leak.spend - headline.leak.revenue)
                        : undefined
                    }
                    detail={
                      headline.leak
                        ? lang === "ar"
                          ? `صرفت ${fmtUSD(headline.leak.spend)} مقابل ${fmtUSD(headline.leak.revenue)} إيراد مرتبط.`
                          : `Spent ${fmtUSD(headline.leak.spend)} against ${fmtUSD(headline.leak.revenue)} of linked revenue.`
                        : lang === "ar"
                          ? "كل حملة صرفت في الفترة غطّت تكلفتها على الأقل."
                          : "Every campaign that spent this period at least covered its cost."
                    }
                    onClick={open}
                    actionLabel={lang === "ar" ? "ما الذي أدى لهذا؟" : "What led to this?"}
                  />
                )}
              </MetricDrilldown>
              <MetricDrilldown detail={insights.bestCpl}>
                {(open) => (
                  <InsightCard
                    index={2}
                    kind="opportunity"
                    eyebrow={lang === "ar" ? "أفضل تكلفة لكل عميل محتمل" : "Best cost per lead"}
                    title={
                      headline.bestCpl
                        ? headline.bestCpl.name
                        : lang === "ar"
                          ? "لا توجد تكلفة قابلة للقياس"
                          : "No measurable cost per lead"
                    }
                    value={headline.bestCpl ? fmtUSDFull(headline.bestCpl.cpl ?? 0) : undefined}
                    detail={
                      headline.bestCpl
                        ? lang === "ar"
                          ? `${fmtNum(headline.bestCpl.crmLeads)} عميل من ${fmtUSD(headline.bestCpl.spend)} إنفاق.`
                          : `${fmtNum(headline.bestCpl.crmLeads)} leads from ${fmtUSD(headline.bestCpl.spend)} of spend.`
                        : lang === "ar"
                          ? "لا توجد حملة صرفت وجاءت منها عملاء في الفترة."
                          : "No campaign both spent and produced leads this period."
                    }
                    onClick={open}
                    actionLabel={lang === "ar" ? "على أي أساس؟" : "On what basis?"}
                  />
                )}
              </MetricDrilldown>
            </InsightRow>
          </PageSection>
        )}

        <PageSection
          level="primary"
          aria-label={lang === "ar" ? "مساحة عمل الحملات" : "Campaign workspace"}
        >
          {isLoading || !data || !totals ? (
            <Skeleton className="h-[520px]" />
          ) : (
            <>
              <PerfExplorer
                rows={data.rows}
                grain={grain}
                onGrainChange={setGrain}
                initialView={initialView}
                unknownAdsetKey={data.unknownAdsetKey}
                csvPrefix="engosoft"
                onOpenDetail={grain === "campaign" ? openDetail : undefined}
                activeCampaignStates={Object.values(data.activity.delivery)}
                lostAvailable={hasReportableLost(data.health.lostAuthority)}
                spendAvailable={spend > 0}
                spendNote={
                  spend <= 0
                    ? lang === "ar"
                      ? "مفيش إنفاق مسجّل في النطاق الحالي، فالمؤشرات المبنية على الإنفاق بتظهر شرطة."
                      : "No recorded spend in the current scope, so spend-derived metrics render as a dash."
                    : undefined
                }
                title={
                  grain === "campaign"
                    ? lang === "ar"
                      ? "قرار الحملات اللي شغالة دلوقتي"
                      : "Live campaign decisions"
                    : lang === "ar"
                      ? "تفاصيل الحملة"
                      : "Campaign details"
                }
                subtitle={
                  lang === "ar"
                    ? "ابدأ من هنا: ناجحة، متابعة، ضعيفة، أو بدري للحكم. حملات web-con بتتحسب كتحويلات موقع، مش ليدز CRM."
                    : "Start here: Successful, Watch, Weak, or Too early. web-con is evaluated as website conversion, not CRM lead generation."
                }
              />

              <MoreDetails
                label={lang === "ar" ? "تحليل إضافي" : "More analysis"}
                hint={
                  lang === "ar"
                    ? "حالة التشغيل على المنصات، الإنفاق مقابل التحصيل، وملاحظات البيانات"
                    : "Platform delivery status, spend against collections, and data notes"
                }
              >
                <CampaignActivityPanel activity={data.activity} />
                <OverviewCampaignRecords />
                <>
                  <SectionTitle
                    hint={
                      lang === "ar"
                        ? "ملخص الفترة والمنصات، وبعده حالة الاتصال والمقارنة المالية."
                        : "Selected-period and platform summary, followed by delivery health and financial comparison."
                    }
                    className="border-t border-border/70 pt-4"
                  >
                    {lang === "ar" ? "الصورة الكاملة للفترة" : "Period overview"}
                  </SectionTitle>

                  <Card>
                    <SectionTitle
                      action={
                        <Pill tone="neutral">
                          {grain === "campaign"
                            ? t("campaign")
                            : grain === "adset"
                              ? t("ad_set")
                              : t("ad_name")}
                        </Pill>
                      }
                      hint={
                        lang === "ar"
                          ? "كل الصفوف اللي صرفت في الفترة المختارة. الأزرق هو الإنفاق والبرتقالي هو التحصيل — مرّر داخل الكارت لمراجعة كل الحملات."
                          : "Every row with spend in the selected period. Blue is spend and orange is collected revenue; scroll inside the card to review all campaigns."
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
                      />
                    </div>
                  </Card>

                  {/* Four stacked technical notices became one card. Every fact
                  they carried survives — the scope rule, the revenue basis,
                  the unmatched ad-set bucket — but the sentence a manager
                  needs is now separated from the mechanics behind it. */}
                  <DataHealthSummary
                    issues={[
                      ...(grain === "adset"
                        ? [
                            {
                              tone: "info" as const,
                              message:
                                lang === "ar"
                                  ? "بعض المجموعات الإعلانية مستنتَجة وليست مطابَقة مباشرة."
                                  : "Some ad sets are inferred rather than matched directly.",
                              impact:
                                lang === "ar"
                                  ? `${fmtPct(data.health.adsetResolutionRate * 100, 1)} من الصفوف مربوطة بشكل مؤكد؛ الباقي معلَّم داخل الجدول.`
                                  : `${fmtPct(data.health.adsetResolutionRate * 100, 1)} of rows are matched exactly; the rest are flagged in the table.`,
                              technical:
                                lang === "ar"
                                  ? "الربط يتم من معرّف الإعلان أولاً — وهو ربط مضبوط — ثم من اسم الإعلان عند اللزوم. أسماء الإعلانات ليست فريدة، فما يُحدَّد بالاسم يحمل علامة «غير مؤكد»."
                                  : 'Ad set resolves from the ad id first — an exact join — then from the ad name where needed. Ad names are not unique, so name-derived values carry an "ambiguous" badge.',
                            },
                          ]
                        : []),
                      {
                        tone: "info" as const,
                        message:
                          lang === "ar"
                            ? "الإيراد هنا هو المحصَّل فعلياً بتاريخ الدفع."
                            : "Revenue here is what was actually collected, by payment date.",
                        impact:
                          lang === "ar"
                            ? "الصفوف بلا حملة معروفة غير معروضة، فمجموع الجدول قد يقل عن إجمالي الإيراد."
                            : "Rows without a known campaign are excluded, so the table may total less than headline revenue.",
                        technical: "Accounting.USD Paid · Payment Date",
                      },
                      ...(filters.account
                        ? [
                            {
                              tone: "warning" as const,
                              message:
                                lang === "ar"
                                  ? "أنت تشاهد حساباً إعلانياً واحداً، وليس كل النشاط."
                                  : "You are viewing a single ad account, not all activity.",
                              impact:
                                lang === "ar"
                                  ? "الصفوف التي لا يمكن ربطها بهذا الحساب بشكل مؤكد مستبعدة بدل تخمينها."
                                  : "Rows that cannot be tied to this account with certainty are excluded rather than guessed in.",
                              technical:
                                lang === "ar"
                                  ? "الربط يتم عبر Campaign ID مطابق فعلاً داخل الحساب؛ الصفوف بلا Campaign ID تُستبعد."
                                  : "Scoping runs through an exact Campaign ID observed in that account; rows without a Campaign ID are excluded.",
                            },
                          ]
                        : []),
                      ...(unknownRow
                        ? [
                            {
                              tone: "warning" as const,
                              message:
                                lang === "ar"
                                  ? "جزء من النشاط لم يُربط بمجموعة إعلانية."
                                  : "Part of this activity could not be tied to an ad set.",
                              impact:
                                lang === "ar"
                                  ? `${fmtNum(unknownRow.crmLeads)} عميل و${fmtUSD(unknownRow.revenue)} تحصيل — معروضة كصف مستقل وليست محذوفة.`
                                  : `${fmtNum(unknownRow.crmLeads)} leads and ${fmtUSD(unknownRow.revenue)} of revenue — shown as their own row, not dropped.`,
                            },
                          ]
                        : []),
                    ]}
                  />

                  <p className="text-[11px] text-text-subtle px-1">
                    {lang === "ar"
                      ? `${fmtNum(data.rows.length)} صف في المستوى ده. متوسط تكلفة الصفقة ${fmtUSDFull(totals.cpa)} على أساس ${filters.cpaBasis === "invoices" ? "عدد الفواتير" : "الصفقات الرابحة"}.`
                      : `${fmtNum(data.rows.length)} rows at this level. Blended CPA is ${fmtUSDFull(totals.cpa)} on the ${filters.cpaBasis === "invoices" ? "invoice-count" : "won-deals"} basis.`}
                  </p>
                </>
              </MoreDetails>
            </>
          )}
        </PageSection>
      </PageSections>
    </div>
  );
}
