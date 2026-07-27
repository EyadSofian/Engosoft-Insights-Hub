import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Info } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { filterStore, useFilters } from "@/lib/filter-store";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { Card, ErrorState, Notice, PageHeader, Segmented, Skeleton } from "@/components/ui-bits";
import { PerfTable } from "@/components/PerfTable";
import { Metric } from "@/components/metric-bits";
import type { DataHealth, PerfRow, Totals } from "@/lib/types";

export const Route = createFileRoute("/campaigns")({ component: Campaigns });

type Grain = "campaign" | "adset" | "ad";

interface Resp {
  grain: Grain;
  rows: PerfRow[];
  totals: Totals;
  unknownAdsetKey: string;
  health: DataHealth;
}

function Campaigns() {
  const { t, lang } = useI18n();
  const filters = useFilters();
  const [grain, setGrain] = useState<Grain>("campaign");
  const { data, isLoading, error, refetch } = useApi<Resp>(`/api/campaigns?grain=${grain}`);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const unknownRow = data?.rows.find((r) => r.key === data.unknownAdsetKey);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("campaigns")}
        subtitle={
          lang === "ar"
            ? "جدول واحد بثلاثة مستويات: الحملة ← المجموعة الإعلانية ← الإعلان. اضغط صفاً للتعمق."
            : "One table, three grains: campaign → ad set → ad. Click a row to drill down."
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={grain}
          onChange={setGrain}
          size="md"
          options={[
            { value: "campaign", label: t("campaign") },
            { value: "adset", label: t("ad_set") },
            { value: "ad", label: t("ad_name") },
          ]}
        />
        {(filters.campaign || filters.adset || filters.ad) && (
          <button
            onClick={() => filterStore.set({ campaign: undefined, adset: undefined, ad: undefined })}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-surface-2 transition-colors cursor-pointer"
          >
            {t("clear")}: {[filters.campaign, filters.adset, filters.ad].filter(Boolean).join(" › ")}
          </button>
        )}
      </div>

      {grain === "adset" && (
        <Notice tone="info" title={t("adset_derived_note")} icon={<Info size={16} />}>
          {lang === "ar"
            ? `تُستنتج المجموعة الإعلانية من معرّف الإعلان أولاً — وهو ربط دقيق — ثم من اسم الإعلان عند الحاجة. أسماء الإعلانات ليست فريدة، لذلك تُعلَّم القيم المستنتجة من الاسم بشارة «غير مؤكد». نسبة الاستنتاج الحالية ${data ? fmtPct(data.health.adsetResolutionRate * 100, 1) : "—"}.`
            : `Ad set is resolved from the ad id first — an exact join — then from the ad name where needed. Ad names are not unique, so name-derived values carry an "ambiguous" badge. Current resolution rate: ${data ? fmtPct(data.health.adsetResolutionRate * 100, 1) : "—"}.`}
        </Notice>
      )}

      <Notice tone="info" title={t("data_notes")} icon={<Info size={16} />}>
        {lang === "ar"
          ? "الإيراد أعلى الصفحة وفي كل صف من صفوف الحملة/المجموعة/الإعلان من نفس المصدر: عمود $ Sales في تبويب Sales حسب Payment Date، مربوطاً بحملته عبر رقم أمر البيع. الصفوف بلا حملة معروفة لا تظهر هنا، فمجموع هذا الجدول أقل من إجمالي الإيراد أعلاه."
          : "Revenue at the top of the page and inside every campaign/ad-set/ad row is the same source: the Sales tab's $ Sales column by Payment Date, joined to its campaign through the sales-order number. Rows with no known campaign do not appear here, so this table's total is less than the headline revenue above."}
      </Notice>

      {isLoading || !data ? (
        <Skeleton className="h-[520px]" />
      ) : (
        <>
          <Card>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
              <Metric label={t("spend")}>{fmtUSD(data.totals.spend)}</Metric>
              <Metric
                label={t("revenue")}
                hint={
                  lang === "ar"
                    ? `منها ${fmtUSD(data.totals.attributedRevenue)} مرتبط بحملة`
                    : `${fmtUSD(data.totals.attributedRevenue)} campaign-linked`
                }
              >
                {fmtUSD(data.totals.revenue)}
              </Metric>
              {/* This is the ads page, so the headline lead number is what the
                  platforms reported. The Odoo total sits underneath it — the two
                  measure different things and the bigger one used to win by
                  accident. */}
              <Metric
                label={t("platform_leads")}
                hint={
                  lang === "ar"
                    ? `${fmtNum(data.totals.totalLeads)} في أودو`
                    : `${fmtNum(data.totals.totalLeads)} in Odoo`
                }
              >
                {data.totals.platformLeads === null ? "—" : fmtNum(data.totals.platformLeads)}
              </Metric>
              <Metric label={t("won")} hint={fmtPct(data.totals.conversionRate, 1)}>
                {fmtNum(data.totals.won)}
              </Metric>
              <Metric label={t("lost_count")} hint={fmtPct(data.totals.lostRate, 1)}>
                {fmtNum(data.totals.lost)}
              </Metric>
              <Metric label={lang === "ar" ? "عدد الصفوف" : "Rows"}>{fmtNum(data.rows.length)}</Metric>
            </div>
          </Card>

          {unknownRow && (
            <Notice tone="warning" title={t("unknown_adset")}>
              {lang === "ar"
                ? `${fmtNum(unknownRow.crmLeads)} عميلاً و${fmtUSD(unknownRow.revenue)} من الإيراد لم يُمكن ربطها بمجموعة إعلانية. تظهر كصف مستقل في الجدول بدل حذفها.`
                : `${fmtNum(unknownRow.crmLeads)} leads and ${fmtUSD(unknownRow.revenue)} of revenue could not be tied to an ad set. They appear as their own row rather than being dropped.`}
            </Notice>
          )}

          <PerfTable
            rows={data.rows}
            grain={grain}
            unknownAdsetKey={data.unknownAdsetKey}
            csvFilename={`engosoft-${grain}`}
            onRowClick={(r) => {
              // A click scopes the global filters and steps one grain deeper, so
              // every other page re-scopes with it.
              if (r.key === data.unknownAdsetKey) return;
              if (grain === "campaign") {
                filterStore.set({ campaign: r.name });
                setGrain("adset");
              } else if (grain === "adset") {
                filterStore.set({ adset: r.name });
                setGrain("ad");
              } else {
                filterStore.set({ ad: r.name });
              }
            }}
          />
        </>
      )}
    </div>
  );
}
