import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useApi } from "@/lib/use-api";
import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { Card, ErrorState, PageHeader, Pill, SectionTitle, Segmented, Skeleton } from "@/components/ui-bits";
import { NotReported } from "@/components/metric-bits";
import { PerfTable } from "@/components/PerfTable";
import { MultiLineChart } from "@/components/charts";
import { PLATFORM_LABEL } from "@/lib/constants";
import type { DataHealth, Maybe, PerfRow, Platform, Totals } from "@/lib/types";

export const Route = createFileRoute("/ads")({ component: Ads });

interface PlatformBlock {
  platform: Platform;
  rows: number;
  spend: number;
  impressions: number;
  clicksAll: number;
  linkClicks: Maybe;
  platformLeads: Maybe;
  viewCompletions: Maybe;
  ctrAll: Maybe;
  ctrLink: Maybe;
  cpm: Maybe;
  cpc: Maybe;
  platformCpl: Maybe;
  accounts: string[];
  dateMin: string;
  dateMax: string;
}

interface Resp {
  totals: Totals;
  byPlatform: PlatformBlock[];
  byDay: { date: string; meta: number; snapchat: number; impressions: number; clicks: number }[];
  byAd: PerfRow[];
  byAdset: PerfRow[];
  accounts: { name: string; objective: string; spend: number; platformLeads: number | null }[];
  health: DataHealth;
}

function Ads() {
  const { t, lang } = useI18n();
  const [grain, setGrain] = useState<"ad" | "adset">("ad");
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/ads");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("ads_tech")}
        subtitle={
          lang === "ar"
            ? "تفصيل لكل منصة. المؤشرات التي لا تُبلغ عنها المنصة تظهر كشرطة، لا كصفر."
            : "Per-platform breakdown. Metrics a platform does not report render as a dash, never as zero."
        }
      />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {data.byPlatform.map((p) => (
              <PlatformCard key={p.platform} block={p} />
            ))}
          </div>

          <Card>
            <SectionTitle hint={lang === "ar" ? "الإنفاق اليومي لكل منصة" : "Daily spend per platform"}>
              {t("by_day")}
            </SectionTitle>
            <MultiLineChart
              data={data.byDay}
              series={[
                { key: "meta", name: PLATFORM_LABEL.meta[lang], color: "var(--chart-1)" },
                { key: "snapchat", name: PLATFORM_LABEL.snapchat[lang], color: "var(--chart-4)" },
              ]}
              format={fmtUSD}
            />
          </Card>

          <div className="flex items-center gap-3">
            <Segmented
              value={grain}
              onChange={setGrain}
              size="md"
              options={[
                { value: "ad", label: t("by_ad") },
                { value: "adset", label: t("ad_set") },
              ]}
            />
          </div>

          <PerfTable
            rows={grain === "ad" ? data.byAd : data.byAdset}
            grain={grain}
            csvFilename={`engosoft-ads-${grain}`}
          />
        </>
      )}
    </div>
  );
}

function PlatformCard({ block }: { block: PlatformBlock }) {
  const { t, lang } = useI18n();
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t("spend"), value: fmtUSDFull(block.spend) },
    { label: t("impressions"), value: fmtNum(block.impressions) },
    { label: t("clicks"), value: fmtNum(block.clicksAll) },
    { label: t("link_clicks"), value: block.linkClicks === null ? <NotReported /> : fmtNum(block.linkClicks) },
    { label: t("ctr_all"), value: fmtPct(block.ctrAll, 2) },
    { label: t("ctr_link"), value: block.ctrLink === null ? <NotReported /> : fmtPct(block.ctrLink, 2) },
    { label: t("cpm"), value: fmtUSDFull(block.cpm) },
    { label: t("cpc"), value: fmtUSDFull(block.cpc) },
    { label: t("platform_leads"), value: block.platformLeads === null ? <NotReported /> : fmtNum(block.platformLeads) },
    { label: t("platform_cpl"), value: block.platformCpl === null ? <NotReported /> : fmtUSDFull(block.platformCpl) },
  ];
  if (block.viewCompletions !== null) {
    rows.push({
      label: lang === "ar" ? "مشاهدات مكتملة" : "View completions",
      value: fmtNum(block.viewCompletions),
    });
  }

  return (
    <Card>
      <SectionTitle
        hint={`${block.dateMin} → ${block.dateMax} · ${fmtNum(block.rows)} ${lang === "ar" ? "صف" : "rows"}`}
        action={<Pill tone={block.platform === "meta" ? "brand" : "warning"}>{PLATFORM_LABEL[block.platform][lang]}</Pill>}
      >
        {PLATFORM_LABEL[block.platform][lang]}
      </SectionTitle>

      <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-[13px]">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-text-muted py-1 border-b border-border/60">{r.label}</dt>
            <dd className="text-end num font-medium py-1 border-b border-border/60">{r.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 text-[11px] text-text-muted">
        {t("account")}: {block.accounts.join(" · ")}
      </div>

      {block.platformLeads === null && (
        <p className="text-[11px] text-text-muted mt-2 leading-relaxed">
          {lang === "ar"
            ? "سناب شات لا يُصدّر أعمدة العملاء المحتملين ولا نقرات الرابط، فأعداد عملائه تأتي من النظام فقط عبر المصدر «Snapchat»."
            : "Snapchat exports no lead or link-click columns, so its lead counts come only from the CRM via the \"Snapchat\" source."}
        </p>
      )}
    </Card>
  );
}
