import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  BadgeDollarSign,
  FileCheck2,
  FileText,
  HeartHandshake,
  Info,
  Megaphone,
  Receipt,
  ReceiptText,
  ShoppingCart,
  Trophy,
  Users,
} from "lucide-react";
import { FilterSummary } from "@/components/ads/FilterSummary";
import { PlatformBadges } from "@/components/metric-bits";
import { DataTable, type Col } from "@/components/DataTable";
import {
  Card,
  ErrorState,
  FunnelBars,
  KpiCard,
  Notice,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { DashboardPageHeader } from "@/components/dashboard-bits";
import { KpiRow } from "@/components/dashboard-bits";
import { InsightDetailTrigger, MetricDetailTrigger } from "@/components/metric-detail";
import { topRows, type MetricDetail } from "@/lib/metric-detail";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { fmtNum, fmtPct, fmtRoas, fmtUSDFull, useI18n } from "@/lib/i18n";
import type { Platform } from "@/lib/types";
import { useApi } from "@/lib/use-api";

/**
 * Hidden report.
 *
 * Off the sidebar and off the section tabs, and an old bookmark or a pasted
 * link lands in Accounting rather than here — hidden everywhere, not just in
 * the menu, which is what "hide the page" has to mean for a report whose
 * numbers are still being reconciled.
 *
 * Nothing below is deleted. Dropping this `beforeLoad` and relisting `/sales`
 * in `navigation.ts` is the entire cost of bringing the report back.
 */
export const Route = createFileRoute("/sales")({
  beforeLoad: () => {
    throw redirect({ to: "/accounting", replace: true });
  },
  component: SalesReport,
});

interface SalesAttributionRow {
  key: string;
  name: string;
  leads: number;
  interested: number;
  quotations: number;
  won: number;
  lost: number;
  salesOrders: number;
  invoices: number;
  revenue: number;
  leadToWonRate: number | null;
  leadToInvoiceRate: number | null;
}

interface SalesCampaignRow extends SalesAttributionRow {
  platforms: Platform[];
  spend: number;
  roas: number | null;
}

interface SalesResponse {
  funnel: {
    leads: number;
    interested: number;
    quotations: number;
    won: number;
    salesOrders: number;
    invoices: number;
  };
  totals: {
    revenue: number;
    averageInvoice: number | null;
    attributedRevenue: number;
    unmatchedRevenue: number;
  };
  sources: SalesAttributionRow[];
  campaigns: SalesCampaignRow[];
  insights: {
    bestSellingSource: SalesAttributionRow | null;
    bestConvertingSource: SalesAttributionRow | null;
    bestSellingCampaign: SalesCampaignRow | null;
    bestConvertingCampaign: SalesCampaignRow | null;
  };
  definitions: {
    stageBasis: string;
    salesOrderBasis: string;
    invoiceBasis: string;
    revenueBasis: string;
    dateBasis: "payment" | "invoice";
  };
}

/**
 * The three winners named beside the funnel, and the tables they were picked from.
 *
 * "Best-selling source" is the app running a sort and announcing the top row.
 * Opening it shows that sort — the top five of the same list — plus the counts
 * behind the headline, so the reader can see the second place and decide for
 * themselves whether the gap is meaningful.
 */
function salesInsights(data: SalesResponse, lang: "ar" | "en"): Record<string, MetricDetail> {
  const A = lang === "ar";
  const rowFacts = (row: SalesAttributionRow | null) =>
    row
      ? [
          { key: "leads", label: A ? "الليدز" : "Leads", value: fmtNum(row.leads) },
          { key: "won", label: A ? "الصفقات" : "Won", value: fmtNum(row.won) },
          { key: "invoices", label: A ? "الفواتير" : "Invoices", value: fmtNum(row.invoices) },
          { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSDFull(row.revenue) },
        ]
      : undefined;

  const sourceRanking = (
    id: string,
    title: string,
    pick: (row: SalesAttributionRow) => number,
    format: (n: number) => string,
    tone: "mint" | "sky" | "violet",
  ) => ({
    id,
    title,
    hint: A ? "هذا هو الترتيب الذي اختار الصف أعلاه." : "The ranking that named the row above.",
    rows: topRows(
      data.sources.map((row) => ({
        key: row.key,
        label: row.name,
        value: pick(row),
        display: format(pick(row)),
        meta: `${fmtNum(row.won)}/${fmtNum(row.leads)}`,
        tone,
      })),
    ),
    emptyLabel: A ? "لا توجد مصادر منسوبة في الفترة" : "No attributed sources in this period",
  });

  return {
    bestSellingSource: {
      id: "sales.bestSellingSource",
      title: A ? "أفضل مصدر بيعًا" : "Best-selling source",
      value: data.insights.bestSellingSource?.name ?? "—",
      tone: "mint",
      icon: <FileCheck2 size={16} />,
      entity: data.insights.bestSellingSource
        ? {
            type: "source",
            id: data.insights.bestSellingSource.key,
            name: data.insights.bestSellingSource.name,
          }
        : null,
      definition: A
        ? "المصدر الذي نُسب إليه أكبر تحصيل في الفترة، محسوبًا من الفواتير المدفوعة."
        : "The source credited with the most collection in the period, counted from paid invoices.",
      formula: data.insights.bestSellingSource
        ? A
          ? `${fmtUSDFull(data.insights.bestSellingSource.revenue)} من إجمالي ${fmtUSDFull(data.totals.revenue)}.`
          : `${fmtUSDFull(data.insights.bestSellingSource.revenue)} of ${fmtUSDFull(data.totals.revenue)}.`
        : undefined,
      supporting: rowFacts(data.insights.bestSellingSource),
      breakdowns: [
        sourceRanking(
          "revenue",
          A ? "الإيراد حسب المصدر" : "Revenue by source",
          (row) => row.revenue,
          fmtUSDFull,
          "mint",
        ),
      ],
      report: { to: "/leads", label: A ? "فتح تقرير العملاء" : "Open the leads report" },
    },

    bestSellingCampaign: {
      id: "sales.bestSellingCampaign",
      title: A ? "أفضل حملة بيعًا" : "Best-selling campaign",
      value: data.insights.bestSellingCampaign?.name ?? "—",
      tone: "violet",
      icon: <Megaphone size={16} />,
      entity: data.insights.bestSellingCampaign
        ? {
            type: "campaign",
            id: data.insights.bestSellingCampaign.key,
            name: data.insights.bestSellingCampaign.name,
          }
        : null,
      definition: A
        ? "الحملة التي نُسب إليها أكبر تحصيل في الفترة. الإنفاق يظهر بجوارها لأن الإيراد وحده لا يقول إن كانت مربحة."
        : "The campaign credited with the most collection in the period. Its spend sits beside it, because revenue alone does not say whether it paid for itself.",
      supporting: data.insights.bestSellingCampaign
        ? [
            {
              key: "revenue",
              label: A ? "الإيراد" : "Revenue",
              value: fmtUSDFull(data.insights.bestSellingCampaign.revenue),
            },
            {
              key: "spend",
              label: A ? "الإنفاق" : "Spend",
              value: fmtUSDFull(data.insights.bestSellingCampaign.spend),
            },
            {
              key: "roas",
              label: A ? "العائد" : "Return",
              value:
                data.insights.bestSellingCampaign.roas === null
                  ? "—"
                  : `${data.insights.bestSellingCampaign.roas.toFixed(2)}×`,
            },
            {
              key: "won",
              label: A ? "الصفقات" : "Won",
              value: fmtNum(data.insights.bestSellingCampaign.won),
            },
          ]
        : undefined,
      breakdowns: [
        {
          id: "campaigns",
          title: A ? "الإيراد حسب الحملة" : "Revenue by campaign",
          hint: A
            ? "هذا هو الترتيب الذي اختار الحملة أعلاه."
            : "The ranking that named the campaign above.",
          rows: topRows(
            data.campaigns.map((row) => ({
              key: row.key,
              label: row.name,
              value: row.revenue,
              display: fmtUSDFull(row.revenue),
              meta: `${fmtUSDFull(row.spend)} ${A ? "إنفاق" : "spend"}`,
              tone: "violet" as const,
            })),
          ),
          moreTo: "/campaigns",
          moreLabel: A ? "فتح تقرير الحملات" : "Open the campaigns report",
          emptyLabel: A
            ? "لا توجد حملات منسوبة في الفترة"
            : "No attributed campaigns in this period",
        },
      ],
      report: { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" },
    },

    bestConvertingSource: {
      id: "sales.bestConvertingSource",
      title: A ? "أفضل مصدر تحويلًا" : "Best-converting source",
      value: data.insights.bestConvertingSource
        ? fmtPct(data.insights.bestConvertingSource.leadToWonRate, 1)
        : "—",
      tone: "sky",
      icon: <Trophy size={16} />,
      entity: data.insights.bestConvertingSource
        ? {
            type: "source",
            id: data.insights.bestConvertingSource.key,
            name: data.insights.bestConvertingSource.name,
          }
        : null,
      definition: A
        ? "المصدر الذي أغلق أعلى نسبة من عملائه المحتملين. النسبة وحدها مضلّلة، فالبسط والمقام معها دائمًا."
        : "The source that closed the highest share of its own leads. The rate alone misleads, so its numerator and denominator travel with it.",
      formula: data.insights.bestConvertingSource
        ? `${fmtNum(data.insights.bestConvertingSource.won)} ÷ ${fmtNum(data.insights.bestConvertingSource.leads)} = ${fmtPct(data.insights.bestConvertingSource.leadToWonRate, 1)}`
        : undefined,
      supporting: data.insights.bestConvertingSource
        ? [
            {
              key: "won",
              label: A ? "البسط · Won" : "Numerator · won",
              value: fmtNum(data.insights.bestConvertingSource.won),
            },
            {
              key: "leads",
              label: A ? "المقام · الليدز" : "Denominator · leads",
              value: fmtNum(data.insights.bestConvertingSource.leads),
            },
            {
              key: "invoices",
              label: A ? "الفواتير" : "Invoices",
              value: fmtNum(data.insights.bestConvertingSource.invoices),
            },
            {
              key: "revenue",
              label: A ? "الإيراد" : "Revenue",
              value: fmtUSDFull(data.insights.bestConvertingSource.revenue),
            },
          ]
        : undefined,
      breakdowns: [
        sourceRanking(
          "conversion",
          A ? "نسبة الإغلاق حسب المصدر" : "Conversion by source",
          (row) => row.leadToWonRate ?? 0,
          (n) => fmtPct(n, 1),
          "sky",
        ),
      ],
      report: { to: "/leads", label: A ? "فتح تقرير العملاء" : "Open the leads report" },
    },
  };
}

function rate(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : null;
}

/**
 * Each step of the funnel, and the sources and campaigns behind it.
 *
 * THE STAGES ARE NOT A HISTORY. "Interested" and "Quotation" are read from the
 * lead's CURRENT stage or a clearly later one, because this dataset carries no
 * record of every transition a lead made. Each panel says so, so nobody reads a
 * step as "how many passed through here".
 */
function salesMetrics(data: SalesResponse, lang: "ar" | "en"): Record<string, MetricDetail> {
  const A = lang === "ar";
  const F = data.funnel;
  const T = data.totals;
  const stageNote = A
    ? "المرحلة تُقرأ من حالة العميل الحالية أو مرحلة أبعد منها؛ لا يوجد سجل كامل لكل انتقال، فالرقم يعني «وصل إلى هنا على الأقل» لا «مرّ من هنا»."
    : "A stage is read from the lead's current position or a clearly later one; there is no complete transition history, so the figure means “reached at least here”, not “passed through here”.";

  const bySource = (
    pick: (row: SalesAttributionRow) => number,
    format: (n: number) => string,
    tone: "mint" | "sky" | "violet",
  ) =>
    topRows(
      data.sources.map((row) => ({
        key: row.key,
        label: row.name,
        value: pick(row),
        display: format(pick(row)),
        meta: `${fmtNum(row.leads)} ${A ? "ليد" : "leads"}`,
        tone,
      })),
    );
  const byCampaign = (
    pick: (row: SalesCampaignRow) => number,
    format: (n: number) => string,
    tone: "mint" | "sky" | "violet",
  ) =>
    topRows(
      data.campaigns.map((row) => ({
        key: row.key,
        label: row.name,
        value: pick(row),
        display: format(pick(row)),
        meta: `${fmtNum(row.leads)} ${A ? "ليد" : "leads"}`,
        tone,
      })),
    );

  const step = (
    id: string,
    title: string,
    value: number,
    definition: string,
    pick: (row: SalesAttributionRow) => number,
    pickCampaign: (row: SalesCampaignRow) => number,
    tone: MetricDetail["tone"],
  ): MetricDetail => ({
    id,
    title,
    value: fmtNum(value),
    tone,
    definition,
    caveat: stageNote,
    formula: `${fmtNum(value)} ÷ ${fmtNum(F.leads)} = ${fmtPct(rate(value, F.leads), 1)}`,
    supporting: [
      { key: "leads", label: A ? "الليدز الداخلة" : "Leads entered", value: fmtNum(F.leads) },
      { key: "won", label: "Won", value: fmtNum(F.won) },
      { key: "invoices", label: A ? "فواتير مدفوعة" : "Paid invoices", value: fmtNum(F.invoices) },
      { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSDFull(T.revenue) },
    ],
    breakdowns: [
      {
        id: "sources",
        title: A ? "حسب المصدر" : "By source",
        rows: bySource(pick, fmtNum, "sky"),
        emptyLabel: A ? "لا توجد مصادر" : "No sources",
      },
      {
        id: "campaigns",
        title: A ? "حسب الحملة" : "By campaign",
        rows: byCampaign(pickCampaign, fmtNum, "violet"),
        emptyLabel: A ? "لا توجد حملات" : "No campaigns",
      },
    ],
    report: { to: "/leads", label: A ? "فتح تقرير العملاء" : "Open the leads report" },
  });

  return {
    leads: step(
      "sales.leads",
      A ? "الليدز الداخلة" : "Leads entered",
      F.leads,
      A
        ? "العملاء المحتملون الذين دخلوا النظام داخل الفترة. هذا هو مقام كل نسبة في هذا الصف."
        : "Leads that entered the system inside the period. This is the denominator of every rate in this row.",
      (row) => row.leads,
      (row) => row.leads,
      "sky",
    ),
    interested: step(
      "sales.interested",
      A ? "مهتم أو أبعد" : "Interested+",
      F.interested,
      A
        ? "العملاء الذين وصلوا إلى مرحلة الاهتمام أو ما بعدها."
        : "Leads that reached the interested stage or anything beyond it.",
      (row) => row.interested,
      (row) => row.interested,
      "violet",
    ),
    quotations: step(
      "sales.quotations",
      A ? "كوتيشن أو أبعد" : "Quotation+",
      F.quotations,
      A
        ? "العملاء الذين وصلوا إلى مرحلة عرض السعر أو ما بعدها."
        : "Leads that reached the quotation stage or anything beyond it.",
      (row) => row.quotations,
      (row) => row.quotations,
      "violet",
    ),
    won: step(
      "sales.won",
      "Won",
      F.won,
      A
        ? "العملاء الذين أُغلقت صفقتهم رابحة داخل الفترة."
        : "Leads whose deal closed as won inside the period.",
      (row) => row.won,
      (row) => row.won,
      "violet",
    ),
    salesOrders: {
      id: "sales.salesOrders",
      title: A ? "أوامر بيع" : "Sales orders",
      value: fmtNum(F.salesOrders),
      tone: "cyan",
      icon: <ShoppingCart size={16} />,
      definition: A
        ? "أوامر البيع المفوترة بالكامل. مصدرها مختلف عن الفواتير المدفوعة، فلا يلزم أن يتطابق العددان."
        : "Fully invoiced sales orders. A different source from the paid invoices, so the two counts are not required to match.",
      formula: A
        ? `${fmtNum(F.salesOrders)} أمر بيع مقابل ${fmtNum(F.invoices)} فاتورة مدفوعة و${fmtNum(F.won)} صفقة رابحة.`
        : `${fmtNum(F.salesOrders)} sales orders against ${fmtNum(F.invoices)} paid invoices and ${fmtNum(F.won)} won deals.`,
      supporting: [
        {
          key: "invoices",
          label: A ? "فواتير مدفوعة" : "Paid invoices",
          value: fmtNum(F.invoices),
        },
        { key: "won", label: "Won", value: fmtNum(F.won) },
        { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSDFull(T.revenue) },
        { key: "leads", label: A ? "الليدز" : "Leads", value: fmtNum(F.leads) },
      ],
      breakdowns: [
        {
          id: "sources",
          title: A ? "حسب المصدر" : "By source",
          rows: bySource((row) => row.salesOrders, fmtNum, "mint"),
          emptyLabel: A ? "لا توجد مصادر" : "No sources",
        },
      ],
    },
    invoices: {
      id: "sales.invoices",
      title: A ? "فواتير مدفوعة" : "Paid invoices",
      value: fmtNum(F.invoices),
      tone: "mint",
      icon: <ReceiptText size={16} />,
      definition: A
        ? "المستندات المحاسبية المدفوعة المميزة في الفترة. هذا هو تعريف البيع المعتمد."
        : "Distinct paid accounting documents in the period. This is the approved definition of a sale.",
      formula: `${fmtNum(F.invoices)} ÷ ${fmtNum(F.leads)} = ${fmtPct(rate(F.invoices, F.leads), 1)}`,
      supporting: [
        { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSDFull(T.revenue) },
        {
          key: "avg",
          label: A ? "متوسط الفاتورة" : "Average invoice",
          value: fmtUSDFull(T.averageInvoice),
        },
        { key: "won", label: "Won", value: fmtNum(F.won) },
        { key: "orders", label: A ? "أوامر بيع" : "Sales orders", value: fmtNum(F.salesOrders) },
      ],
      breakdowns: [
        {
          id: "sources",
          title: A ? "حسب المصدر" : "By source",
          rows: bySource((row) => row.invoices, fmtNum, "mint"),
          emptyLabel: A ? "لا توجد مصادر" : "No sources",
        },
        {
          id: "campaigns",
          title: A ? "حسب الحملة" : "By campaign",
          rows: byCampaign((row) => row.invoices, fmtNum, "mint"),
          emptyLabel: A ? "لا توجد حملات" : "No campaigns",
        },
      ],
      report: { to: "/accounting", label: A ? "فتح تقرير الحسابات" : "Open the Accounting report" },
    },
    revenue: {
      id: "sales.revenue",
      title: A ? "الإيراد المحصّل" : "Paid revenue",
      value: fmtUSDFull(T.revenue),
      tone: "mint",
      icon: <BadgeDollarSign size={16} />,
      definition: A
        ? "المبالغ المدفوعة فعليًا في الفترة، بتاريخ الدفع، من فواتير الحسابات."
        : "Money actually collected in the period, on payment date, from Accounting invoices.",
      formula: A
        ? `${fmtUSDFull(T.revenue)} من ${fmtNum(F.invoices)} فاتورة، بمتوسط ${fmtUSDFull(T.averageInvoice)}.`
        : `${fmtUSDFull(T.revenue)} across ${fmtNum(F.invoices)} invoices, averaging ${fmtUSDFull(T.averageInvoice)}.`,
      supporting: [
        {
          key: "avg",
          label: A ? "متوسط الفاتورة" : "Average invoice",
          value: fmtUSDFull(T.averageInvoice),
        },
        {
          key: "attributed",
          label: A ? "مرتبط بحملات" : "Campaign-linked",
          value: fmtUSDFull(T.attributedRevenue),
        },
        {
          key: "unmatched",
          label: A ? "غير مرتبط" : "Unlinked",
          value: fmtUSDFull(T.unmatchedRevenue),
        },
        { key: "invoices", label: A ? "الفواتير" : "Invoices", value: fmtNum(F.invoices) },
      ],
      breakdowns: [
        {
          id: "sources",
          title: A ? "أعلى المصادر إيرادًا" : "Sources with the most revenue",
          rows: bySource((row) => row.revenue, fmtUSDFull, "mint"),
          emptyLabel: A ? "لا توجد مصادر" : "No sources",
        },
        {
          id: "campaigns",
          title: A ? "أعلى الحملات إيرادًا" : "Campaigns with the most revenue",
          rows: byCampaign((row) => row.revenue, fmtUSDFull, "mint"),
          emptyLabel: A ? "لا توجد حملات" : "No campaigns",
        },
      ],
      report: { to: "/accounting", label: A ? "فتح تقرير الحسابات" : "Open the Accounting report" },
    },
  };
}

function SalesReport() {
  const reportingPeriod = useReportingPeriod();
  const { lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<SalesResponse>("/api/sales");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-36" />
        <Skeleton className="h-80" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const ar = lang === "ar";
  // One description per figure, built from the response already on screen.
  const metrics = salesMetrics(data, lang);
  const insights = salesInsights(data, lang);
  const sourceCols: Col<SalesAttributionRow>[] = [
    {
      key: "source",
      header: ar ? "المصدر" : "Source",
      render: (row) => <span className="font-medium">{row.name}</span>,
      sortValue: (row) => row.name,
      sticky: true,
      always: true,
      width: "190px",
    },
    countCol("leads", ar ? "ليد دخل" : "Leads", (row) => row.leads, "funnel"),
    countCol("interested", ar ? "مهتم" : "Interested", (row) => row.interested, "funnel"),
    countCol("quotations", ar ? "كوتيشن" : "Quotation", (row) => row.quotations, "funnel"),
    countCol("won", ar ? "Won" : "Won", (row) => row.won, "funnel"),
    countCol("lost", ar ? "Lost" : "Lost", (row) => row.lost, "funnel", true),
    countCol("salesOrders", ar ? "أوامر بيع" : "Sales orders", (row) => row.salesOrders, "sales"),
    countCol("invoices", ar ? "فواتير مدفوعة" : "Paid invoices", (row) => row.invoices, "sales"),
    {
      key: "revenue",
      header: ar ? "الإيراد المحصّل" : "Paid revenue",
      render: (row) => fmtUSDFull(row.revenue),
      sortValue: (row) => row.revenue,
      align: "right",
      group: "sales",
    },
    {
      key: "conversion",
      header: ar ? "ليد ← Won" : "Lead → Won",
      render: (row) => fmtPct(row.leadToWonRate, 1),
      sortValue: (row) => row.leadToWonRate ?? -1,
      align: "right",
      group: "quality",
    },
    {
      key: "invoiceRate",
      header: ar ? "ليد ← فاتورة" : "Lead → invoice",
      render: (row) => fmtPct(row.leadToInvoiceRate, 1),
      sortValue: (row) => row.leadToInvoiceRate ?? -1,
      align: "right",
      group: "quality",
      hideByDefault: true,
    },
  ];

  const campaignCols: Col<SalesCampaignRow>[] = [
    {
      key: "campaign",
      header: ar ? "الحملة / الإعلان" : "Campaign / ad source",
      render: (row) => (
        <span className="block max-w-[260px] truncate font-medium" title={row.name}>
          {row.name}
        </span>
      ),
      sortValue: (row) => row.name,
      sticky: true,
      always: true,
      width: "260px",
    },
    {
      key: "platform",
      header: ar ? "المنصة" : "Platform",
      render: (row) => <PlatformBadges platforms={row.platforms} />,
      sortValue: (row) => row.platforms.join(","),
      group: "ads",
    },
    {
      key: "spend",
      header: ar ? "الإنفاق" : "Spend",
      render: (row) => fmtUSDFull(row.spend),
      sortValue: (row) => row.spend,
      align: "right",
      group: "ads",
    },
    countCol("leads", ar ? "ليد دخل" : "Leads", (row) => row.leads, "funnel"),
    countCol("interested", ar ? "مهتم" : "Interested", (row) => row.interested, "funnel", true),
    countCol("quotations", ar ? "كوتيشن" : "Quotation", (row) => row.quotations, "funnel", true),
    countCol("won", "Won", (row) => row.won, "funnel"),
    countCol(
      "salesOrders",
      ar ? "أوامر بيع" : "Sales orders",
      (row) => row.salesOrders,
      "sales",
      true,
    ),
    countCol("invoices", ar ? "فواتير" : "Invoices", (row) => row.invoices, "sales"),
    {
      key: "revenue",
      header: ar ? "الإيراد" : "Revenue",
      render: (row) => fmtUSDFull(row.revenue),
      sortValue: (row) => row.revenue,
      align: "right",
      group: "sales",
    },
    {
      key: "roas",
      header: "ROAS",
      render: (row) => fmtRoas(row.roas),
      sortValue: (row) => row.roas ?? -1,
      align: "right",
      group: "quality",
    },
    {
      key: "conversion",
      header: ar ? "ليد ← Won" : "Lead → Won",
      render: (row) => fmtPct(row.leadToWonRate, 1),
      sortValue: (row) => row.leadToWonRate ?? -1,
      align: "right",
      group: "quality",
    },
  ];

  const funnelSteps = [
    { label: ar ? "ليد دخل" : "Leads entered", value: data.funnel.leads },
    { label: ar ? "مهتم أو مرحلة أبعد" : "Interested or beyond", value: data.funnel.interested },
    { label: ar ? "كوتيشن أو مرحلة أبعد" : "Quotation or beyond", value: data.funnel.quotations },
    { label: ar ? "صفقة Won في CRM" : "CRM Won deals", value: data.funnel.won },
    {
      label: ar ? "أمر بيع مفوتر بالكامل" : "Fully invoiced sales orders",
      value: data.funnel.salesOrders,
    },
    { label: ar ? "فاتورة مدفوعة" : "Paid invoices", value: data.funnel.invoices, accent: true },
  ].map((step) => ({ ...step, display: fmtNum(step.value) }));

  return (
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<Receipt size={20} />}
        title={ar ? "تقرير المبيعات والفانل" : "Sales funnel report"}
        subtitle={
          ar
            ? "من دخول الليد إلى الاهتمام والكوتيشن والبيع، ثم ربط النتيجة بالمصدر والحملة والفاتورة المدفوعة."
            : "From lead entry to interest, quotation and sale, tied back to source, campaign and paid invoice."
        }
        period={reportingPeriod}
      />
      <FilterSummary />

      <Notice tone="info" icon={<Info size={16} />}>
        {ar
          ? "مهتم وكوتيشن مبنيان على المرحلة الحالية في CRM أو مرحلة أبعد منها؛ أودو لا يوفّر هنا تاريخ كل انتقال سابق. أوامر البيع من Full Invoiced Orders، والفواتير والإيراد من فواتير الحسابات المدفوعة، لذلك عدد الفواتير لا يلزم أن يساوي Won واحدًا مقابل واحد."
          : "Interested and quotation use the current CRM stage or a clearly later stage; this dataset has no complete stage-transition history. Sales orders come from Full Invoiced Orders, while invoices and revenue come from paid Accounting invoices, so counts are not required to match Won one-for-one."}
      </Notice>

      <KpiRow>
        <MetricDetailTrigger
          detail={{ ...metrics.leads, icon: <Users size={16} /> }}
          card={{ index: 0 }}
        />
        <MetricDetailTrigger
          detail={{ ...metrics.interested, icon: <HeartHandshake size={16} /> }}
          card={{ index: 1, sub: fmtPct(rate(data.funnel.interested, data.funnel.leads), 1) }}
        />
        <MetricDetailTrigger
          detail={{ ...metrics.quotations, icon: <FileText size={16} /> }}
          card={{ index: 2, sub: fmtPct(rate(data.funnel.quotations, data.funnel.leads), 1) }}
        />
        <MetricDetailTrigger
          detail={{ ...metrics.won, icon: <Trophy size={16} /> }}
          card={{ index: 3, sub: fmtPct(rate(data.funnel.won, data.funnel.leads), 1) }}
        />
        <MetricDetailTrigger
          detail={metrics.salesOrders}
          card={{ index: 4, sub: ar ? "مفوترة بالكامل" : "Fully invoiced" }}
        />
        <MetricDetailTrigger
          detail={metrics.invoices}
          card={{ index: 5, sub: ar ? "مستندات محاسبية مميزة" : "Distinct accounting documents" }}
        />
        <MetricDetailTrigger
          detail={metrics.revenue}
          card={{
            index: 6,
            hero: true,
            sub: `${ar ? "متوسط الفاتورة" : "Avg. invoice"}: ${fmtUSDFull(data.totals.averageInvoice)}`,
          }}
        />
      </KpiRow>

      <div className="card-grid xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
        <Card>
          <SectionTitle
            hint={
              ar
                ? "نسبة كل مرحلة تظهر مقابل المرحلة السابقة عندما تكون المجموعتان قابلتين للمقارنة."
                : "Each stage shows conversion from the previous stage when the populations are comparable."
            }
          >
            {ar ? "فانل المبيعات" : "Sales funnel"}
          </SectionTitle>
          <FunnelBars steps={funnelSteps} />
        </Card>

        {/* The three winners. `card-grid` rather than a hand-written gap, so
            these sit the same distance apart as any other pair of cards. */}
        <div className="card-grid sm:grid-cols-2 xl:grid-cols-1">
          <InsightDetailTrigger
            detail={insights.bestSellingSource}
            card={{
              index: 0,
              kind: "best",
              eyebrow: ar ? "أفضل مصدر بيعًا" : "Best-selling source",
              title:
                data.insights.bestSellingSource?.name ??
                (ar ? "لا توجد بيانات منسوبة" : "No attributed data"),
              value: data.insights.bestSellingSource
                ? fmtUSDFull(data.insights.bestSellingSource.revenue)
                : undefined,
              detail: data.insights.bestSellingSource
                ? `${fmtNum(data.insights.bestSellingSource.leads)} ${ar ? "ليد" : "leads"} · ${fmtNum(data.insights.bestSellingSource.won)} Won · ${fmtNum(data.insights.bestSellingSource.invoices)} ${ar ? "فاتورة" : "invoices"}`
                : undefined,
              actionLabel: ar ? "ما ترتيب المصادر؟" : "How do the sources rank?",
            }}
          />
          <InsightDetailTrigger
            detail={insights.bestSellingCampaign}
            card={{
              index: 1,
              kind: "note",
              eyebrow: ar ? "أفضل حملة بيعًا" : "Best-selling campaign",
              title:
                data.insights.bestSellingCampaign?.name ??
                (ar ? "لا توجد بيانات منسوبة" : "No attributed data"),
              value: data.insights.bestSellingCampaign
                ? fmtUSDFull(data.insights.bestSellingCampaign.revenue)
                : undefined,
              detail: data.insights.bestSellingCampaign
                ? `${fmtNum(data.insights.bestSellingCampaign.leads)} ${ar ? "ليد" : "leads"} · ${fmtNum(data.insights.bestSellingCampaign.won)} Won · ${fmtNum(data.insights.bestSellingCampaign.invoices)} ${ar ? "فاتورة" : "invoices"}`
                : undefined,
              actionLabel: ar ? "مقابل كم إنفاق؟" : "Against how much spend?",
            }}
          />
          <InsightDetailTrigger
            detail={insights.bestConvertingSource}
            card={{
              index: 2,
              kind: "opportunity",
              eyebrow: ar ? "أفضل مصدر تحويلاً" : "Best-converting source",
              title:
                data.insights.bestConvertingSource?.name ??
                (ar ? "لا توجد بيانات منسوبة" : "No attributed data"),
              value: data.insights.bestConvertingSource
                ? fmtPct(data.insights.bestConvertingSource.leadToWonRate, 1)
                : undefined,
              detail: data.insights.bestConvertingSource
                ? `${fmtNum(data.insights.bestConvertingSource.won)} ${ar ? "من" : "of"} ${fmtNum(data.insights.bestConvertingSource.leads)} ${ar ? "ليد" : "leads"}`
                : undefined,
              actionLabel: ar ? "البسط والمقام؟" : "Out of how many?",
            }}
          />
        </div>
      </div>

      <section>
        <SectionTitle
          hint={
            ar
              ? "يعرض الليد منين وكم وصل لكل مرحلة وكم أمر بيع وفاتورة وإيراد نتج عن المصدر."
              : "Shows where leads came from, how far they progressed, and the orders, invoices and revenue attributed to each source."
          }
        >
          {ar ? "الأداء حسب مصدر الليد" : "Performance by lead source"}
        </SectionTitle>
        <DataTable
          rows={data.sources}
          cols={sourceCols}
          searchable={(row) => row.name}
          pageSize={20}
          initialSort={{ key: "revenue", dir: -1 }}
          columnChooser
          groupLabels={{
            funnel: ar ? "مراحل الليد" : "Lead stages",
            sales: ar ? "البيع والتحصيل" : "Sales & collection",
            quality: ar ? "الجودة" : "Quality",
          }}
          csvFilename="engosoft-sales-funnel-by-source"
          csvRow={(row) => ({
            source: row.name,
            leads: row.leads,
            interested_or_beyond: row.interested,
            quotation_or_beyond: row.quotations,
            won: row.won,
            lost: row.lost,
            sales_orders: row.salesOrders,
            paid_invoices: row.invoices,
            paid_revenue_usd: row.revenue,
            lead_to_won_pct: row.leadToWonRate ?? "",
            lead_to_invoice_pct: row.leadToInvoiceRate ?? "",
          })}
        />
      </section>

      <section>
        <SectionTitle
          hint={
            ar
              ? "يربط الإنفاق والمنصة بليدز CRM والـWon وأوامر البيع والفواتير والإيراد المنسوب للحملة."
              : "Ties platform spend to CRM leads, Won, sales orders, paid invoices and campaign-attributed revenue."
          }
        >
          {ar ? "أي حملة أو إعلان باع أحسن؟" : "Which campaign sold best?"}
        </SectionTitle>
        <DataTable
          rows={data.campaigns}
          cols={campaignCols}
          searchable={(row) => `${row.name} ${row.platforms.join(" ")}`}
          pageSize={25}
          initialSort={{ key: "revenue", dir: -1 }}
          columnChooser
          groupLabels={{
            ads: ar ? "الإعلان" : "Advertising",
            funnel: ar ? "مراحل الليد" : "Lead stages",
            sales: ar ? "البيع والتحصيل" : "Sales & collection",
            quality: ar ? "الكفاءة" : "Efficiency",
          }}
          csvFilename="engosoft-sales-funnel-by-campaign"
          csvRow={(row) => ({
            campaign: row.name,
            platforms: row.platforms.join(", "),
            spend_usd: row.spend,
            leads: row.leads,
            interested_or_beyond: row.interested,
            quotation_or_beyond: row.quotations,
            won: row.won,
            sales_orders: row.salesOrders,
            paid_invoices: row.invoices,
            paid_revenue_usd: row.revenue,
            roas: row.roas ?? "",
            lead_to_won_pct: row.leadToWonRate ?? "",
          })}
        />
      </section>
    </div>
  );
}

function countCol<T>(
  key: string,
  header: string,
  pick: (row: T) => number,
  group: string,
  hideByDefault = false,
): Col<T> {
  return {
    key,
    header,
    render: (row) => fmtNum(pick(row)),
    sortValue: pick,
    align: "right",
    group,
    hideByDefault,
  };
}
