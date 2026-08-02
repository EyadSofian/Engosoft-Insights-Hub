import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeDollarSign,
  FileCheck2,
  FileText,
  HeartHandshake,
  Info,
  Megaphone,
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
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { fmtNum, fmtPct, fmtRoas, fmtUSDFull, useI18n } from "@/lib/i18n";
import type { Platform } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export const Route = createFileRoute("/sales")({ component: SalesReport });

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

function rate(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : null;
}

function SalesReport() {
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
    <div className="space-y-5">
      <PageHeader
        title={ar ? "تقرير المبيعات والفانل" : "Sales funnel report"}
        subtitle={
          ar
            ? "من دخول الليد إلى الاهتمام والكوتيشن والبيع، ثم ربط النتيجة بالمصدر والحملة والفاتورة المدفوعة."
            : "From lead entry to interest, quotation and sale, tied back to source, campaign and paid invoice."
        }
      />
      <FilterSummary />

      <Notice tone="info" icon={<Info size={16} />}>
        {ar
          ? "مهتم وكوتيشن مبنيان على المرحلة الحالية في CRM أو مرحلة أبعد منها؛ أودو لا يوفّر هنا تاريخ كل انتقال سابق. أوامر البيع من Full Invoiced Orders، والفواتير والإيراد من فواتير الحسابات المدفوعة، لذلك عدد الفواتير لا يلزم أن يساوي Won واحدًا مقابل واحد."
          : "Interested and quotation use the current CRM stage or a clearly later stage; this dataset has no complete stage-transition history. Sales orders come from Full Invoiced Orders, while invoices and revenue come from paid Accounting invoices, so counts are not required to match Won one-for-one."}
      </Notice>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiCard
          index={0}
          label={ar ? "الليدز الداخلة" : "Leads entered"}
          value={fmtNum(data.funnel.leads)}
          icon={<Users size={16} />}
        />
        <KpiCard
          index={1}
          label={ar ? "مهتم أو أبعد" : "Interested+"}
          value={fmtNum(data.funnel.interested)}
          sub={fmtPct(rate(data.funnel.interested, data.funnel.leads), 1)}
          icon={<HeartHandshake size={16} />}
        />
        <KpiCard
          index={2}
          label={ar ? "كوتيشن أو أبعد" : "Quotation+"}
          value={fmtNum(data.funnel.quotations)}
          sub={fmtPct(rate(data.funnel.quotations, data.funnel.leads), 1)}
          icon={<FileText size={16} />}
        />
        <KpiCard
          index={3}
          label="Won"
          value={fmtNum(data.funnel.won)}
          sub={fmtPct(rate(data.funnel.won, data.funnel.leads), 1)}
          icon={<Trophy size={16} />}
        />
        <KpiCard
          index={4}
          label={ar ? "أوامر بيع" : "Sales orders"}
          value={fmtNum(data.funnel.salesOrders)}
          sub={ar ? "مفوترة بالكامل" : "Fully invoiced"}
          icon={<ShoppingCart size={16} />}
        />
        <KpiCard
          index={5}
          label={ar ? "فواتير مدفوعة" : "Paid invoices"}
          value={fmtNum(data.funnel.invoices)}
          sub={ar ? "مستندات محاسبية مميزة" : "Distinct accounting documents"}
          icon={<ReceiptText size={16} />}
        />
        <KpiCard
          index={6}
          label={ar ? "الإيراد المحصّل" : "Paid revenue"}
          value={fmtUSDFull(data.totals.revenue)}
          sub={`${ar ? "متوسط الفاتورة" : "Avg. invoice"}: ${fmtUSDFull(data.totals.averageInvoice)}`}
          hero
          icon={<BadgeDollarSign size={16} />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
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

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <InsightCard
            icon={<FileCheck2 size={17} />}
            title={ar ? "أفضل مصدر بيعًا" : "Best-selling source"}
            row={data.insights.bestSellingSource}
            ar={ar}
          />
          <InsightCard
            icon={<Megaphone size={17} />}
            title={ar ? "أفضل حملة بيعًا" : "Best-selling campaign"}
            row={data.insights.bestSellingCampaign}
            ar={ar}
          />
          <InsightCard
            icon={<Trophy size={17} />}
            title={ar ? "أفضل مصدر تحويلاً" : "Best-converting source"}
            row={data.insights.bestConvertingSource}
            ar={ar}
            conversion
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

function InsightCard({
  title,
  row,
  icon,
  ar,
  conversion = false,
}: {
  title: string;
  row: SalesAttributionRow | SalesCampaignRow | null;
  icon: React.ReactNode;
  ar: boolean;
  conversion?: boolean;
}) {
  return (
    <Card className="min-h-0" hoverable>
      <div className="flex items-center gap-2 text-text-muted">
        {icon}
        <span className="text-xs font-medium">{title}</span>
      </div>
      {row ? (
        <div className="mt-2.5">
          <div className="flex items-start justify-between gap-2">
            <strong className="min-w-0 truncate text-[15px] text-text" title={row.name}>
              {row.name}
            </strong>
            <Pill tone="success">
              {conversion ? fmtPct(row.leadToWonRate, 1) : fmtUSDFull(row.revenue)}
            </Pill>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
            {fmtNum(row.leads)} {ar ? "ليد" : "leads"} · {fmtNum(row.won)} Won ·{" "}
            {fmtNum(row.invoices)} {ar ? "فاتورة" : "invoices"}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-text-muted">
          {ar ? "لا توجد بيانات منسوبة" : "No attributed data"}
        </p>
      )}
    </Card>
  );
}
