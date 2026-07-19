import { createFileRoute } from "@tanstack/react-router";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { BarList, Card, ErrorState, KpiCard, PageHeader, SectionTitle, Skeleton } from "@/components/ui-bits";
import { AdSetOriginBadge } from "@/components/metric-bits";
import { DataTable, type Col } from "@/components/DataTable";
import type { AdSetOrigin, DataHealth, Grouped, Totals } from "@/lib/types";

export const Route = createFileRoute("/full-invoiced")({ component: FullInvoiced });

interface InvRow {
  orderRef: string;
  revenueDate: string;
  invoiceDate: string;
  customer: string;
  product: string;
  course: string;
  campaign: string;
  adName: string;
  adset: string;
  adsetOrigin: AdSetOrigin;
  salesperson: string;
  salesTeam: string;
  source: string;
  usdSales: number;
}

interface Resp {
  totals: Totals;
  byCampaign: Grouped[];
  byCourse: Grouped[];
  byTeam: Grouped[];
  bySalesperson: Grouped[];
  bySource: Grouped[];
  byMonth: Grouped[];
  attribution: {
    withCampaign: { rows: number; revenue: number };
    withoutCampaign: { rows: number; revenue: number };
  };
  detail: { rows: InvRow[]; total: number; truncated: boolean };
  health: DataHealth;
}

function FullInvoiced() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/full-invoiced");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const cols: Col<InvRow>[] = [
    { key: "orderRef", header: t("order_ref"), sticky: true, width: "110px", sortValue: (r) => r.orderRef, render: (r) => r.orderRef || "—" },
    { key: "revenueDate", header: t("date"), sortValue: (r) => r.revenueDate, render: (r) => fmtDate(r.revenueDate, lang) },
    { key: "customer", header: t("customer"), sortValue: (r) => r.customer, render: (r) => <span className="truncate block max-w-[180px]" title={r.customer}>{r.customer || "—"}</span> },
    { key: "product", header: t("product"), sortValue: (r) => r.product, render: (r) => <span className="truncate block max-w-[200px]" title={r.product}>{r.product || "—"}</span> },
    { key: "course", header: t("course"), sortValue: (r) => r.course, render: (r) => r.course || "—" },
    { key: "campaign", header: t("campaign"), sortValue: (r) => r.campaign, render: (r) => <span className="truncate block max-w-[170px]" title={r.campaign}>{r.campaign || <span className="text-text-subtle">—</span>}</span> },
    {
      key: "adset",
      header: t("ad_set"),
      sortValue: (r) => r.adset,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span className="truncate max-w-[130px]" title={r.adset}>{r.adset || "—"}</span>
          <AdSetOriginBadge origin={r.adsetOrigin} />
        </span>
      ),
    },
    { key: "salesperson", header: t("salesperson"), sortValue: (r) => r.salesperson, render: (r) => <span className="truncate block max-w-[150px]" title={r.salesperson}>{r.salesperson || "—"}</span> },
    {
      key: "usdSales",
      header: t("revenue"),
      align: "right",
      sortValue: (r) => r.usdSales,
      // Negative lines are refunds and credit notes — real money, kept visible.
      render: (r) => <span style={r.usdSales < 0 ? { color: "var(--danger)" } : undefined}>{fmtUSDFull(r.usdSales)}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("full_invoiced")}
        subtitle={
          lang === "ar"
            ? "تفاصيل الطلبات المُفوترة، مؤرَّخة بتاريخ الطلب."
            : "Invoiced order lines, dated by order date."
        }
      />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard index={0} label={t("revenue")} value={fmtUSD(data.totals.revenue)} hero />
            <KpiCard index={1} label={t("orders")} value={fmtNum(data.totals.orders)} />
            <KpiCard index={2} label={t("aov")} value={fmtUSD(data.totals.avgOrder)} />
            <KpiCard index={3} label={t("attributed_revenue")} value={fmtUSD(data.totals.attributedRevenue)} sub={t("attributed_note")} />
          </div>

          <Card>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "الجزء غير المرتبط بحملة يظل معروضاً بدل حذفه، حتى لا يبدو الإيراد أصغر مما هو."
                  : "The unattributed side stays visible rather than being dropped, so revenue never reads smaller than it is."
              }
            >
              {t("revenue_coverage")}
            </SectionTitle>
            <div className="grid sm:grid-cols-2 gap-4">
              {(
                [
                  { key: "with", label: t("from_campaigns"), v: data.attribution.withCampaign, tone: "var(--success)" },
                  { key: "without", label: t("other_sources"), v: data.attribution.withoutCampaign, tone: "var(--text-subtle)" },
                ] as const
              ).map((b) => (
                <div key={b.key} className="rounded-xl border border-border p-4">
                  <div className="text-sm font-semibold mb-2">{b.label}</div>
                  <div className="num text-2xl font-semibold" style={{ color: b.tone }}>
                    {fmtUSD(b.v.revenue)}
                  </div>
                  <div className="text-[12px] text-text-muted mt-1">
                    {fmtNum(b.v.rows)} {lang === "ar" ? "صف" : "rows"} ·{" "}
                    {fmtPct(
                      data.totals.revenue !== 0 ? (b.v.revenue / data.totals.revenue) * 100 : null,
                      1,
                    )}{" "}
                    {lang === "ar" ? "من الإيراد" : "of revenue"}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Money title={t("by_course")} rows={data.byCourse} />
            <Money title={t("by_campaign")} rows={data.byCampaign} />
            <Money title={t("by_salesperson")} rows={data.bySalesperson} />
            <Money title={t("by_source")} rows={data.bySource} />
            <Money title={t("by_month")} rows={data.byMonth} sorted />
            <Money title={t("by_team")} rows={data.byTeam} />
          </div>

          <DataTable
            rows={data.detail.rows}
            cols={cols}
            searchable={(r) => `${r.orderRef} ${r.customer} ${r.product} ${r.course} ${r.campaign} ${r.salesperson}`}
            initialSort={{ key: "revenueDate", dir: -1 }}
            csvFilename="engosoft-invoiced"
            maxHeight={620}
            truncatedNote={
              data.detail.truncated
                ? lang === "ar"
                  ? `معروض ${fmtNum(data.detail.rows.length)} من ${fmtNum(data.detail.total)} صف.`
                  : `Showing ${fmtNum(data.detail.rows.length)} of ${fmtNum(data.detail.total)} rows.`
                : undefined
            }
            csvRow={(r) => ({
              order_ref: r.orderRef,
              date: r.revenueDate,
              invoice_date: r.invoiceDate,
              customer: r.customer,
              product: r.product,
              course: r.course,
              campaign: r.campaign,
              ad_name: r.adName,
              ad_set: r.adset,
              ad_set_origin: r.adsetOrigin,
              salesperson: r.salesperson,
              sales_team: r.salesTeam,
              source: r.source,
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
