import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  Info,
  ReceiptText,
  UserRoundSearch,
  Users,
} from "lucide-react";
import {
  Card,
  ErrorState,
  KpiCard,
  Notice,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import {
  DashboardPageHeader,
  DataHealthSummary,
  InsightCard,
  InsightRow,
  KpiRow,
} from "@/components/dashboard-bits";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { FilterSummary } from "@/components/ads/FilterSummary";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { PerfRow, Platform } from "@/lib/types";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { topRows, type MetricDetail } from "@/lib/metric-detail";

export const Route = createFileRoute("/media-buyers")({ component: MediaBuyers });

interface Buyer {
  id: "sayed" | "shazly";
  name: string;
  token: string;
  campaigns: number;
  platforms: Platform[];
  spend: number;
  revenue: number;
  impressions: number;
  clicksAll: number;
  platformLeads: number | null;
  crmLeads: number;
  won: number;
  lost: number;
  invoices: number;
  salesOrders: number;
  ctrAll: number | null;
  cpl: number | null;
  cpa: number | null;
  roas: number | null;
  conversionRate: number | null;
  lostRate: number | null;
  rows: PerfRow[];
}

interface Response {
  buyers: Buyer[];
  mapping: { sayed: string; shazly: string };
  coverage: {
    assignedCampaigns: number;
    unassignedCampaigns: number;
    unassignedSpend: number;
    ambiguousCampaigns: number;
    ambiguousSpend: number;
  };
}

function metricWinner(
  buyers: Buyer[],
  key: "roas" | "conversionRate" | "revenue" | "cpl",
  lower = false,
) {
  const eligible = buyers.filter(
    (buyer) => buyer[key] !== null && Number.isFinite(Number(buyer[key])),
  );
  return eligible.sort((a, b) =>
    lower ? Number(a[key]) - Number(b[key]) : Number(b[key]) - Number(a[key]),
  )[0]?.id;
}

/**
 * The five page-level figures, and the buyer split behind each.
 *
 * Every breakdown is per buyer, because that is the only comparison this page
 * exists to make. Nothing is re-scored: the sums are the same sums the cards
 * show, split back out the way they were added up.
 */
function buyerMetrics(
  data: Response,
  totals: {
    spend: number;
    revenue: number;
    crmLeads: number;
    won: number;
    invoices: number;
    campaigns: number;
    roas: number | null;
  },
  coveragePct: number | null,
  lang: "ar" | "en",
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const perBuyer = (
    pick: (buyer: Buyer) => number,
    format: (n: number) => string,
    tone: "mint" | "rose" | "sky" | "violet" | "amber" | "cyan",
  ) =>
    topRows(
      data.buyers.map((buyer) => ({
        key: buyer.id,
        label: buyer.name,
        value: pick(buyer),
        display: format(pick(buyer)),
        meta: `${fmtNum(buyer.campaigns)} ${A ? "حملة" : "campaigns"}`,
        tone,
      })),
      4,
    );
  const campaignRows = (
    pick: (row: PerfRow) => number,
    format: (n: number) => string,
    tone: "mint" | "rose",
    filter: (row: PerfRow) => boolean = () => true,
  ) =>
    topRows(
      data.buyers.flatMap((buyer) =>
        buyer.rows.filter(filter).map((row) => ({
          key: `${buyer.id}-${row.key}`,
          label: row.name,
          value: pick(row),
          display: format(pick(row)),
          meta: buyer.name,
          tone,
        })),
      ),
    );

  return {
    spend: {
      id: "media_buyers.spend",
      title: A ? "الإنفاق المُدار" : "Managed spend",
      value: fmtUSDFull(totals.spend),
      tone: "rose",
      icon: <BadgeDollarSign size={16} />,
      definition: A
        ? "إجمالي ما أنفقه الميديا بايرز على الحملات المنسوبة إليهم في الفترة. الحملات بلا مسؤول ليست هنا."
        : "What the media buyers spent on the campaigns attributed to them in the period. Unassigned campaigns are not here.",
      formula: A
        ? `${fmtUSDFull(totals.spend)} على ${fmtNum(totals.campaigns)} حملة منسوبة.`
        : `${fmtUSDFull(totals.spend)} across ${fmtNum(totals.campaigns)} attributed campaigns.`,
      caveat:
        data.coverage.unassignedSpend > 0
          ? A
            ? `${fmtUSDFull(data.coverage.unassignedSpend)} أُنفقت على ${fmtNum(data.coverage.unassignedCampaigns)} حملة بلا مسؤول، وهي خارج هذا الرقم.`
            : `${fmtUSDFull(data.coverage.unassignedSpend)} ran on ${fmtNum(data.coverage.unassignedCampaigns)} unassigned campaigns and is outside this figure.`
          : undefined,
      supporting: [
        {
          key: "revenue",
          label: A ? "الإيراد المرتبط" : "Attributed revenue",
          value: fmtUSDFull(totals.revenue),
        },
        { key: "campaigns", label: A ? "الحملات" : "Campaigns", value: fmtNum(totals.campaigns) },
        { key: "leads", label: A ? "العملاء" : "Leads", value: fmtNum(totals.crmLeads) },
        {
          key: "roas",
          label: "ROAS",
          value: totals.roas === null ? "—" : `${totals.roas.toFixed(2)}×`,
        },
      ],
      breakdowns: [
        {
          id: "buyers",
          title: A ? "حسب الميديا باير" : "By media buyer",
          rows: perBuyer((buyer) => buyer.spend, fmtUSDFull, "rose"),
          emptyLabel: A ? "لا يوجد إنفاق في الفترة" : "No spend in this period",
        },
        {
          id: "campaigns",
          title: A ? "أعلى الحملات إنفاقًا" : "Highest-spending campaigns",
          rows: campaignRows((row) => row.spend, fmtUSDFull, "rose"),
          emptyLabel: A ? "لا توجد حملات أنفقت" : "No campaign spent",
        },
      ],
      report: { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" },
    },
    revenue: {
      id: "media_buyers.revenue",
      title: A ? "الإيراد المرتبط" : "Attributed revenue",
      value: fmtUSDFull(totals.revenue),
      tone: "mint",
      icon: <ChartNoAxesCombined size={16} />,
      definition: A
        ? "الإيراد المحصّل الذي يمكن نسبته إلى حملات هؤلاء الميديا بايرز. باقي التحصيل حقيقي أيضًا، لكنه لا يحمل حملة لهم."
        : "Collected revenue traceable to these buyers' campaigns. The rest of the collection is just as real, but carries none of their campaigns.",
      formula: A
        ? `${fmtUSDFull(totals.revenue)} من ${fmtNum(totals.invoices)} فاتورة.`
        : `${fmtUSDFull(totals.revenue)} across ${fmtNum(totals.invoices)} invoices.`,
      supporting: [
        { key: "invoices", label: A ? "الفواتير" : "Invoices", value: fmtNum(totals.invoices) },
        { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSDFull(totals.spend) },
        { key: "won", label: A ? "صفقات رابحة" : "Won", value: fmtNum(totals.won) },
        {
          key: "roas",
          label: "ROAS",
          value: totals.roas === null ? "—" : `${totals.roas.toFixed(2)}×`,
        },
      ],
      breakdowns: [
        {
          id: "buyers",
          title: A ? "حسب الميديا باير" : "By media buyer",
          rows: perBuyer((buyer) => buyer.revenue, fmtUSDFull, "mint"),
          emptyLabel: A ? "لا يوجد إيراد مرتبط" : "No attributed revenue",
        },
        {
          id: "campaigns",
          title: A ? "أعلى الحملات إيرادًا" : "Campaigns with the most revenue",
          rows: campaignRows((row) => row.revenue, fmtUSDFull, "mint"),
          emptyLabel: A ? "لا توجد حملة بإيراد" : "No campaign carries revenue",
        },
      ],
      report: { to: "/accounting", label: A ? "فتح تقرير الحسابات" : "Open the Accounting report" },
    },
    roas: {
      id: "media_buyers.roas",
      title: A ? "متوسط ROAS" : "Blended ROAS",
      value: totals.roas === null ? "—" : `${totals.roas.toFixed(2)}×`,
      tone:
        totals.roas === null
          ? "slate"
          : totals.roas >= 2
            ? "mint"
            : totals.roas >= 1
              ? "amber"
              : "rose",
      icon: <ChartNoAxesCombined size={16} />,
      definition: A
        ? "الإيراد المرتبط مقسومًا على الإنفاق المُدار. مجموع على مجموع، لا متوسط لنسبتي الميديا بايرز — وإلا لتساوى حساب صغير مع حساب كبير."
        : "Attributed revenue divided by managed spend. A sum over a sum, not an average of the two buyers' ratios — that would weight a small account like a large one.",
      formula: `${fmtUSDFull(totals.revenue)} ÷ ${fmtUSDFull(totals.spend)} = ${totals.roas === null ? "—" : `${totals.roas.toFixed(2)}×`}`,
      supporting: [
        {
          key: "revenue",
          label: A ? "البسط · الإيراد" : "Numerator · revenue",
          value: fmtUSDFull(totals.revenue),
        },
        {
          key: "spend",
          label: A ? "المقام · الإنفاق" : "Denominator · spend",
          value: fmtUSDFull(totals.spend),
        },
        { key: "campaigns", label: A ? "الحملات" : "Campaigns", value: fmtNum(totals.campaigns) },
        { key: "invoices", label: A ? "الفواتير" : "Invoices", value: fmtNum(totals.invoices) },
      ],
      breakdowns: [
        {
          id: "buyers",
          title: A ? "حسب الميديا باير" : "By media buyer",
          rows: perBuyer(
            (buyer) => buyer.roas ?? 0,
            (n) => `${n.toFixed(2)}×`,
            "amber",
          ),
          emptyLabel: A ? "لا يوجد عائد قابل للقياس" : "No measurable return",
        },
        {
          id: "best",
          title: A ? "أفضل الحملات عائدًا" : "Best-returning campaigns",
          rows: campaignRows(
            (row) => row.roas ?? 0,
            (n) => `${n.toFixed(2)}×`,
            "mint",
            (row) => row.spend > 0,
          ),
          emptyLabel: A ? "لا توجد حملة مؤهلة" : "No eligible campaign",
        },
        {
          id: "worst",
          title: A ? "حملات أنفقت أكثر مما أعادت" : "Campaigns that returned less than they cost",
          rows: campaignRows(
            (row) => row.spend - row.revenue,
            fmtUSDFull,
            "rose",
            (row) => row.spend > row.revenue,
          ),
          emptyLabel: A ? "لا توجد حملة خاسرة" : "No loss-making campaign",
        },
      ],
    },
    leads: {
      id: "media_buyers.leads",
      title: A ? "العملاء المحتملون" : "Leads",
      value: fmtNum(totals.crmLeads),
      tone: "sky",
      icon: <Users size={16} />,
      definition: A
        ? "العملاء الذين دخلوا النظام من حملات هؤلاء الميديا بايرز في الفترة."
        : "Leads that entered the system from these buyers' campaigns in the period.",
      formula: A
        ? `${fmtNum(totals.won)} من ${fmtNum(totals.crmLeads)} أُغلقت رابحة.`
        : `${fmtNum(totals.won)} of ${fmtNum(totals.crmLeads)} closed as won.`,
      supporting: [
        { key: "won", label: A ? "صفقات مغلقة" : "Closed won", value: fmtNum(totals.won) },
        { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSDFull(totals.spend) },
        {
          key: "cpl",
          label: "CPL",
          value: totals.crmLeads > 0 ? fmtUSDFull(totals.spend / totals.crmLeads) : "—",
        },
        { key: "campaigns", label: A ? "الحملات" : "Campaigns", value: fmtNum(totals.campaigns) },
      ],
      breakdowns: [
        {
          id: "buyers",
          title: A ? "حسب الميديا باير" : "By media buyer",
          rows: perBuyer((buyer) => buyer.crmLeads, fmtNum, "sky"),
          emptyLabel: A ? "لا يوجد عملاء في الفترة" : "No leads in this period",
        },
        {
          id: "campaigns",
          title: A ? "أعلى الحملات إنتاجًا للعملاء" : "Campaigns producing the most leads",
          rows: campaignRows((row) => row.crmLeads, fmtNum, "mint"),
          emptyLabel: A ? "لا توجد حملة أنتجت عملاء" : "No campaign produced a lead",
        },
      ],
      report: { to: "/leads", label: A ? "فتح تقرير العملاء" : "Open the leads report" },
    },
    coverage: {
      id: "media_buyers.coverage",
      title: A ? "تغطية النسبة" : "Attribution coverage",
      value: fmtPct(coveragePct, 1),
      tone: coveragePct !== null && coveragePct < 80 ? "amber" : "mint",
      icon: <UserRoundSearch size={16} />,
      definition: A
        ? "نسبة الحملات التي أمكن نسبتها إلى ميديا باير بعينه. كل رقم في هذه الصفحة محسوب على هذا الجزء فقط."
        : "The share of campaigns that could be attributed to a named buyer. Every figure on this page is computed over that share alone.",
      formula: `${fmtNum(data.coverage.assignedCampaigns)} ÷ ${fmtNum(data.coverage.assignedCampaigns + data.coverage.unassignedCampaigns)} = ${fmtPct(coveragePct, 1)}`,
      caveat:
        data.coverage.ambiguousCampaigns > 0
          ? A
            ? `${fmtNum(data.coverage.ambiguousCampaigns)} حملة تحمل اسم أكثر من ميديا باير (${fmtUSDFull(data.coverage.ambiguousSpend)}) ولم تُنسب لأحد.`
            : `${fmtNum(data.coverage.ambiguousCampaigns)} campaigns name more than one buyer (${fmtUSDFull(data.coverage.ambiguousSpend)}) and were attributed to neither.`
          : undefined,
      supporting: [
        {
          key: "assigned",
          label: A ? "منسوبة" : "Attributed",
          value: fmtNum(data.coverage.assignedCampaigns),
        },
        {
          key: "unassigned",
          label: A ? "بلا مسؤول" : "Unassigned",
          value: fmtNum(data.coverage.unassignedCampaigns),
        },
        {
          key: "unassignedSpend",
          label: A ? "إنفاق بلا مسؤول" : "Unassigned spend",
          value: fmtUSDFull(data.coverage.unassignedSpend),
        },
        {
          key: "ambiguous",
          label: A ? "ملتبسة" : "Ambiguous",
          value: fmtNum(data.coverage.ambiguousCampaigns),
        },
      ],
      report: { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" },
    },
  };
}

function MediaBuyers() {
  const reportingPeriod = useReportingPeriod();
  // Declares this page to ENGO Nexus, so "حلل الصفحة دي" and "التاب ده"
  // have something to resolve against. Ids and state only — no figures.
  useRegisterNexusView("media_buyers");
  const { lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Response>("/api/media-buyers");
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-72" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const wins = {
    roas: metricWinner(data.buyers, "roas"),
    cpl: metricWinner(data.buyers, "cpl", true),
    conversion: metricWinner(data.buyers, "conversionRate"),
    revenue: metricWinner(data.buyers, "revenue"),
  };

  // Page-level totals: plain sums over the buyers the response returned. The
  // blended ROAS divides the summed revenue by the summed spend rather than
  // averaging the two buyers' ratios, which would weight a small account the
  // same as a large one.
  const sum = (pick: (buyer: Buyer) => number) =>
    data.buyers.reduce((total, buyer) => total + pick(buyer), 0);
  const totals = {
    spend: sum((b) => b.spend),
    revenue: sum((b) => b.revenue),
    crmLeads: sum((b) => b.crmLeads),
    won: sum((b) => b.won),
    invoices: sum((b) => b.invoices),
    campaigns: sum((b) => b.campaigns),
    get roas() {
      return this.spend > 0 ? this.revenue / this.spend : null;
    },
  };
  const totalCampaigns = data.coverage.assignedCampaigns + data.coverage.unassignedCampaigns;
  const coveragePct =
    totalCampaigns > 0 ? (data.coverage.assignedCampaigns / totalCampaigns) * 100 : null;
  const metrics = buyerMetrics(data, totals, coveragePct, lang);
  const bestBuyer = data.buyers.find((buyer) => buyer.id === wins.roas) ?? null;
  const cheapestBuyer = data.buyers.find((buyer) => buyer.id === wins.cpl) ?? null;

  return (
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<UserRoundSearch size={20} />}
        title={lang === "ar" ? "تقييم الميديا بايرز" : "Media buyer evaluation"}
        subtitle={
          lang === "ar"
            ? "مقارنة شفافة بين سيد وشاذلي من الصرف حتى الفاتورة، بدون درجة مخفية أو حكم غير قابل للمراجعة."
            : "A transparent Sayed vs Shazly comparison from spend to paid invoice, with no opaque score."
        }
        period={reportingPeriod}
      />
      <FilterSummary />

      {/* What the two buyers add up to. Every figure is a sum over the buyers
          the response returned — nothing is recomputed and no buyer is
          re-scored; the per-buyer comparison below is unchanged. */}
      <KpiRow>
        <MetricDetailTrigger
          detail={metrics.spend}
          card={{
            index: 0,
            sub:
              lang === "ar"
                ? `${fmtNum(totals.campaigns)} حملة منسوبة`
                : `${fmtNum(totals.campaigns)} attributed campaigns`,
          }}
        />
        <MetricDetailTrigger
          detail={metrics.revenue}
          card={{
            index: 1,
            hero: true,
            sub:
              lang === "ar"
                ? `${fmtNum(totals.invoices)} فاتورة`
                : `${fmtNum(totals.invoices)} invoices`,
          }}
        />
        <MetricDetailTrigger
          detail={metrics.roas}
          card={{
            index: 2,
            sub:
              lang === "ar"
                ? "الإيراد المرتبط ÷ الإنفاق المُدار"
                : "Attributed revenue ÷ managed spend",
          }}
        />
        <MetricDetailTrigger
          detail={metrics.leads}
          card={{
            index: 3,
            sub:
              lang === "ar" ? `${fmtNum(totals.won)} صفقة مغلقة` : `${fmtNum(totals.won)} closed`,
          }}
        />
        <MetricDetailTrigger
          detail={metrics.coverage}
          card={{
            index: 4,
            sub:
              lang === "ar"
                ? `${fmtNum(data.coverage.unassignedCampaigns)} حملة بلا مسؤول`
                : `${fmtNum(data.coverage.unassignedCampaigns)} campaigns unassigned`,
          }}
        />
      </KpiRow>

      <InsightRow>
        <InsightCard
          index={0}
          kind="best"
          eyebrow={lang === "ar" ? "أفضل ميديا باير" : "Top media buyer"}
          title={
            bestBuyer
              ? bestBuyer.name
              : lang === "ar"
                ? "لا يوجد ميديا باير مؤهل"
                : "No eligible media buyer"
          }
          value={bestBuyer?.roas != null ? `${bestBuyer.roas.toFixed(2)}×` : undefined}
          detail={
            bestBuyer
              ? lang === "ar"
                ? `${fmtUSDFull(bestBuyer.revenue)} إيراد من ${fmtUSDFull(bestBuyer.spend)} إنفاق عبر ${fmtNum(bestBuyer.campaigns)} حملة`
                : `${fmtUSDFull(bestBuyer.revenue)} from ${fmtUSDFull(bestBuyer.spend)} of spend across ${fmtNum(bestBuyer.campaigns)} campaigns`
              : undefined
          }
        />
        <InsightCard
          index={1}
          kind={data.coverage.unassignedSpend > 0 ? "attention" : "opportunity"}
          eyebrow={lang === "ar" ? "صرف بلا مسؤول" : "Spend without an owner"}
          title={
            data.coverage.unassignedSpend > 0
              ? lang === "ar"
                ? "جزء من الإنفاق غير منسوب لأي ميديا باير"
                : "Part of the spend is not attributed to any buyer"
              : lang === "ar"
                ? "كل الإنفاق منسوب لمسؤول"
                : "All spend has an owner"
          }
          value={
            data.coverage.unassignedSpend > 0
              ? fmtUSDFull(data.coverage.unassignedSpend)
              : undefined
          }
          detail={
            data.coverage.unassignedSpend > 0
              ? lang === "ar"
                ? `${fmtNum(data.coverage.unassignedCampaigns)} حملة لا تحمل علامة مسؤول في اسمها، فلا تدخل في المقارنة أدناه.`
                : `${fmtNum(data.coverage.unassignedCampaigns)} campaigns carry no owner tag in their name, so they are outside the comparison below.`
              : undefined
          }
        />
        <InsightCard
          index={2}
          kind="note"
          eyebrow={lang === "ar" ? "أقل تكلفة لكل عميل" : "Best cost per lead"}
          title={
            cheapestBuyer
              ? cheapestBuyer.name
              : lang === "ar"
                ? "لا توجد تكلفة قابلة للقياس"
                : "No measurable cost per lead"
          }
          value={cheapestBuyer?.cpl != null ? fmtUSDFull(cheapestBuyer.cpl) : undefined}
          detail={
            cheapestBuyer
              ? lang === "ar"
                ? `${fmtNum(cheapestBuyer.crmLeads)} عميل في أودو من ${fmtUSDFull(cheapestBuyer.spend)} إنفاق`
                : `${fmtNum(cheapestBuyer.crmLeads)} Odoo leads from ${fmtUSDFull(cheapestBuyer.spend)} of spend`
              : undefined
          }
        />
      </InsightRow>

      <div className="grid gap-4 xl:grid-cols-2">
        {data.buyers.map((buyer, buyerIndex) => (
          <Card
            key={buyer.id}
            className="overflow-hidden border-t-4"
            style={{ borderTopColor: buyer.id === "sayed" ? "#1E40AF" : "#D97706" }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-text">{buyer.name}</h2>
                  <Pill tone="brand">{buyer.token}</Pill>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  {buyer.campaigns} {lang === "ar" ? "حملة" : "campaigns"} ·{" "}
                  {buyer.platforms.join(" + ") || "—"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {wins.roas === buyer.id && (
                  <Pill tone="success">{lang === "ar" ? "أفضل عائد" : "Best ROAS"}</Pill>
                )}
                {wins.cpl === buyer.id && (
                  <Pill tone="success">{lang === "ar" ? "أقل تكلفة ليد" : "Best CPL"}</Pill>
                )}
                {wins.conversion === buyer.id && (
                  <Pill tone="success">{lang === "ar" ? "أفضل إغلاق" : "Best conversion"}</Pill>
                )}
                {wins.revenue === buyer.id && (
                  <Pill tone="success">{lang === "ar" ? "أعلى إيراد" : "Top revenue"}</Pill>
                )}
              </div>
            </div>

            <div className="card-grid mt-4 grid-cols-2 sm:grid-cols-4">
              <KpiCard
                tone="rose"
                index={buyerIndex * 4}
                label={lang === "ar" ? "الإنفاق" : "Spend"}
                value={fmtUSDFull(buyer.spend)}
                icon={<BadgeDollarSign size={15} />}
              />
              <KpiCard
                tone="sky"
                index={buyerIndex * 4 + 1}
                label={lang === "ar" ? "ليدز المنصة" : "Platform leads"}
                value={buyer.platformLeads === null ? "—" : fmtNum(buyer.platformLeads)}
                icon={<Users size={15} />}
              />
              <KpiCard
                tone="violet"
                index={buyerIndex * 4 + 2}
                label={lang === "ar" ? "الفواتير" : "Invoices"}
                value={fmtNum(buyer.invoices)}
                sub={`${fmtNum(buyer.salesOrders)} ${lang === "ar" ? "أمر بيع" : "sales orders"}`}
                icon={<ReceiptText size={15} />}
              />
              <KpiCard
                tone="mint"
                index={buyerIndex * 4 + 3}
                label={lang === "ar" ? "الإيراد" : "Revenue"}
                value={fmtUSDFull(buyer.revenue)}
                hero
                icon={<ChartNoAxesCombined size={15} />}
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini label="ROAS" value={buyer.roas === null ? "—" : `${buyer.roas.toFixed(2)}×`} />
              <Mini label="CPL" value={fmtUSDFull(buyer.cpl)} />
              <Mini label="CPA" value={fmtUSDFull(buyer.cpa)} />
              <Mini label="CTR (all)" value={fmtPct(buyer.ctrAll, 2)} />
              <Mini
                label={lang === "ar" ? "ليدز أودو" : "Odoo leads"}
                value={fmtNum(buyer.crmLeads)}
              />
              <Mini label={lang === "ar" ? "مغلقة" : "Won"} value={fmtNum(buyer.won)} />
              <Mini label={lang === "ar" ? "ضائعة" : "Lost"} value={fmtNum(buyer.lost)} />
              <Mini
                label={lang === "ar" ? "نسبة الإغلاق" : "Conversion"}
                value={fmtPct(buyer.conversionRate, 2)}
              />
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <SectionTitle>
          {lang === "ar" ? "فحص دقة توزيع الحملات" : "Campaign ownership coverage"}
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Mini
            label={lang === "ar" ? "حملات منسوبة" : "Assigned campaigns"}
            value={fmtNum(data.coverage.assignedCampaigns)}
          />
          <Mini
            label={lang === "ar" ? "حملات غير منسوبة" : "Unassigned campaigns"}
            value={fmtNum(data.coverage.unassignedCampaigns)}
          />
          <Mini
            label={lang === "ar" ? "صرف غير منسوب" : "Unassigned spend"}
            value={fmtUSDFull(data.coverage.unassignedSpend)}
          />
          <Mini
            label={lang === "ar" ? "أسماء ملتبسة" : "Ambiguous names"}
            value={fmtNum(data.coverage.ambiguousCampaigns)}
          />
        </div>
      </Card>

      <DataHealthSummary
        issues={[
          {
            tone: data.coverage.unassignedCampaigns > 0 ? "warning" : "info",
            message:
              lang === "ar"
                ? "نسبة الحملات للميديا بايرز تُقرأ من اسم الحملة نفسه."
                : "Campaign ownership is read from the campaign name itself.",
            impact:
              data.coverage.unassignedCampaigns > 0
                ? lang === "ar"
                  ? `${fmtNum(data.coverage.unassignedCampaigns)} حملة و${fmtUSDFull(data.coverage.unassignedSpend)} إنفاق خارج المقارنة أدناه.`
                  : `${fmtNum(data.coverage.unassignedCampaigns)} campaigns and ${fmtUSDFull(data.coverage.unassignedSpend)} of spend sit outside the comparison below.`
                : undefined,
            technical:
              lang === "ar"
                ? `SAYED = سيد، وSH ككلمة مستقلة = شاذلي. أسماء ملتبسة: ${fmtNum(data.coverage.ambiguousCampaigns)} · إنفاق ملتبس: ${fmtUSDFull(data.coverage.ambiguousSpend)}.`
                : `SAYED maps to Sayed and standalone SH maps to Shazly. Ambiguous names: ${fmtNum(data.coverage.ambiguousCampaigns)} · ambiguous spend: ${fmtUSDFull(data.coverage.ambiguousSpend)}.`,
          },
        ]}
      />

      {data.buyers.map((buyer) => (
        <Card key={`${buyer.id}-campaigns`} padded={false} className="overflow-hidden">
          <div className="p-4 sm:p-5">
            <SectionTitle>
              {lang === "ar" ? `حملات ${buyer.name}` : `${buyer.name} campaigns`}
            </SectionTitle>
          </div>
          <div className="table-wrap scroll-hint-x">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-surface-2 text-xs text-text-muted">
                <tr>
                  {[
                    lang === "ar" ? "الحملة" : "Campaign",
                    lang === "ar" ? "المنصة" : "Platform",
                    lang === "ar" ? "الإنفاق" : "Spend",
                    lang === "ar" ? "ليدز المنصة" : "Platform leads",
                    "CPL",
                    "CTR",
                    lang === "ar" ? "الفواتير" : "Invoices",
                    lang === "ar" ? "أوامر البيع" : "Sales orders",
                    lang === "ar" ? "الإيراد" : "Revenue",
                    "ROAS",
                  ].map((h) => (
                    <th key={h} className="px-3 py-3 text-start font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {buyer.rows.map((row) => (
                  <tr key={row.key} className="hover:bg-surface-2/60">
                    <td className="max-w-[280px] px-3 py-3 font-medium text-text">
                      <span className="block truncate" title={row.campaignName}>
                        {row.campaignName || row.name}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-text-muted">
                      {row.platforms.join(" + ") || "—"}
                    </td>
                    <td className="num px-3 py-3">{fmtUSDFull(row.spend)}</td>
                    <td className="num px-3 py-3">
                      {row.platformLeads === null ? "—" : fmtNum(row.platformLeads)}
                    </td>
                    <td className="num px-3 py-3">{fmtUSDFull(row.cpl)}</td>
                    <td className="num px-3 py-3">{fmtPct(row.ctrAll, 2)}</td>
                    <td className="num px-3 py-3">{fmtNum(row.invoices)}</td>
                    <td className="num px-3 py-3">{fmtNum(row.salesOrders)}</td>
                    <td className="num px-3 py-3">{fmtUSDFull(row.revenue)}</td>
                    <td className="num px-3 py-3">
                      {row.roas === null ? "—" : `${row.roas.toFixed(2)}×`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="num mt-1 text-base font-semibold text-text">{value}</div>
    </div>
  );
}
