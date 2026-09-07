import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  BadgeDollarSign,
  ChartNoAxesCombined,
  Info,
  ReceiptText,
  Trophy,
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
  InsightRow,
  KpiRow,
} from "@/components/dashboard-bits";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { FilterSummary } from "@/components/ads/FilterSummary";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { PerfRow, Platform } from "@/lib/types";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { InsightDetailTrigger, MetricDetailTrigger } from "@/components/metric-detail";
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
 * One buyer's own four figures, each opening onto that buyer's campaigns.
 *
 * The page-level cards compare the two people; these describe one of them. The
 * breakdown in each is that buyer's own campaign list sorted on the figure
 * being opened, which is the question a manager actually has here: not "who
 * spent more", but "where did MY spend go".
 */
function perBuyerMetrics(buyer: Buyer, lang: "ar" | "en"): Record<string, MetricDetail> {
  const A = lang === "ar";
  const campaigns = (
    pick: (row: PerfRow) => number,
    format: (n: number) => string,
    tone: "rose" | "sky" | "violet" | "mint",
  ) => ({
    id: "campaigns",
    title: A ? `حملات ${buyer.name}` : `${buyer.name}'s campaigns`,
    rows: topRows(
      buyer.rows.map((row) => ({
        key: row.key,
        label: row.campaignName || row.name,
        value: pick(row),
        display: format(pick(row)),
        meta: `${fmtUSDFull(row.spend)} → ${fmtUSDFull(row.revenue)}`,
        tone,
      })),
    ),
    moreTo: "/campaigns",
    moreLabel: A ? "فتح تقرير الحملات" : "Open the campaigns report",
    emptyLabel: A ? "لا توجد حملات في الفترة" : "No campaigns in this period",
  });
  const shared = {
    tone: undefined,
    entity: { type: "media_buyer", id: buyer.id, name: buyer.name },
    report: { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" },
  } as const;
  const efficiency = [
    {
      key: "roas",
      label: A ? "العائد" : "Return",
      value: buyer.roas === null ? "—" : `${buyer.roas.toFixed(2)}×`,
    },
    { key: "cpl", label: "CPL", value: fmtUSDFull(buyer.cpl) },
    { key: "cpa", label: "CPA", value: fmtUSDFull(buyer.cpa) },
    {
      key: "conversion",
      label: A ? "نسبة الإغلاق" : "Conversion",
      value: fmtPct(buyer.conversionRate, 1),
    },
  ];

  return {
    spend: {
      ...shared,
      id: `media_buyers.${buyer.id}.spend`,
      title: A ? `إنفاق ${buyer.name}` : `${buyer.name}'s spend`,
      value: fmtUSDFull(buyer.spend),
      tone: "rose",
      icon: <BadgeDollarSign size={16} />,
      deltaInvert: true,
      definition: A
        ? `ما أنفقته حملات ${buyer.name} في الفترة، عبر ${buyer.platforms.join(" و ") || "—"}.`
        : `What ${buyer.name}'s campaigns spent in the period, across ${buyer.platforms.join(" and ") || "—"}.`,
      supporting: [
        { key: "campaigns", label: A ? "الحملات" : "Campaigns", value: fmtNum(buyer.campaigns) },
        {
          key: "platforms",
          label: A ? "المنصات" : "Platforms",
          value: buyer.platforms.join(" · ") || "—",
        },
        { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSDFull(buyer.revenue) },
        efficiency[0],
      ],
      breakdowns: [campaigns((row) => row.spend, fmtUSDFull, "rose")],
    },

    platformLeads: {
      ...shared,
      id: `media_buyers.${buyer.id}.platformLeads`,
      title: A ? `ليدز منصات ${buyer.name}` : `${buyer.name}'s platform leads`,
      value: buyer.platformLeads === null ? "—" : fmtNum(buyer.platformLeads),
      tone: "sky",
      icon: <Users size={16} />,
      definition: A
        ? "عدد العملاء الذي تبلّغ عنه المنصات نفسها. يختلف عن عدد أودو: المنصة تعدّ نموذجًا مُرسلًا، وأودو يعدّ صفًا وصل فعلًا."
        : "The lead count the platforms themselves report. It differs from Odoo's: the platform counts a submitted form, Odoo counts a row that actually arrived.",
      formula: `${buyer.platformLeads === null ? "—" : fmtNum(buyer.platformLeads)} ${A ? "حسب المنصات، مقابل" : "per the platforms, against"} ${fmtNum(buyer.crmLeads)} ${A ? "في أودو" : "in Odoo"}`,
      supporting: [
        { key: "crmLeads", label: A ? "ليدز أودو" : "Odoo leads", value: fmtNum(buyer.crmLeads) },
        efficiency[1],
        { key: "won", label: A ? "الصفقات" : "Won", value: fmtNum(buyer.won) },
        efficiency[3],
      ],
      breakdowns: [campaigns((row) => row.crmLeads, fmtNum, "sky")],
    },

    invoices: {
      ...shared,
      id: `media_buyers.${buyer.id}.invoices`,
      title: A ? `فواتير ${buyer.name}` : `${buyer.name}'s invoices`,
      value: fmtNum(buyer.invoices),
      tone: "violet",
      icon: <ReceiptText size={16} />,
      definition: A
        ? "عدد الفواتير المدفوعة المنسوبة لحملات هذا الميديا باير في الفترة."
        : "Paid invoices attributed to this buyer's campaigns in the period.",
      supporting: [
        {
          key: "salesOrders",
          label: A ? "أوامر البيع" : "Sales orders",
          value: fmtNum(buyer.salesOrders),
        },
        { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSDFull(buyer.revenue) },
        {
          key: "avg",
          label: A ? "متوسط الفاتورة" : "Average invoice",
          value: buyer.invoices > 0 ? fmtUSDFull(buyer.revenue / buyer.invoices) : "—",
        },
        { key: "won", label: A ? "الصفقات" : "Won", value: fmtNum(buyer.won) },
      ],
      breakdowns: [campaigns((row) => row.invoices, fmtNum, "violet")],
    },

    revenue: {
      ...shared,
      id: `media_buyers.${buyer.id}.revenue`,
      title: A ? `إيراد ${buyer.name}` : `${buyer.name}'s revenue`,
      value: fmtUSDFull(buyer.revenue),
      tone: "mint",
      icon: <ChartNoAxesCombined size={16} />,
      definition: A
        ? "التحصيل المنسوب لحملات هذا الميديا باير في الفترة، من الفواتير المدفوعة."
        : "Collection attributed to this buyer's campaigns in the period, from paid invoices.",
      formula:
        buyer.spend > 0
          ? `${fmtUSDFull(buyer.revenue)} ÷ ${fmtUSDFull(buyer.spend)} = ${buyer.roas?.toFixed(2) ?? "—"}×`
          : undefined,
      supporting: [
        { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSDFull(buyer.spend) },
        efficiency[0],
        { key: "invoices", label: A ? "الفواتير" : "Invoices", value: fmtNum(buyer.invoices) },
        efficiency[2],
      ],
      breakdowns: [campaigns((row) => row.revenue, fmtUSDFull, "mint")],
    },
  };
}

/**
 * The three readings of the buyer comparison, and the ranking behind each.
 *
 * "Top media buyer" is a sort over two people; opening it shows both rows and
 * the spend, revenue and lead counts they were sorted on, so the winner is
 * checkable rather than announced. The middle card is the one that matters
 * most: it names the spend that belongs to nobody, and therefore how much of
 * the comparison beside it is missing.
 */
function buyerInsights(
  data: Response,
  best: Buyer | undefined,
  cheapest: Buyer | undefined,
  lang: "ar" | "en",
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const buyerRows = (
    pick: (buyer: Buyer) => number | null,
    format: (n: number) => string,
    tone: "mint" | "rose" | "sky",
  ) =>
    topRows(
      data.buyers.map((buyer) => ({
        key: buyer.id,
        label: buyer.name,
        value: pick(buyer) ?? 0,
        display: pick(buyer) === null ? "—" : format(pick(buyer) as number),
        meta: `${fmtUSDFull(buyer.spend)} ${A ? "إنفاق" : "spend"}`,
        tone,
      })),
      5,
      { keepZero: true },
    );
  const report: MetricDetail["report"] = {
    to: "/campaigns",
    label: A ? "فتح تقرير الحملات" : "Open the campaigns report",
  };

  return {
    topBuyer: {
      id: "media_buyers.topBuyer",
      title: A ? "أفضل ميديا باير بالعائد" : "Top media buyer by return",
      value: best?.roas != null ? `${best.roas.toFixed(2)}×` : "—",
      tone: "mint",
      icon: <Trophy size={16} />,
      entity: best ? { type: "media_buyer", id: best.id, name: best.name } : null,
      definition: A
        ? "الميديا باير صاحب أعلى عائد على الإنفاق في الفترة: الإيراد المنسوب لحملاته ÷ إنفاقه."
        : "The media buyer with the highest return on spend in the period: revenue attributed to their campaigns ÷ their spend.",
      formula: best
        ? `${fmtUSDFull(best.revenue)} ÷ ${fmtUSDFull(best.spend)} = ${best.roas?.toFixed(2) ?? "—"}×`
        : undefined,
      caveat:
        data.coverage.unassignedSpend > 0
          ? A
            ? `${fmtUSDFull(data.coverage.unassignedSpend)} من الإنفاق لا يحمل مسؤولًا، فهو خارج هذه المقارنة.`
            : `${fmtUSDFull(data.coverage.unassignedSpend)} of spend carries no owner and sits outside this comparison.`
          : undefined,
      supporting: best
        ? [
            { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSDFull(best.spend) },
            { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSDFull(best.revenue) },
            { key: "leads", label: A ? "ليدز أودو" : "Odoo leads", value: fmtNum(best.crmLeads) },
            { key: "campaigns", label: A ? "الحملات" : "Campaigns", value: fmtNum(best.campaigns) },
          ]
        : undefined,
      breakdowns: [
        {
          id: "roas",
          title: A ? "العائد حسب الميديا باير" : "Return by media buyer",
          rows: buyerRows(
            (buyer) => buyer.roas,
            (n) => `${n.toFixed(2)}×`,
            "mint",
          ),
          emptyLabel: A ? "لا يوجد عائد قابل للقياس" : "No measurable return",
        },
        {
          id: "campaigns",
          title: A ? "أعلى حملاته إنفاقًا" : "Their highest-spending campaigns",
          rows: best
            ? topRows(
                best.rows.map((row) => ({
                  key: row.key,
                  label: row.campaignName || row.name,
                  value: row.spend,
                  display: fmtUSDFull(row.spend),
                  meta: `${fmtUSDFull(row.revenue)} ${A ? "إيراد" : "revenue"}`,
                  tone: "mint" as const,
                })),
              )
            : [],
          moreTo: "/campaigns",
          moreLabel: A ? "فتح كل الحملات" : "Open every campaign",
          emptyLabel: A ? "لا توجد حملات في الفترة" : "No campaigns in this period",
        },
      ],
      report,
    },

    unownedSpend: {
      id: "media_buyers.unownedSpend",
      title: A ? "إنفاق بلا مسؤول" : "Spend without an owner",
      value: fmtUSDFull(data.coverage.unassignedSpend),
      tone: data.coverage.unassignedSpend > 0 ? "rose" : "mint",
      icon: <AlertTriangle size={16} />,
      deltaInvert: true,
      definition: A
        ? "إنفاق حملات لا تحمل علامة مسؤول في اسمها، فلا يمكن نسبتها لأي ميديا باير — وهي خارج كل مقارنة في هذه الصفحة."
        : "Spend on campaigns whose names carry no owner tag, so it cannot be attributed to any buyer — and it sits outside every comparison on this page.",
      formula: A
        ? `${fmtNum(data.coverage.unassignedCampaigns)} حملة بلا مسؤول من إجمالي ${fmtNum(data.coverage.assignedCampaigns + data.coverage.unassignedCampaigns)}.`
        : `${fmtNum(data.coverage.unassignedCampaigns)} unowned campaigns out of ${fmtNum(data.coverage.assignedCampaigns + data.coverage.unassignedCampaigns)}.`,
      supporting: [
        {
          key: "assigned",
          label: A ? "حملات لها مسؤول" : "Owned campaigns",
          value: fmtNum(data.coverage.assignedCampaigns),
        },
        {
          key: "unassigned",
          label: A ? "حملات بلا مسؤول" : "Unowned campaigns",
          value: fmtNum(data.coverage.unassignedCampaigns),
        },
        {
          key: "ambiguous",
          label: A ? "حملات ملتبسة" : "Ambiguous campaigns",
          value: fmtNum(data.coverage.ambiguousCampaigns),
          hint: A ? "اسمها يحمل أكثر من علامة" : "Their name carries more than one tag",
        },
        {
          key: "ambiguousSpend",
          label: A ? "إنفاق ملتبس" : "Ambiguous spend",
          value: fmtUSDFull(data.coverage.ambiguousSpend),
        },
      ],
      report,
    },

    cheapestLead: {
      id: "media_buyers.cheapestLead",
      title: A ? "أقل تكلفة لكل عميل" : "Best cost per lead",
      value: cheapest?.cpl != null ? fmtUSDFull(cheapest.cpl) : "—",
      tone: "sky",
      icon: <BadgeDollarSign size={16} />,
      deltaInvert: true,
      entity: cheapest ? { type: "media_buyer", id: cheapest.id, name: cheapest.name } : null,
      definition: A
        ? "أقل تكلفة لكل عميل محتمل في أودو. المقام هنا هو ليدز أودو، لا العدد الذي تبلّغ عنه المنصة."
        : "The lowest cost per Odoo lead. The denominator here is Odoo leads, not the count the platform reports.",
      formula: cheapest
        ? `${fmtUSDFull(cheapest.spend)} ÷ ${fmtNum(cheapest.crmLeads)} = ${fmtUSDFull(cheapest.cpl)}`
        : undefined,
      supporting: cheapest
        ? [
            { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSDFull(cheapest.spend) },
            {
              key: "leads",
              label: A ? "المقام · ليدز أودو" : "Denominator · Odoo leads",
              value: fmtNum(cheapest.crmLeads),
            },
            {
              key: "platformLeads",
              label: A ? "ليدز المنصات" : "Platform leads",
              value: cheapest.platformLeads === null ? "—" : fmtNum(cheapest.platformLeads),
            },
            {
              key: "conversion",
              label: A ? "نسبة الإغلاق" : "Conversion",
              value: fmtPct(cheapest.conversionRate, 1),
            },
          ]
        : undefined,
      breakdowns: [
        {
          id: "cpl",
          title: A ? "تكلفة العميل حسب الميديا باير" : "Cost per lead, by media buyer",
          hint: A ? "الأقل أفضل." : "Lower is better.",
          rows: buyerRows((buyer) => buyer.cpl, fmtUSDFull, "sky"),
          emptyLabel: A ? "لا توجد تكلفة قابلة للقياس" : "No measurable cost per lead",
        },
      ],
      report,
    },
  };
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
  const insights = buyerInsights(data, bestBuyer ?? undefined, cheapestBuyer ?? undefined, lang);

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
        <InsightDetailTrigger
          detail={insights.topBuyer}
          card={{
            index: 0,
            kind: "best",
            eyebrow: lang === "ar" ? "أفضل ميديا باير" : "Top media buyer",
            title: bestBuyer
              ? bestBuyer.name
              : lang === "ar"
                ? "لا يوجد ميديا باير مؤهل"
                : "No eligible media buyer",
            value: bestBuyer?.roas != null ? `${bestBuyer.roas.toFixed(2)}×` : undefined,
            detail: bestBuyer
              ? lang === "ar"
                ? `${fmtUSDFull(bestBuyer.revenue)} إيراد من ${fmtUSDFull(bestBuyer.spend)} إنفاق عبر ${fmtNum(bestBuyer.campaigns)} حملة`
                : `${fmtUSDFull(bestBuyer.revenue)} from ${fmtUSDFull(bestBuyer.spend)} of spend across ${fmtNum(bestBuyer.campaigns)} campaigns`
              : undefined,
            actionLabel: lang === "ar" ? "لماذا هو الأفضل؟" : "Why them?",
          }}
        />
        <InsightDetailTrigger
          detail={insights.unownedSpend}
          card={{
            index: 1,
            kind: data.coverage.unassignedSpend > 0 ? "attention" : "opportunity",
            eyebrow: lang === "ar" ? "صرف بلا مسؤول" : "Spend without an owner",
            title:
              data.coverage.unassignedSpend > 0
                ? lang === "ar"
                  ? "جزء من الإنفاق غير منسوب لأي ميديا باير"
                  : "Part of the spend is not attributed to any buyer"
                : lang === "ar"
                  ? "كل الإنفاق منسوب لمسؤول"
                  : "All spend has an owner",
            value:
              data.coverage.unassignedSpend > 0
                ? fmtUSDFull(data.coverage.unassignedSpend)
                : undefined,
            detail:
              data.coverage.unassignedSpend > 0
                ? lang === "ar"
                  ? `${fmtNum(data.coverage.unassignedCampaigns)} حملة لا تحمل علامة مسؤول في اسمها، فلا تدخل في المقارنة أدناه.`
                  : `${fmtNum(data.coverage.unassignedCampaigns)} campaigns carry no owner tag in their name, so they are outside the comparison below.`
                : undefined,
            actionLabel: lang === "ar" ? "ما المستبعد؟" : "What is excluded?",
          }}
        />
        <InsightDetailTrigger
          detail={insights.cheapestLead}
          card={{
            index: 2,
            kind: "note",
            eyebrow: lang === "ar" ? "أقل تكلفة لكل عميل" : "Best cost per lead",
            title: cheapestBuyer
              ? cheapestBuyer.name
              : lang === "ar"
                ? "لا توجد تكلفة قابلة للقياس"
                : "No measurable cost per lead",
            value: cheapestBuyer?.cpl != null ? fmtUSDFull(cheapestBuyer.cpl) : undefined,
            detail: cheapestBuyer
              ? lang === "ar"
                ? `${fmtNum(cheapestBuyer.crmLeads)} عميل في أودو من ${fmtUSDFull(cheapestBuyer.spend)} إنفاق`
                : `${fmtNum(cheapestBuyer.crmLeads)} Odoo leads from ${fmtUSDFull(cheapestBuyer.spend)} of spend`
              : undefined,
            actionLabel: lang === "ar" ? "على أي مقام؟" : "Over what denominator?",
          }}
        />
      </InsightRow>

      <div className="card-grid xl:grid-cols-2">
        {data.buyers.map((buyer, buyerIndex) => {
          const perBuyer = perBuyerMetrics(buyer, lang);
          return (
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
                <MetricDetailTrigger
                  detail={perBuyer.spend}
                  card={{ index: buyerIndex * 4, compact: true }}
                />
                <MetricDetailTrigger
                  detail={perBuyer.platformLeads}
                  card={{ index: buyerIndex * 4 + 1, compact: true }}
                />
                <MetricDetailTrigger
                  detail={perBuyer.invoices}
                  card={{
                    index: buyerIndex * 4 + 2,
                    compact: true,
                    sub: `${fmtNum(buyer.salesOrders)} ${lang === "ar" ? "أمر بيع" : "sales orders"}`,
                  }}
                />
                <MetricDetailTrigger
                  detail={perBuyer.revenue}
                  card={{ index: buyerIndex * 4 + 3, compact: true, hero: true }}
                />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Mini
                  label="ROAS"
                  value={buyer.roas === null ? "—" : `${buyer.roas.toFixed(2)}×`}
                />
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
          );
        })}
      </div>

      <Card>
        <SectionTitle>
          {lang === "ar" ? "فحص دقة توزيع الحملات" : "Campaign ownership coverage"}
        </SectionTitle>
        <div className="card-grid grid-cols-2 lg:grid-cols-4">
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
