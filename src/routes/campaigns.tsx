import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { X, ChevronRight, Layers } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card, EmptyState, ErrorState, Pill, RoasPill, SectionTitle, Skeleton } from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { AdSetAgg, CampaignAgg } from "@/lib/types";

export const Route = createFileRoute("/campaigns")({ component: CampaignsPage });

interface Resp {
  campaigns: CampaignAgg[];
  drilldown: Record<string, AdSetAgg[]>;
  matchRate: number;
}

const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function CampaignsPage() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/campaigns");
  const [selected, setSelected] = useState<CampaignAgg | null>(null);

  const cols: Col<CampaignAgg>[] = [
    {
      key: "campaign",
      header: t("campaign"),
      sticky: true,
      width: "220px",
      render: (r) => (
        <span className="flex items-center gap-1.5 max-w-[220px]">
          <span className="truncate" title={r.campaign}>
            {r.campaign || "—"}
          </span>
          {r.spend > 0 && <ChevronRight size={13} className="text-text-subtle shrink-0 rtl:rotate-180" />}
        </span>
      ),
      sortValue: (r) => r.campaign,
    },
    { key: "spend", header: t("spend"), align: "right", render: (r) => fmtUSD(r.spend), sortValue: (r) => r.spend },
    { key: "impressions", header: t("impressions"), align: "right", render: (r) => fmtNum(r.impressions), sortValue: (r) => r.impressions },
    { key: "ctr", header: t("ctr_all"), align: "right", render: (r) => fmtPct(r.ctrAll), sortValue: (r) => r.ctrAll },
    { key: "metaLeads", header: t("meta_leads"), align: "right", render: (r) => fmtNum(r.metaLeads), sortValue: (r) => r.metaLeads },
    { key: "crmLeads", header: t("crm_leads"), align: "right", render: (r) => fmtNum(r.crmLeads), sortValue: (r) => r.crmLeads },
    { key: "won", header: t("won"), align: "right", render: (r) => fmtNum(r.won), sortValue: (r) => r.won },
    { key: "revenue", header: t("revenue"), align: "right", render: (r) => fmtUSD(r.revenue), sortValue: (r) => r.revenue },
    { key: "cpl", header: t("cpl"), align: "right", render: (r) => fmtUSD(r.cpl), sortValue: (r) => r.cpl },
    {
      key: "roas",
      header: t("roas"),
      align: "right",
      render: (r) => (r.spend > 0 ? <RoasPill roas={r.roas} /> : <span className="text-text-subtle">—</span>),
      sortValue: (r) => r.roas,
    },
  ];

  const drill = selected ? data?.drilldown[normalizeName(selected.campaign)] ?? [] : [];

  return (
    <AppShell title={t("campaigns")}>
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <Skeleton className="h-[460px]" />
      ) : (
        <div className="space-y-4">
          <DataTable
            rows={data.campaigns}
            cols={cols}
            searchable={(r) => r.campaign}
            initialSort={{ key: "spend", dir: -1 }}
            onRowClick={(r) => setSelected(r.spend > 0 ? r : null)}
            csvFilename="engosoft-campaigns"
            csvRow={(r) => ({
              campaign: r.campaign,
              spend: r.spend.toFixed(2),
              impressions: r.impressions,
              ctr_all: r.ctrAll.toFixed(2),
              meta_leads: r.metaLeads,
              crm_leads: r.crmLeads,
              won: r.won,
              revenue: r.revenue.toFixed(2),
              cpl: r.cpl.toFixed(2),
              roas: r.roas.toFixed(2),
            })}
            toolbar={
              <span className="text-[11px] text-text-muted hidden sm:inline">
                {lang === "ar" ? "اضغط على حملة لعرض التفاصيل" : "Click a campaign to drill down"}
              </span>
            }
          />

          {selected && (
            <Card className="animate-fade-up">
              <SectionTitle
                hint={
                  lang === "ar"
                    ? "توزيع الإنفاق على المجموعات الإعلانية والإعلانات."
                    : "How spend splits across ad sets and ads."
                }
                action={
                  <button
                    onClick={() => setSelected(null)}
                    aria-label={t("close")}
                    className="w-9 h-9 grid place-items-center rounded-lg hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    <X size={17} />
                  </button>
                }
              >
                <span className="inline-flex items-center gap-2">
                  <Layers size={16} className="text-brand" />
                  {selected.campaign}
                </span>
              </SectionTitle>

              {drill.length === 0 ? (
                <EmptyState label={t("no_data")} compact />
              ) : (
                <div className="space-y-4">
                  {drill.map((set, i) => (
                    <div key={set.adset + i} className="stagger" style={{ "--i": i } as React.CSSProperties}>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="text-[13px] font-semibold text-text truncate">{set.adset}</span>
                        <Pill tone="brand">{fmtUSD(set.spend)}</Pill>
                        <Pill>
                          {t("ctr_all")} {fmtPct(set.ctrAll)}
                        </Pill>
                        <Pill>
                          {fmtNum(set.metaLeads)} {t("meta_leads")}
                        </Pill>
                      </div>
                      <div className="table-wrap rounded-lg border border-border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-[11px] uppercase text-text-muted bg-surface-2">
                              <th className="text-start font-semibold px-3 py-2">{t("ad_name")}</th>
                              <th className="text-end font-semibold px-3 py-2">{t("spend")}</th>
                              <th className="text-end font-semibold px-3 py-2">{t("impressions")}</th>
                              <th className="text-end font-semibold px-3 py-2">{t("ctr_all")}</th>
                              <th className="text-end font-semibold px-3 py-2">{t("meta_leads")}</th>
                              <th className="text-end font-semibold px-3 py-2">{t("cpl")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {set.ads.map((ad, j) => (
                              <tr key={ad.ad + j} className="border-t border-border">
                                <td className="px-3 py-2 max-w-[240px]">
                                  <span className="block truncate" title={ad.ad}>
                                    {ad.ad}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-end num">{fmtUSD(ad.spend)}</td>
                                <td className="px-3 py-2 text-end num">{fmtNum(ad.impressions)}</td>
                                <td className="px-3 py-2 text-end num">{fmtPct(ad.ctrAll)}</td>
                                <td className="px-3 py-2 text-end num">{fmtNum(ad.metaLeads)}</td>
                                <td className="px-3 py-2 text-end num">
                                  {ad.metaLeads > 0 ? fmtUSD(ad.cpl) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </AppShell>
  );
}
