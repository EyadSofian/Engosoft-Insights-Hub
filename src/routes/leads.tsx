import { createFileRoute } from "@tanstack/react-router";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { BarList, Card, ErrorState, KpiCard, PageHeader, Pill, SectionTitle, Skeleton } from "@/components/ui-bits";
import { AdSetOriginBadge, CloseTime, CountPct } from "@/components/metric-bits";
import { DataTable, type Col } from "@/components/DataTable";
import type { AdSetOrigin, DataHealth, Grouped, Totals } from "@/lib/types";

export const Route = createFileRoute("/leads")({ component: Leads });

interface LeadRow {
  createdAt: string;
  contact: string;
  campaign: string;
  adName: string;
  adset: string;
  adsetOrigin: AdSetOrigin;
  course: string;
  stage: string;
  source: string;
  salesperson: string;
  salesTeam: string;
  subTeam: string;
  priority: string;
  closedAt: string;
  daysToClose: number | null;
}

interface OriginCohort {
  key: "campaign" | "other";
  leads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  lostRate: number | null;
  revenue: number;
  avgCloseDays: number | null;
  closeSample: number;
}

interface Resp {
  totals: Totals;
  origin: { cohorts: OriginCohort[]; otherBySource: Grouped[] };
  byStage: Grouped[];
  bySource: Grouped[];
  byCourse: Grouped[];
  byTeam: Grouped[];
  bySubTeam: Grouped[];
  bySalesperson: Grouped[];
  byCampaign: Grouped[];
  byPriority: Grouped[];
  byMonth: Grouped[];
  detail: { rows: LeadRow[]; total: number; truncated: boolean };
  health: DataHealth;
}

