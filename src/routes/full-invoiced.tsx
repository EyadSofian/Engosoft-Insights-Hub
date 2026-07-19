import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DollarSign, Receipt, Package, GraduationCap } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  BarList,
  Card,
  ErrorState,
  KpiCard,
  SectionTitle,
  Segmented,
  Skeleton,
} from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { DonutChart, HBarChart } from "@/components/charts";
import { fmtDate, fmtNum, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { Grouped, InvoicedRow } from "@/lib/types";

export const Route = createFileRoute("/full-invoiced")({ component: FullInvoicedPage });

interface Resp {
  total: number;
  count: number;
  orders: number;
  avgOrder: number;
  byCourse: Grouped[];
  byCategory: Grouped[];
  byTeam: Grouped[];
  byCampaign: Grouped[];
  bySource: Grouped[];
  rows: InvoicedRow[];
  truncated: boolean;
  missingDate: number;
}

type GroupBy = "campaign" | "course" | "team";

function FullInvoicedPage() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/full-invoiced");
  const [groupBy, setGroupBy] = useState<GroupBy>("campaign");

  const cols: Col<InvoicedRow>[] = [
    {
      key: "orderRef",
      header: t("order_ref"),
      sticky: true,
      width: "130px",
      render: (r) => (
        <span className="block truncate max-w-[130px]" title={r.orderRef}>
          {r.orderRef || "—"}
        </span>
      ),
      sortValue: (r) => r.orderRef,
    },
    {
      key: "revenueDate",
      header: t("date"),
      render: (r) => <span className="num">{fmtDate(r.revenueDate, lang)}</span>,
      sortValue: (r) => r.revenueDate,
    },
    { key: "customer", header: t("customer"), render: (r) => <span className="block truncate max-w-[160px]" title={r.customer}>{r.customer || "—"}</span>, sortValue: (r) => r.customer },
    { key: "product", header: t("product"), render: (r) => <span className="block truncate max-w-[180px]" title={r.product}>{r.product || "—"}</span>, sortValue: (r) => r.product },
    { key: "campaignName", header: t("campaign"), render: (r) => <span className="block truncate max-w-[160px] text-text-muted" title={r.campaignName}>{r.campaignName || "—"}</span>, sortValue: (r) => r.campaignName },
    { key: "adName", header: t("ad_name"), render: (r) => <span className="block truncate max-w-[140px] text-text-muted" title={r.adName}>{r.adName || "—"}</span>, sortValue: (r) => r.adName },
    { key: "course", header: t("course"), render: (r) => r.course || "—", sortValue: (r) => r.course },
    { key: "mainCategory", header: t("main_category"), render: (r) => <span className="text-text-muted">{r.mainCategory || "—"}</span>, sortValue: (r) => r.mainCategory },
    { key: "salesTeam", header: t("sales_team"), render: (r) => r.salesTeam || "—", sortValue: (r) => r.salesTeam },
    { key: "source", header: t("source"), render: (r) => r.cleanedSource || r.source || "—", sortValue: (r) => r.cleanedSource || r.source },
    { key: "localTotal", header: t("order_total"), align: "right", render: (r) => fmtNum(r.localTotal), sortValue: (r) => r.localTotal },
    { key: "usdSales", header: t("revenue"), align: "right", render: (r) => fmtUSDFull(r.usdSales), sortValue: (r) => r.usdSales },
  ];

  const grouped: Grouped[] =
    groupBy === "campaign" ? (data?.byCampaign ?? [])
    : groupBy === "course" ? (data?.byCourse ?? [])
    : (data?.byTeam ?? []);

  return (
    <AppShell title={t("full_invoiced")}>
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-[104px]" />
          <Skeleton className="h-[280px]" />
          <Skeleton className="h-[400px]" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard index={0} hero label={t("revenue")} value={fmtUSD(data.total)} icon={<DollarSign size={14} />} />
            <KpiCard index={1} label={t("orders")} value={fmtNum(data.orders)} sub={`${fmtNum(data.count)} ${t("rows")}`} icon={<Receipt size={14} />} />
            <KpiCard index={2} label={t("avg_order")} value={fmtUSD(data.avgOrder)} icon={<Package size={14} />} />
            <KpiCard
              index={3}
              label={t("course")}
              value={data.byCourse[0]?.label ?? "—"}
              sub={data.byCourse[0] ? fmtUSD(data.byCourse[0].value) : undefined}
              icon={<GraduationCap size={14} />}
            />
          </div>

          <Card>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "إجمالي الإيراد مع عدد الأسطر في كل مجموعة."
                  : "Revenue subtotals with the line count in each group."
              }
              action={
                <Segmented
                  value={groupBy}
                  onChange={setGroupBy}
                  options={[
                    { value: "campaign", label: t("campaign") },
                    { value: "course", label: t("course") },
                    { value: "team", label: t("team") },
                  ]}
                />
              }
            >
              {t("by_campaign")}
            </SectionTitle>
            <BarList
              items={grouped.slice(0, 12).map((g) => ({
                label: g.label,
                value: g.value,
                meta: (
                  <span className="flex items-center gap-2">
                    <span className="num text-text-muted text-[11px]">
                      {fmtNum(g.count)} {t("rows")}
                    </span>
                    <span className="num">{fmtUSD(g.value)}</span>
                  </span>
                ),
              }))}
              format={fmtUSD}
              color="var(--chart-2)"
            />
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <SectionTitle>{t("by_category")}</SectionTitle>
              <HBarChart data={data.byCategory.slice(0, 10).map((d) => ({ label: d.label, value: d.value }))} />
            </Card>
            <Card>
              <SectionTitle>{t("by_source")}</SectionTitle>
              <DonutChart data={data.bySource.map((d) => ({ label: d.label, value: d.value }))} format={fmtUSD} />
            </Card>
          </div>

          <DataTable
            rows={data.rows}
            cols={cols}
            searchable={(r) => `${r.orderRef} ${r.customer} ${r.product} ${r.campaignName} ${r.course}`}
            initialSort={{ key: "revenueDate", dir: -1 }}
            csvFilename="engosoft-full-invoiced"
            truncatedNote={
              data.truncated
                ? lang === "ar"
                  ? "معروض أول ٣٠٠٠ صف فقط. ضيّق الفترة لعرض تفاصيل أدق."
                  : "Showing the first 3,000 rows. Narrow the period for full detail."
                : undefined
            }
            csvRow={(r) => ({
              order_ref: r.orderRef,
              date: r.revenueDate,
              invoice_date: r.invoiceDate,
              customer: r.customer,
              product: r.product,
              campaign: r.campaignName,
              ad_name: r.adName,
              course: r.course,
              main_category: r.mainCategory,
              sales_team: r.salesTeam,
              source: r.cleanedSource || r.source,
              local_total: r.localTotal.toFixed(2),
              usd_sales: r.usdSales.toFixed(2),
            })}
          />
        </div>
      )}
    </AppShell>
  );
}
