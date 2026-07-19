import { createFileRoute } from "@tanstack/react-router";
import { DollarSign, Receipt, Package, CalendarDays } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card, ErrorState, KpiCard, SectionTitle, Skeleton } from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { HBarChart, VBarChart, DonutChart } from "@/components/charts";
import { fmtDate, fmtNum, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { Grouped, SalesRow } from "@/lib/types";

export const Route = createFileRoute("/sales")({ component: SalesPage });

interface Resp {
  total: number;
  count: number;
  avgOrder: number;
  byCourse: Grouped[];
  byCategory: Grouped[];
  byTeam: Grouped[];
  bySalesperson: Grouped[];
  byMonth: Grouped[];
  rows: SalesRow[];
  truncated: boolean;
}

function SalesPage() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/sales");

  const cols: Col<SalesRow>[] = [
    {
      key: "paymentDate",
      header: t("date"),
      sticky: true,
      width: "120px",
      render: (r) => <span className="num">{fmtDate(r.paymentDate, lang)}</span>,
      sortValue: (r) => r.paymentDate,
    },
    { key: "course", header: t("course"), render: (r) => r.course || "—", sortValue: (r) => r.course },
    { key: "category", header: t("category"), render: (r) => <span className="text-text-muted">{r.category || "—"}</span>, sortValue: (r) => r.category },
    { key: "partner", header: t("partner"), render: (r) => r.partner || "—", sortValue: (r) => r.partner },
    { key: "salesperson", header: t("salesperson"), render: (r) => r.salesperson || "—", sortValue: (r) => r.salesperson },
    { key: "salesTeam", header: t("sales_team"), render: (r) => <span className="text-text-muted">{r.salesTeam || "—"}</span>, sortValue: (r) => r.salesTeam },
    { key: "usdSales", header: t("revenue"), align: "right", render: (r) => fmtUSDFull(r.usdSales), sortValue: (r) => r.usdSales },
  ];

  const topMonth = data?.byMonth.length
    ? [...data.byMonth].sort((a, b) => b.value - a.value)[0]
    : null;

  return (
    <AppShell title={t("sales")}>
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
            <KpiCard index={1} label={t("orders")} value={fmtNum(data.count)} icon={<Receipt size={14} />} />
            <KpiCard index={2} label={t("avg_order")} value={fmtUSD(data.avgOrder)} icon={<Package size={14} />} />
            <KpiCard
              index={3}
              label={t("by_month")}
              value={topMonth?.label ?? "—"}
              sub={topMonth ? fmtUSD(topMonth.value) : undefined}
              icon={<CalendarDays size={14} />}
            />
          </div>

          <Card>
            <SectionTitle
              hint={lang === "ar" ? "الإيراد المُحصّل حسب تاريخ الدفع." : "Revenue collected, by payment date."}
            >
              {t("by_month")}
            </SectionTitle>
            <VBarChart
              data={data.byMonth.map((m) => ({ label: m.label, value: m.value }))}
              color="var(--chart-2)"
            />
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <SectionTitle>{t("by_course")}</SectionTitle>
              <HBarChart data={data.byCourse.slice(0, 10).map((d) => ({ label: d.label, value: d.value }))} />
            </Card>
            <Card>
              <SectionTitle>{t("by_salesperson")}</SectionTitle>
              <HBarChart
                data={data.bySalesperson.slice(0, 10).map((d) => ({ label: d.label, value: d.value }))}
                color="var(--chart-4)"
              />
            </Card>
            <Card>
              <SectionTitle>{t("by_team")}</SectionTitle>
              <DonutChart data={data.byTeam.map((d) => ({ label: d.label, value: d.value }))} format={fmtUSD} />
            </Card>
            <Card>
              <SectionTitle>{t("by_category")}</SectionTitle>
              <HBarChart
                data={data.byCategory.slice(0, 10).map((d) => ({ label: d.label, value: d.value }))}
                color="var(--chart-3)"
              />
            </Card>
          </div>

          <DataTable
            rows={data.rows}
            cols={cols}
            searchable={(r) => `${r.course} ${r.salesperson} ${r.partner} ${r.salesTeam}`}
            initialSort={{ key: "paymentDate", dir: -1 }}
            csvFilename="engosoft-sales"
            truncatedNote={
              data.truncated
                ? lang === "ar"
                  ? "معروض أول ٣٠٠٠ صف فقط. ضيّق الفترة لعرض تفاصيل أدق."
                  : "Showing the first 3,000 rows. Narrow the period for full detail."
                : undefined
            }
            csvRow={(r) => ({
              payment_date: r.paymentDate,
              invoice_date: r.invoiceDate,
              course: r.course,
              category: r.category,
              partner: r.partner,
              salesperson: r.salesperson,
              team_leader: r.teamLeader,
              sales_team: r.salesTeam,
              usd_sales: r.usdSales.toFixed(2),
            })}
          />
        </div>
      )}
    </AppShell>
  );
}
