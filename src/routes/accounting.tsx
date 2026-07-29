import { createFileRoute } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { SpendRevenueChart } from "@/components/charts";
import {
  CourseRevenueExplorer,
  type AccountingCourses,
} from "@/components/accounting/CourseRevenueExplorer";
import { DataTable, type Col } from "@/components/DataTable";
import {
  BarList,
  Card,
  ErrorState,
  KpiCard,
  Notice,
  PageHeader,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { fmtDate, fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useFilters } from "@/lib/filter-store";
import type { DataHealth, Grouped, Totals } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export const Route = createFileRoute("/accounting")({ component: Accounting });

interface AccountingDetail {
  id: string;
  movement: string;
  paymentDate: string;
  invoiceDate: string;
  orderRef: string;
  partner: string;
  country: string;
  company: string;
  salesperson: string;
  salesTeam: string;
  code: string;
  productCode: string;
  quantity: number;
  product: string;
  productCategory: string;
  mainCategory: string;
  untaxedTotal: number;
  totalInCurrency: number;
  currency: string;
  companyCurrency: string;
  usdPaid: number;
  website: string;
  event: string;
  eventStage: string;
  source: string;
}

interface AccountingResponse {
  totals: Totals;
  summary: {
    paidUsd: number;
    invoices: number;
    productLines: number;
    averageInvoice: number | null;
  };
  byProduct: Grouped[];
  byProductCategory: Grouped[];
  byMainCategory: Grouped[];
  byCompany: Grouped[];
  byCurrency: Grouped[];
  byTeam: Grouped[];
  bySalesperson: Grouped[];
  byMonth: Grouped[];
  byDay: { date: string; revenue: number }[];
  courses: AccountingCourses;
  detail: { rows: AccountingDetail[]; total: number; truncated: boolean };
  health: DataHealth;
  source: {
    tab: string;
    dateBasis: string;
    valueBasis: string;
    grain: string;
  };
}

function Accounting() {
  const { t, lang } = useI18n();
  const filters = useFilters();
  const { data, isLoading, error, refetch } = useApi<AccountingResponse>("/api/accounting");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const cols: Col<AccountingDetail>[] = [
    {
      key: "movement",
      header: t("movement"),
      sticky: true,
      width: "150px",
      sortValue: (row) => row.movement,
      render: (row) => row.movement || "—",
    },
    {
      key: "paymentDate",
      header: t("payment_date"),
      sortValue: (row) => row.paymentDate,
      render: (row) => fmtDate(row.paymentDate, lang),
    },
    {
      key: "invoiceDate",
      header: t("invoice_date"),
      sortValue: (row) => row.invoiceDate,
      render: (row) => fmtDate(row.invoiceDate, lang),
    },
    {
      key: "partner",
      header: t("partner"),
      sortValue: (row) => row.partner,
      render: (row) => (
        <span className="block max-w-[180px] truncate" title={row.partner}>
          {row.partner || "—"}
        </span>
      ),
    },
    {
      key: "productCode",
      header: lang === "ar" ? "كود المنتج" : "Product code",
      sortValue: (row) => row.productCode,
      render: (row) => row.productCode || "—",
    },
    {
      key: "product",
      header: t("product"),
      sortValue: (row) => row.product,
      render: (row) => (
        <span className="block max-w-[220px] truncate" title={row.product}>
          {row.product || "—"}
        </span>
      ),
    },
    {
      key: "productCategory",
      header: t("product_category"),
      sortValue: (row) => row.productCategory,
      render: (row) => row.productCategory || "—",
    },
    {
      key: "quantity",
      header: lang === "ar" ? "الكمية" : "Quantity",
      align: "right",
      sortValue: (row) => row.quantity,
      render: (row) => <span className="num">{fmtNum(row.quantity)}</span>,
    },
    {
      key: "mainCategory",
      header: t("main_category"),
      sortValue: (row) => row.mainCategory,
      render: (row) => row.mainCategory || "—",
    },
    {
      key: "company",
      header: t("company"),
      sortValue: (row) => row.company,
      render: (row) => row.company || "—",
    },
    {
      key: "salesperson",
      header: t("salesperson"),
      sortValue: (row) => row.salesperson,
      render: (row) => row.salesperson || "—",
    },
    {
      key: "salesTeam",
      header: t("sales_team"),
      sortValue: (row) => row.salesTeam,
      render: (row) => row.salesTeam || "—",
    },
    {
      key: "untaxedTotal",
      header: t("untaxed_total"),
      align: "right",
      sortValue: (row) => row.untaxedTotal,
      render: (row) => (
        <span className="num whitespace-nowrap">
          {row.untaxedTotal.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
          <span className="text-[11px] text-text-muted">{row.companyCurrency || "—"}</span>
        </span>
      ),
    },
    {
      key: "totalInCurrency",
      header: t("total_in_currency"),
      align: "right",
      sortValue: (row) => row.totalInCurrency,
      render: (row) => (
        <span className="num whitespace-nowrap">
          {row.totalInCurrency.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
          <span className="text-[11px] text-text-muted">{row.currency}</span>
        </span>
      ),
    },
    {
      key: "usdPaid",
      header: t("usd_paid"),
      align: "right",
      sortValue: (row) => row.usdPaid,
      render: (row) => (
        <span
          className="num font-medium"
          style={row.usdPaid < 0 ? { color: "var(--danger)" } : undefined}
        >
          {fmtUSDFull(row.usdPaid)}
        </span>
      ),
    },
  ];
  const detailCols = data?.courses.summary.quantityAvailable
    ? cols
    : cols.filter((column) => column.key !== "quantity");

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("accounting")}
        subtitle={
          lang === "ar"
            ? `الفواتير المدفوعة على مستوى بند المنتج، مؤرخة بتاريخ الدفع.${filters.from && filters.to ? ` ${filters.from} → ${filters.to}` : ""}`
            : `Paid invoices at product-line grain, reported by Payment Date.${filters.from && filters.to ? ` ${filters.from} → ${filters.to}` : ""}`
        }
      />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          <Notice tone="info" title={t("data_notes")} icon={<Info size={16} />}>
            {lang === "ar"
              ? "المصدر المالي المعتمد: الفواتير المدفوعة فقط من تحليل الفواتير، حسب Payment Date. الإيراد هو USD Paid المحسوب من Total in Currency، وعدد الفواتير مميز حسب Move؛ ولا تدخل أوامر البيع المؤكدة أو تبويب Full Invoiced Orders في حساب الإيراد."
              : "Accounting authority: paid invoices only from invoice analysis, by Payment Date. Revenue is USD Paid calculated from Total in Currency, and invoice count is distinct Move; confirmed sales orders and Full Invoiced Orders are not revenue inputs."}
          </Notice>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              index={0}
              label={t("revenue")}
              value={fmtUSD(data.summary.paidUsd)}
              sub={lang === "ar" ? "USD Paid حسب Payment Date" : "USD Paid by Payment Date"}
              hero
            />
            <KpiCard index={1} label={t("invoices")} value={fmtNum(data.summary.invoices)} />
            <KpiCard
              index={2}
              label={t("product_lines")}
              value={fmtNum(data.summary.productLines)}
            />
            <KpiCard
              index={3}
              label={t("avg_invoice")}
              value={fmtUSD(data.summary.averageInvoice)}
            />
          </div>

          <Card>
            <SectionTitle>{t("by_day")}</SectionTitle>
            <SpendRevenueChart
              data={data.byDay.map((point) => ({
                date: point.date,
                spend: 0,
                revenue: point.revenue,
              }))}
            />
          </Card>

          <CourseRevenueExplorer data={data.courses} />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Money title={t("main_category")} rows={data.byMainCategory} />
            <Money title={t("product_category")} rows={data.byProductCategory} />
            <Money title={t("product")} rows={data.byProduct} />
            <Money title={t("by_salesperson")} rows={data.bySalesperson} />
            <Money title={t("by_team")} rows={data.byTeam} />
            <Money title={t("company")} rows={data.byCompany} />
            <Money title={t("currency")} rows={data.byCurrency} />
          </div>

          <DataTable
            rows={data.detail.rows}
            cols={detailCols}
            searchable={(row) =>
              `${row.movement} ${row.orderRef} ${row.partner} ${row.product} ${row.productCategory} ${row.mainCategory} ${row.company} ${row.salesperson} ${row.salesTeam}`
            }
            initialSort={{ key: "paymentDate", dir: -1 }}
            csvFilename="engosoft-accounting"
            maxHeight={640}
            truncatedNote={
              data.detail.truncated
                ? `${t("showing")} ${fmtNum(data.detail.rows.length)} ${t("of")} ${fmtNum(data.detail.total)}`
                : undefined
            }
            csvRow={(row) => ({
              move: row.movement,
              payment_date: row.paymentDate,
              invoice_date: row.invoiceDate,
              sales_order: row.orderRef,
              partner: row.partner,
              country: row.country,
              company: row.company,
              salesperson: row.salesperson,
              sales_team: row.salesTeam,
              employee_code: row.code,
              product_code: row.productCode,
              product: row.product,
              product_category: row.productCategory,
              main_category: row.mainCategory,
              quantity: data.courses.summary.quantityAvailable ? row.quantity : "",
              untaxed_total: row.untaxedTotal,
              company_currency: row.companyCurrency,
              total_in_currency: row.totalInCurrency,
              currency: row.currency,
              usd_paid: row.usdPaid,
              website: row.website,
              event: row.event,
              event_stage: row.eventStage,
              source: row.source,
            })}
          />
        </>
      )}
    </div>
  );
}

function Money({ title, rows }: { title: string; rows: Grouped[] }) {
  const items = [...rows].sort((a, b) => b.value - a.value).slice(0, 8);
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <BarList
        items={items.map((row) => ({
          label: row.label,
          value: row.value,
          meta: (
            <span>
              <span className="num">{fmtUSD(row.value)}</span>
              <span className="num ms-1.5 text-[11px] text-text-muted">
                ({fmtPct(row.share, 1)})
              </span>
            </span>
          ),
        }))}
        format={fmtUSD}
        color="var(--chart-2)"
      />
    </Card>
  );
}
