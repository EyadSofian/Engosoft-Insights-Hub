import { createFileRoute } from "@tanstack/react-router";
import { Users, Target, Percent, Radio } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card, ErrorState, KpiCard, Pill, SectionTitle, Skeleton, BarList } from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { DonutChart, HBarChart } from "@/components/charts";
import { fmtDate, fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { CrmLeadRow, Grouped } from "@/lib/types";

export const Route = createFileRoute("/leads")({ component: LeadsPage });

interface Resp {
  total: number;
  won: number;
  winRate: number;
  byStage: Grouped[];
  bySource: Grouped[];
  byCourse: Grouped[];
  byTeam: Grouped[];
  bySalesperson: Grouped[];
  rows: CrmLeadRow[];
  truncated: boolean;
}

const stageTone = (stage: string): "success" | "danger" | "warning" | "brand" | "neutral" => {
  const s = stage.trim().toLowerCase();
  if (s === "won") return "success";
  if (s === "lost" || s === "wrong number") return "danger";
  if (s === "interested" || s === "quotation") return "brand";
  if (s === "new" || s === "save interest") return "warning";
  return "neutral";
};

function LeadsPage() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/leads");

  const cols: Col<CrmLeadRow>[] = [
    {
      key: "createdAt",
      header: t("created"),
      sticky: true,
      width: "120px",
      render: (r) => <span className="num">{fmtDate(r.createdAt, lang)}</span>,
      sortValue: (r) => r.createdAt,
    },
    { key: "contact", header: t("contact"), render: (r) => <span className="block truncate max-w-[160px]" title={r.contact}>{r.contact || "—"}</span>, sortValue: (r) => r.contact },
    { key: "campaignName", header: t("campaign"), render: (r) => <span className="block truncate max-w-[160px] text-text-muted" title={r.campaignName}>{r.campaignName || "—"}</span>, sortValue: (r) => r.campaignName },
    { key: "cleanedSource", header: t("source"), render: (r) => r.cleanedSource || r.source || "—", sortValue: (r) => r.cleanedSource || r.source },
    { key: "course", header: t("course"), render: (r) => r.course || "—", sortValue: (r) => r.course },
    { key: "mainCategory", header: t("main_category"), render: (r) => <span className="text-text-muted">{r.mainCategory || "—"}</span>, sortValue: (r) => r.mainCategory },
    { key: "salesTeam", header: t("sales_team"), render: (r) => r.salesTeam || "—", sortValue: (r) => r.salesTeam },
    { key: "salesperson", header: t("salesperson"), render: (r) => <span className="block truncate max-w-[140px]" title={r.salesperson}>{r.salesperson || "—"}</span>, sortValue: (r) => r.salesperson },
    {
      key: "cleanedStage",
      header: t("stage"),
      render: (r) => (r.cleanedStage ? <Pill tone={stageTone(r.cleanedStage)}>{r.cleanedStage}</Pill> : "—"),
      sortValue: (r) => r.cleanedStage,
    },
    { key: "priority", header: t("priority"), render: (r) => r.priority || "—", sortValue: (r) => r.priority },
    { key: "orderTotal", header: t("order_total"), align: "right", render: (r) => fmtNum(r.orderTotal), sortValue: (r) => r.orderTotal },
  ];

  return (
    <AppShell title={t("leads")}>
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
            <KpiCard index={0} label={t("crm_leads")} value={fmtNum(data.total)} icon={<Users size={14} />} />
            <KpiCard index={1} label={t("won")} value={fmtNum(data.won)} icon={<Target size={14} />} />
            <KpiCard index={2} hero label={t("win_rate")} value={fmtPct(data.winRate, 1)} icon={<Percent size={14} />} />
            <KpiCard index={3} label={t("by_source")} value={fmtNum(data.bySource.length)} icon={<Radio size={14} />} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <SectionTitle
                hint={
                  lang === "ar"
                    ? "توزيع العملاء على مراحل الـ CRM."
                    : "How leads distribute across CRM stages."
                }
              >
                {t("by_stage")}
              </SectionTitle>
              <BarList
                items={data.byStage.map((s) => ({
                  label: s.label,
                  value: s.value,
                  meta: (
                    <span className="flex items-center gap-2">
                      <span className="num text-text-muted text-[11px]">
                        {fmtPct((s.value / Math.max(data.total, 1)) * 100, 1)}
                      </span>
                      <span className="num">{fmtNum(s.value)}</span>
                    </span>
                  ),
                }))}
                format={fmtNum}
              />
            </Card>

            <Card>
              <SectionTitle>{t("by_source")}</SectionTitle>
              <DonutChart
                data={data.bySource.map((d) => ({ label: d.label, value: d.value }))}
                format={fmtNum}
              />
            </Card>

            <Card>
              <SectionTitle>{t("by_course")}</SectionTitle>
              <HBarChart
                data={data.byCourse.slice(0, 10).map((d) => ({ label: d.label, value: d.value }))}
                color="var(--chart-3)"
                format={fmtNum}
              />
            </Card>

            <Card>
              <SectionTitle>{t("by_team")}</SectionTitle>
              <HBarChart
                data={data.byTeam.slice(0, 10).map((d) => ({ label: d.label, value: d.value }))}
                color="var(--chart-4)"
                format={fmtNum}
              />
            </Card>
          </div>

          <DataTable
            rows={data.rows}
            cols={cols}
            searchable={(r) => `${r.contact} ${r.campaignName} ${r.course} ${r.salesperson} ${r.cleanedStage}`}
            initialSort={{ key: "createdAt", dir: -1 }}
            csvFilename="engosoft-leads"
            truncatedNote={
              data.truncated
                ? lang === "ar"
                  ? "معروض أول ٣٠٠٠ صف فقط. ضيّق الفترة لعرض تفاصيل أدق."
                  : "Showing the first 3,000 rows. Narrow the period for full detail."
                : undefined
            }
            csvRow={(r) => ({
              created: r.createdAt,
              contact: r.contact,
              campaign: r.campaignName,
              ad: r.adName,
              source: r.cleanedSource || r.source,
              course: r.course,
              category: r.mainCategory,
              sales_team: r.salesTeam,
              salesperson: r.salesperson,
              stage: r.cleanedStage,
              priority: r.priority,
              order_total: r.orderTotal,
            })}
          />
        </div>
      )}
    </AppShell>
  );
}
