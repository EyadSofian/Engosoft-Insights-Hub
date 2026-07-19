import { createFileRoute } from "@tanstack/react-router";
import { TrendingDown, ListX, Users2, Megaphone } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BarList, Card, ErrorState, KpiCard, SectionTitle, Skeleton } from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { DonutChart, HBarChart } from "@/components/charts";
import { fmtDate, fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { Grouped, LostRow } from "@/lib/types";

export const Route = createFileRoute("/lost")({ component: LostPage });

interface Resp {
  total: number;
  byReason: Grouped[];
  topReasonShare: number;
  byCampaign: Grouped[];
  byTeam: Grouped[];
  byCourse: Grouped[];
  bySource: Grouped[];
  rows: LostRow[];
  truncated: boolean;
}

function LostPage() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/lost");

  const cols: Col<LostRow>[] = [
    {
      key: "createdAt",
      header: t("created"),
      sticky: true,
      width: "120px",
      render: (r) => <span className="num">{fmtDate(r.createdAt, lang)}</span>,
      sortValue: (r) => r.createdAt,
    },
    {
      key: "lossReason",
      header: t("loss_reason"),
      render: (r) => <span className="block truncate max-w-[200px]" title={r.lossReason}>{r.lossReason || "—"}</span>,
      sortValue: (r) => r.lossReason,
    },
    {
      key: "campaignName",
      header: t("campaign"),
      render: (r) => <span className="block truncate max-w-[180px] text-text-muted" title={r.campaignName}>{r.campaignName || "—"}</span>,
      sortValue: (r) => r.campaignName,
    },
    { key: "course", header: t("course"), render: (r) => r.course || "—", sortValue: (r) => r.course },
    { key: "mainCategory", header: t("main_category"), render: (r) => <span className="text-text-muted">{r.mainCategory || "—"}</span>, sortValue: (r) => r.mainCategory },
    { key: "salesTeam", header: t("sales_team"), render: (r) => r.salesTeam || "—", sortValue: (r) => r.salesTeam },
    { key: "cleanedSource", header: t("source"), render: (r) => r.cleanedSource || "—", sortValue: (r) => r.cleanedSource },
  ];

  const topReason = data?.byReason[0];

  return (
    <AppShell title={t("lost")}>
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
            <KpiCard index={0} label={t("total_lost")} value={fmtNum(data.total)} icon={<TrendingDown size={14} />} />
            <KpiCard
              index={1}
              label={t("loss_reason")}
              value={topReason?.label ?? "—"}
              sub={topReason ? `${fmtPct(data.topReasonShare, 1)} ${t("share")}` : undefined}
              icon={<ListX size={14} />}
            />
            <KpiCard index={2} label={t("by_team")} value={fmtNum(data.byTeam.length)} icon={<Users2 size={14} />} />
            <KpiCard index={3} label={t("by_campaign")} value={fmtNum(data.byCampaign.length)} icon={<Megaphone size={14} />} />
          </div>

          <Card>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "الأسباب مرتبة من الأكثر تكراراً، مع نسبتها من إجمالي الخسائر."
                  : "Reasons ranked by frequency, with their share of all losses."
              }
            >
              {t("loss_reason")}
            </SectionTitle>
            <BarList
              items={data.byReason.slice(0, 12).map((r) => ({
                label: r.label,
                value: r.value,
                meta: (
                  <span className="flex items-center gap-2">
                    <span className="num text-text-muted text-[11px]">
                      {fmtPct((r.value / Math.max(data.total, 1)) * 100, 1)}
                    </span>
                    <span className="num">{fmtNum(r.value)}</span>
                  </span>
                ),
              }))}
              format={fmtNum}
              color="var(--chart-5)"
            />
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <SectionTitle>{t("by_team")}</SectionTitle>
              <HBarChart
                data={data.byTeam.slice(0, 10).map((d) => ({ label: d.label, value: d.value }))}
                color="var(--chart-5)"
                format={fmtNum}
              />
            </Card>
            <Card>
              <SectionTitle>{t("by_source")}</SectionTitle>
              <DonutChart data={data.bySource.map((d) => ({ label: d.label, value: d.value }))} format={fmtNum} />
            </Card>
            <Card>
              <SectionTitle>{t("by_course")}</SectionTitle>
              <HBarChart
                data={data.byCourse.slice(0, 10).map((d) => ({ label: d.label, value: d.value }))}
                color="var(--chart-4)"
                format={fmtNum}
              />
            </Card>
            <Card>
              <SectionTitle>{t("by_campaign")}</SectionTitle>
              <HBarChart
                data={data.byCampaign.slice(0, 10).map((d) => ({ label: d.label, value: d.value }))}
                color="var(--chart-1)"
                format={fmtNum}
              />
            </Card>
          </div>

          <DataTable
            rows={data.rows}
            cols={cols}
            searchable={(r) => `${r.campaignName} ${r.lossReason} ${r.course} ${r.salesTeam}`}
            initialSort={{ key: "createdAt", dir: -1 }}
            csvFilename="engosoft-lost"
            truncatedNote={
              data.truncated
                ? lang === "ar"
                  ? "معروض أول ٣٠٠٠ صف فقط. ضيّق الفترة لعرض تفاصيل أدق."
                  : "Showing the first 3,000 rows. Narrow the period for full detail."
                : undefined
            }
            csvRow={(r) => ({
              created: r.createdAt,
              campaign: r.campaignName,
              loss_reason: r.lossReason,
              course: r.course,
              category: r.mainCategory,
              sales_team: r.salesTeam,
              source: r.cleanedSource,
              month: r.month,
            })}
          />
        </div>
      )}
    </AppShell>
  );
}