function Leads() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/leads");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const cols: Col<LeadRow>[] = [
    { key: "createdAt", header: t("created"), sticky: true, width: "120px", sortValue: (r) => r.createdAt, render: (r) => fmtDate(r.createdAt, lang) },
    { key: "contact", header: t("contact"), sortValue: (r) => r.contact, render: (r) => <span className="truncate block max-w-[160px]" title={r.contact}>{r.contact || "—"}</span> },
    { key: "stage", header: t("stage"), sortValue: (r) => r.stage, render: (r) => <Pill tone={r.stage === "Won" ? "success" : r.stage === "Lost" ? "danger" : "neutral"}>{r.stage || "—"}</Pill> },
    { key: "course", header: t("course"), sortValue: (r) => r.course, render: (r) => r.course || "—" },
    { key: "source", header: t("source"), sortValue: (r) => r.source, render: (r) => r.source || "—" },
    { key: "campaign", header: t("campaign"), sortValue: (r) => r.campaign, render: (r) => <span className="truncate block max-w-[180px]" title={r.campaign}>{r.campaign || "—"}</span> },
    {
      key: "adset",
      header: t("ad_set"),
      sortValue: (r) => r.adset,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span className="truncate max-w-[140px]" title={r.adset}>{r.adset || "—"}</span>
          <AdSetOriginBadge origin={r.adsetOrigin} />
        </span>
      ),
    },
    { key: "salesperson", header: t("salesperson"), sortValue: (r) => r.salesperson, render: (r) => <span className="truncate block max-w-[150px]" title={r.salesperson}>{r.salesperson || "—"}</span> },
    { key: "salesTeam", header: t("sales_team"), sortValue: (r) => r.salesTeam, render: (r) => r.salesTeam || "—" },
    {
      key: "daysToClose",
      header: t("avg_close_time"),
      align: "right",
      sortValue: (r) => r.daysToClose ?? -1,
      render: (r) => (r.daysToClose === null ? <span className="text-text-subtle">—</span> : `${r.daysToClose} ${t("days")}`),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t("leads")} />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard index={0} label={t("crm_leads")} value={fmtNum(data.totals.crmLeads)} />
            <KpiCard index={1} label={t("won")} value={fmtNum(data.totals.won)} sub={fmtPct(data.totals.conversionRate, 1)} />
            <KpiCard index={2} label={t("lost_count")} value={fmtNum(data.totals.lost)} sub={fmtPct(data.totals.lostRate, 1)} />
            <KpiCard
              index={3}
              label={t("avg_close_time")}
              value={data.totals.avgCloseDays === null ? "—" : data.totals.avgCloseDays.toFixed(1)}
              sub={data.totals.closeSample ? `${t("based_on")} ${fmtNum(data.totals.closeSample)}` : undefined}
            />
          </div>

          <Card>
            <SectionTitle hint={t("origin_note")}>{t("lead_origin")}</SectionTitle>
            <div className="grid sm:grid-cols-2 gap-4">
              {data.origin.cohorts.map((c) => (
                <div key={c.key} className="rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold">{c.key === "campaign" ? t("from_campaigns") : t("other_sources")}</span>
                    <Pill tone={c.key === "campaign" ? "brand" : "neutral"}>{fmtNum(c.leads)}</Pill>
                  </div>
                  <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
                    <dt className="text-text-muted">{t("won")}</dt>
                    <dd className="text-end"><CountPct count={c.won} pct={c.conversionRate} /></dd>
                    <dt className="text-text-muted">{t("lost_count")}</dt>
                    <dd className="text-end"><CountPct count={c.lost} pct={c.lostRate} /></dd>
                    <dt className="text-text-muted">{t("revenue")}</dt>
                    <dd className="text-end num font-medium">{fmtUSD(c.revenue)}</dd>
                    <dt className="text-text-muted">{t("avg_close_time")}</dt>
                    <dd className="text-end text-[12px]"><CloseTime days={c.avgCloseDays} sample={c.closeSample} /></dd>
                  </dl>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Breakdown title={t("by_stage")} rows={data.byStage} />
            <Breakdown title={t("by_source")} rows={data.bySource} />
            <Breakdown title={t("by_course")} rows={data.byCourse} />
            <Breakdown title={t("by_team")} rows={data.byTeam} />
            <Breakdown title={t("by_salesperson")} rows={data.bySalesperson} />
            <Breakdown title={t("by_campaign")} rows={data.byCampaign} />
          </div>

          <DataTable
            rows={data.detail.rows}
            cols={cols}
            searchable={(r) => `${r.contact} ${r.campaign} ${r.course} ${r.salesperson} ${r.source}`}
            initialSort={{ key: "createdAt", dir: -1 }}
            csvFilename="engosoft-leads"
            maxHeight={620}
            truncatedNote={
              data.detail.truncated
                ? lang === "ar"
                  ? `معروض ${fmtNum(data.detail.rows.length)} من ${fmtNum(data.detail.total)} صف. صدِّر CSV للحصول على الكل ضمن الحد.`
                  : `Showing ${fmtNum(data.detail.rows.length)} of ${fmtNum(data.detail.total)} rows.`
                : undefined
            }
            csvRow={(r) => ({
              created: r.createdAt,
              contact: r.contact,
              stage: r.stage,
              course: r.course,
              source: r.source,
              campaign: r.campaign,
              ad_name: r.adName,
              ad_set: r.adset,
              ad_set_origin: r.adsetOrigin,
              salesperson: r.salesperson,
              sales_team: r.salesTeam,
              sub_team: r.subTeam,
              priority: r.priority,
              closed_at: r.closedAt,
              days_to_close: r.daysToClose ?? "",
            })}
          />
        </>
      )}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Grouped[] }) {
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <BarList
        items={rows.slice(0, 8).map((g) => ({
          label: g.label,
          value: g.count,
          meta: (
            <span>
              <span className="num">{fmtNum(g.count)}</span>
              <span className="num text-[11px] text-text-muted ms-1.5">({fmtPct(g.share, 1)})</span>
            </span>
          ),
        }))}
        format={fmtNum}
      />
    </Card>
  );
}
