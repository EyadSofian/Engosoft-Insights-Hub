import { createFileRoute } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { BarList, Card, ErrorState, KpiCard, Notice, PageHeader, SectionTitle, Skeleton } from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { SpendRevenueChart } from "@/components/charts";
import type { DataHealth, Grouped, Totals } from "@/lib/types";

export const Route = createFileRoute("/sales")({ component: Sales });

interface SaleRow {
  paymentDate: string;
  invoiceDate: string;
  orderRef: string;
  partner: string;
  course: string;
  category: string;
  salesperson: string;
  teamLeader: string;
  salesTeam: string;
  eventStage: string;
  usdSales: number;
}

interface Resp {
  totals: Totals;
  salesTotal: number;
  salesRows: number;
  salesOrders: number;
  invoicedTotal: number;
  byCourse: Grouped[];
  byCategory: Grouped[];
  byTeam: Grouped[];
  byTeamLeader: Grouped[];
  bySalesperson: Grouped[];
  byMonth: Grouped[];
  byDay: { date: string; revenue: number }[];
  detail: { rows: SaleRow[]; total: number; truncated: boolean };
  health: DataHealth;
}

function Sales() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/sales");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const cols: Col<SaleRow>[] = [
    { key: "paymentDate", header: lang === "ar" ? "تاريخ الدفع" : "Payment date", sticky: true, width: "120px", sortValue: (r) => r.paymentDate, render: (r) => fmtDate(r.paymentDate, lang) },
    { key: "orderRef", header: t("order_ref"), sortValue: (r) => r.orderRef, render: (r) => r.orderRef || "—" },
    { key: "partner", header: t("partner"), sortValue: (r) => r.partner, render: (r) => <span className="truncate block max-w-[180px]" title={r.partner}>{r.partner || "—"}</span> },
    { key: "course", header: t("course"), sortValue: (r) => r.course, render: (r) => r.course || "—" },
    { key: "salesperson", header: t("salesperson"), sortValue: (r) => r.salesperson, render: (r) => <span className="truncate block max-w-[150px]" title={r.salesperson}>{r.salesperson || "—"}</span> },
    { key: "salesTeam", header: t("sales_team"), sortValue: (r) => r.salesTeam, render: (r) => <span className="truncate block max-w-[160px]" title={r.salesTeam}>{r.salesTeam || "—"}</span> },
    { key: "usdSales", header: t("revenue"), align: "right", sortValue: (r) => r.usdSales, render: (r) => fmtUSDFull(r.usdSales) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t("sales")} />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          <Notice tone="info" title={t("data_notes")} icon={<Info size={16} />}>
            {lang === "ar"
              ? `تبويب «المبيعات» يسجّل بنود الدفع (${fmtUSD(data.salesTotal)} على ${fmtNum(data.salesRows)} صف) بينما تبويب الفواتير يسجّل بنود الطلب (${fmtUSD(data.invoicedTotal)}). الرقمان يصفان مالاً متقارباً لا متطابقاً، ولذلك يُعرضان منفصلين.`
              : `The Sales tab records payment lines (${fmtUSD(data.salesTotal)} across ${fmtNum(data.salesRows)} rows) while Full Invoiced records order lines (${fmtUSD(data.invoicedTotal)}). They describe overlapping-but-different money, so both are shown rather than blended.`}
          </Notice>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard index={0} label={t("revenue")} value={fmtUSD(data.salesTotal)} hero sub={lang === "ar" ? "من تبويب المبيعات" : "from the Sales tab"} />
            <KpiCard index={1} label={t("orders")} value={fmtNum(data.salesOrders)} />
            <KpiCard index={2} label={t("aov")} value={fmtUSD(data.salesOrders > 0 ? data.salesTotal / data.salesOrders : null)} />
            <KpiCard index={3} label={t("full_invoiced")} value={fmtUSD(data.invoicedTotal)} sub={lang === "ar" ? "من تبويب الفواتير" : "from Full Invoiced"} />
          </div>

          <Card>
            <SectionTitle>{t("by_day")}</SectionTitle>
            <SpendRevenueChart data={data.byDay.map((d) => ({ date: d.date, spend: 0, revenue: d.revenue }))} />
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Money title={t("by_course")} rows={data.byCourse} />
            <Money title={t("by_category")} rows={data.byCategory} />
            <Money title={t("by_team")} rows={data.byTeam} />
            <Money title={t("by_salesperson")} rows={data.bySalesperson} />
            <Money title={lang === "ar" ? "حسب قائد الفريق" : "By team leader"} rows={data.byTeamLeader} />
            <Money title={t("by_month")} rows={data.byMonth} sorted />
          </div>

          <DataTable
            rows={data.detail.rows}
            cols={cols}
            searchable={(r) => `${r.orderRef} ${r.partner} ${r.course} ${r.salesperson} ${r.salesTeam}`}
            initialSort={{ key: "paymentDate", dir: -1 }}
            csvFilename="engosoft-sales"
            maxHeight={620}
            truncatedNote={
              data.detail.truncated
                ? lang === "ar"
                  ? `معروض ${fmtNum(data.detail.rows.length)} من ${fmtNum(data.detail.total)} صف.`
                  : `Showing ${fmtNum(data.detail.rows.length)} of ${fmtNum(data.detail.total)} rows.`
                : undefined
            }
            csvRow={(r) => ({
              payment_date: r.paymentDate,
              invoice_date: r.invoiceDate,
              order_ref: r.orderRef,
              partner: r.partner,
              course: r.course,
              category: r.category,
              salesperson: r.salesperson,
              team_leader: r.teamLeader,
              sales_team: r.salesTeam,
              event_stage: r.eventStage,
              usd_sales: r.usdSales.toFixed(2),
            })}
          />
        </>
      )}
    </div>
  );
}

function Money({ title, rows, sorted }: { title: string; rows: Grouped[]; sorted?: boolean }) {
  const items = (sorted ? rows : [...rows].sort((a, b) => b.value - a.value)).slice(0, 8);
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <BarList
        items={items.map((g) => ({
          label: g.label,
          value: g.value,
          meta: (
            <span>
              <span className="num">{fmtUSD(g.value)}</span>
              <span className="num text-[11px] text-text-muted ms-1.5">({fmtPct(g.share, 1)})</span>
            </span>
          ),
        }))}
        format={fmtUSD}
        color="var(--chart-2)"
      />
    </Card>
  );
}
