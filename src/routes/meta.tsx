import { createFileRoute } from "@tanstack/react-router";
import { DollarSign, Eye, MousePointerClick, Gauge } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card, ErrorState, KpiCard, Notice, SectionTitle, Skeleton } from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { MultiLineChart } from "@/components/charts";
import { fmtDate, fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { Totals } from "@/lib/types";

export const Route = createFileRoute("/meta")({ component: MetaPage });

interface AdRow {
  ad: string;
  campaign: string;
  adset: string;
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  leads: number;
  ctr: number;
  ctrLink: number;
  cpm: number;
  cpc: number;
  cpl: number;
}

interface DayRow {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  leads: number;
  ctr: number;
  cpm: number;
}

interface Resp {
  totals: Totals;
  daily: DayRow[];
  byAd: AdRow[];
  metaDateMin: string;
  metaDateMax: string;
}

function MetaPage() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/meta");

  const cols: Col<AdRow>[] = [
    {
      key: "ad",
      header: t("ad_name"),
      sticky: true,
      width: "200px",
      render: (r) => (
        <span className="block truncate max-w-[200px]" title={r.ad}>
          {r.ad}
        </span>
      ),
      sortValue: (r) => r.ad,
    },
    {
      key: "campaign",
      header: t("campaign"),
      render: (r) => (
        <span className="block truncate max-w-[180px] text-text-muted" title={r.campaign}>
          {r.campaign}
        </span>
      ),
      sortValue: (r) => r.campaign,
    },
    { key: "spend", header: t("spend"), align: "right", render: (r) => fmtUSD(r.spend), sortValue: (r) => r.spend },
    { key: "impressions", header: t("impressions"), align: "right", render: (r) => fmtNum(r.impressions), sortValue: (r) => r.impressions },
    { key: "clicks", header: t("clicks"), align: "right", render: (r) => fmtNum(r.clicks), sortValue: (r) => r.clicks },
    { key: "ctr", header: t("ctr_all"), align: "right", render: (r) => fmtPct(r.ctr), sortValue: (r) => r.ctr },
    { key: "ctrLink", header: t("ctr_link"), align: "right", render: (r) => fmtPct(r.ctrLink), sortValue: (r) => r.ctrLink },
    { key: "cpm", header: t("cpm"), align: "right", render: (r) => fmtUSD(r.cpm), sortValue: (r) => r.cpm },
    { key: "cpc", header: t("cpc"), align: "right", render: (r) => fmtUSD(r.cpc), sortValue: (r) => r.cpc },
    { key: "leads", header: t("meta_leads"), align: "right", render: (r) => fmtNum(r.leads), sortValue: (r) => r.leads },
    {
      key: "cpl",
      header: t("cpl"),
      align: "right",
      render: (r) => (r.leads > 0 ? fmtUSD(r.cpl) : <span className="text-text-subtle">—</span>),
      sortValue: (r) => r.cpl,
    },
  ];

  return (
    <AppShell title={t("meta_tech")}>
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-[104px]" />
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[400px]" />
        </div>
      ) : (
        <div className="space-y-4">
          <Notice tone="info">
            {lang === "ar"
              ? "كل النسب محسوبة من مجاميع النقرات والظهور، وليست متوسطاً للأعمدة — لذلك تختلف عن جمع عمود CTR مباشرة."
              : "Rates are recomputed from summed clicks and impressions, not averaged across rows — so they differ from summing the CTR column."}
          </Notice>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard index={0} label={t("spend")} value={fmtUSD(data.totals.spend)} icon={<DollarSign size={14} />} />
            <KpiCard index={1} label={t("impressions")} value={fmtNum(data.totals.impressions)} icon={<Eye size={14} />} />
            <KpiCard
              index={2}
              label={t("ctr_all")}
              value={fmtPct(data.totals.ctrAll)}
              sub={`${t("ctr_link")} ${fmtPct(data.totals.ctrLink)}`}
              icon={<MousePointerClick size={14} />}
            />
            <KpiCard
              index={3}
              label={t("cpm")}
              value={fmtUSD(data.totals.cpm)}
              sub={`${t("cpc")} ${fmtUSD(data.totals.cpc)}`}
              icon={<Gauge size={14} />}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <SectionTitle hint={`${data.metaDateMin} → ${data.metaDateMax}`}>
                {t("impressions")} / {t("clicks")}
              </SectionTitle>
              <MultiLineChart
                data={data.daily as unknown as Record<string, string | number>[]}
                series={[
                  { key: "impressions", name: t("impressions"), color: "var(--chart-1)" },
                  { key: "clicks", name: t("clicks"), color: "var(--chart-3)" },
                ]}
                format={fmtNum}
              />
            </Card>

            <Card>
              <SectionTitle>
                {t("spend")} / {t("meta_leads")}
              </SectionTitle>
              <MultiLineChart
                data={data.daily as unknown as Record<string, string | number>[]}
                series={[
                  { key: "spend", name: t("spend"), color: "var(--chart-2)" },
                  { key: "leads", name: t("meta_leads"), color: "var(--chart-6)" },
                ]}
              />
            </Card>
          </div>

          <Card>
            <SectionTitle>{t("by_day")}</SectionTitle>
            <div className="table-wrap rounded-lg border border-border" style={{ maxHeight: 320 }}>
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead className="sticky top-0">
                  <tr className="text-[11px] uppercase text-text-muted">
                    {[t("date"), t("spend"), t("impressions"), t("clicks"), t("ctr_all"), t("cpm"), t("meta_leads")].map(
                      (h, i) => (
                        <th
                          key={h}
                          className={`px-3 py-2 font-semibold bg-surface-2 border-b border-border whitespace-nowrap ${
                            i === 0 ? "text-start" : "text-end"
                          }`}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={d.date}>
                      <td className="px-3 py-2 border-b border-border num whitespace-nowrap">
                        {fmtDate(d.date, lang)}
                      </td>
                      <td className="px-3 py-2 border-b border-border text-end num">{fmtUSD(d.spend)}</td>
                      <td className="px-3 py-2 border-b border-border text-end num">{fmtNum(d.impressions)}</td>
                      <td className="px-3 py-2 border-b border-border text-end num">{fmtNum(d.clicks)}</td>
                      <td className="px-3 py-2 border-b border-border text-end num">{fmtPct(d.ctr)}</td>
                      <td className="px-3 py-2 border-b border-border text-end num">{fmtUSD(d.cpm)}</td>
                      <td className="px-3 py-2 border-b border-border text-end num">{fmtNum(d.leads)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <DataTable
            rows={data.byAd}
            cols={cols}
            searchable={(r) => `${r.ad} ${r.campaign} ${r.adset}`}
            initialSort={{ key: "spend", dir: -1 }}
            csvFilename="engosoft-meta-ads"
            csvRow={(r) => ({
              ad: r.ad,
              ad_set: r.adset,
              campaign: r.campaign,
              spend: r.spend.toFixed(2),
              impressions: r.impressions,
              clicks: r.clicks,
              link_clicks: r.linkClicks,
              ctr_all: r.ctr.toFixed(2),
              ctr_link: r.ctrLink.toFixed(2),
              cpm: r.cpm.toFixed(2),
              cpc: r.cpc.toFixed(2),
              leads: r.leads,
              cpl: r.cpl.toFixed(2),
            })}
          />
        </div>
      )}
    </AppShell>
  );
}
