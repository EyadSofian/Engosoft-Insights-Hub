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
        {(filters.campaign || filters.campaignKey || filters.adset || filters.adsetKey || filters.ad || filters.adKey) && (
          <button
            onClick={() =>
              filterStore.set({
                campaign: undefined,
                campaignKey: undefined,
                adset: undefined,
                adsetKey: undefined,
                ad: undefined,
                adKey: undefined,
              })
            }
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
          ? "الإيراد أعلى الصفحة وفي كل صف من صفوف الحملة/المجموعة/الإعلان من Accounting.USD Paid حسب Payment Date. الصفوف بلا حملة معروفة لا تظهر هنا، فمجموع الجدول قد يكون أقل من إجمالي الإيراد."
          : "Revenue at the top of the page and in every campaign/ad-set/ad row comes from Accounting.USD Paid by Payment Date. Rows without a known campaign are excluded here, so the table may total less than headline revenue."}
      </Notice>

      {filters.account && (
        <Notice
          tone="warning"
          title={lang === "ar" ? "نطاق حساب الإعلانات" : "Ad-account scope"}
          icon={<Info size={16} />}
        >
          {lang === "ar"
            ? "عند اختيار حساب إعلاني، تُربط بيانات CRM والصفقات الضائعة والإيراد بالحساب فقط عبر Campaign ID مطابق فعلياً. الصفوف التي لا تحمل Campaign ID تُستبعد بدلاً من تخمين حسابها."
            : "With an ad account selected, CRM, lost and revenue facts are scoped only through an exact Campaign ID observed in that account. Rows without a Campaign ID are excluded rather than guessed into the account."}
        </Notice>
      )}

      {isLoading || !data ? (
        <Skeleton className="h-[520px]" />
      ) : (
        <>
          <Card>
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-4">
              <Metric label={t("spend")}>{fmtUSD(data.totals.spend)}</Metric>
              <Metric
                label={lang === "ar" ? "إجمالي الإيراد المحصّل" : "Total collected revenue"}
                hint={lang === "ar" ? "Accounting ضمن الفلاتر الحالية" : "Accounting within current filters"}
              >
                {fmtUSD(data.totals.revenue)}
              </Metric>
              <Metric label={t("attributed_revenue")}>
                {fmtUSD(data.totals.attributedRevenue)}
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
                filterStore.set({
                  campaign: r.campaignName || r.name,
                  campaignKey: r.campaignKey || r.key,
                  adset: undefined,
                  adsetKey: undefined,
                  ad: undefined,
                  adKey: undefined,
                });
                setGrain("adset");
              } else if (grain === "adset") {
                filterStore.set({
                  campaign: r.campaignName || filters.campaign,
                  campaignKey: r.campaignKey || filters.campaignKey,
                  adset: r.adsetName || r.name,
                  adsetKey: r.adsetKey || r.key,
                  ad: undefined,
                  adKey: undefined,
                });
                setGrain("ad");
              } else {
                filterStore.set({
                  campaign: r.campaignName || filters.campaign,
                  campaignKey: r.campaignKey || filters.campaignKey,
                  adset: r.adsetName || filters.adset,
                  adsetKey: r.adsetKey || filters.adsetKey,
                  ad: r.name,
                  adKey: r.adKey || r.key,
                });
              }
            }}
          />
        </>
      )}
    </div>
  );
}
