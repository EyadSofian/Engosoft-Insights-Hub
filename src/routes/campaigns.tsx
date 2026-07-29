import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  BarChart3,
  CircleDollarSign,
  Handshake,
  Info,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { useFilters } from "@/lib/filter-store";
import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import {
  Card,
  ErrorState,
  Notice,
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { CompareBars } from "@/components/ads/CompareBars";
import { MetricCard, Unavailable } from "@/components/ads/MetricCard";
import { roasVerdict, verdictWord } from "@/components/ads/verdict";
import { MetricsGlossaryButton } from "@/components/ads/MetricsGlossary";
import { FilterSummary } from "@/components/ads/FilterSummary";
import { PerfExplorer, type Grain } from "@/components/ads/PerfExplorer";
import { ratioCell } from "@/components/ads/cells";
import type { DataHealth, PerfRow, Totals } from "@/lib/types";

export const Route = createFileRoute("/campaigns")({ component: Campaigns });

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
  const totals = data?.totals;
  const spend = totals?.spend ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={t("campaigns")}
          subtitle={
            lang === "ar"
              ? "ثلاث مستويات في مكان واحد: الحملة ← المجموعة الإعلانية ← الإعلان. دوس أي صف تشوف تفاصيله واللي تحته."
              : "Three levels in one place: campaign → ad set → ad. Click any row for its detail and the level beneath it."
          }
        />
        <MetricsGlossaryButton className="mt-0.5" />
      </div>

      <FilterSummary />

      {isLoading || !data || !totals ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[124px]" />
            ))}
          </div>
          <Skeleton className="h-[520px]" />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <MetricCard
              metric="spend"
              index={0}
              icon={<Wallet size={14} />}
              value={fmtUSD(totals.spend)}
            />
            <MetricCard
              metric="platformLeads"
              index={1}
              icon={<Users size={14} />}
              value={
                totals.platformLeads === null ? (
                  <Unavailable
                    reason={
                      lang === "ar"
                        ? "المنصة دي مبتبلّغش عن عدد ليدز"
                        : "This platform reports no lead metric"
                    }
                  />
                ) : (
                  fmtNum(totals.platformLeads)
                )
              }
              sub={
                lang === "ar"
                  ? `${fmtNum(totals.totalLeads)} في أودو`
                  : `${fmtNum(totals.totalLeads)} in Odoo`
              }
            />
            <MetricCard
              metric="won"
              index={2}
              icon={<UserPlus size={14} />}
              value={fmtNum(totals.won)}
              sub={fmtPct(totals.conversionRate, 1)}
            />
            <MetricCard
              metric="conversionRate"
              index={3}
              icon={<Handshake size={14} />}
              value={ratioCell(totals.conversionRate, totals.totalLeads, (v) => fmtPct(v, 2))}
              sub={
                lang === "ar"
                  ? `${fmtNum(totals.lost)} ضايعة (${fmtPct(totals.lostRate, 1)})`
                  : `${fmtNum(totals.lost)} lost (${fmtPct(totals.lostRate, 1)})`
              }
            />
            <MetricCard
              metric="revenue"
              index={4}
              icon={<CircleDollarSign size={14} />}
              value={fmtUSD(totals.revenue)}
              sub={
                lang === "ar"
                  ? `منها ${fmtUSD(totals.attributedRevenue)} مربوط بحملات`
                  : `${fmtUSD(totals.attributedRevenue)} linked to campaigns`
              }
            />
            <MetricCard
              metric="roas"
              index={5}
              icon={<TrendingUp size={14} />}
              value={ratioCell(totals.roas, spend, (v) => `${v.toFixed(2)}×`)}
              unavailableReason={
                spend <= 0
                  ? lang === "ar"
                    ? "مفيش إنفاق مسجّل في الفترة المختارة."
                    : "No recorded spend in the selected period."
                  : undefined
              }
              verdict={roasVerdict(totals.roas, spend) ?? undefined}
              verdictLabel={verdictWord(roasVerdict(totals.roas, spend), lang)}
              note={
                lang === "ar"
                  ? `البسط هنا كل التحصيل في الفترة (${fmtUSD(totals.revenue)})، مش الجزء المربوط بحملات (${fmtUSD(totals.attributedRevenue)}).`
                  : `The numerator is all revenue collected in the window (${fmtUSD(totals.revenue)}), not only the campaign-linked share (${fmtUSD(totals.attributedRevenue)}).`
              }
            />
          </div>

          <Card>
            <SectionTitle
              action={
                <Pill tone="neutral">
                  {grain === "campaign"
                    ? t("campaign")
                    : grain === "adset"
                      ? t("ad_set")
                      : t("ad_name")}
                </Pill>
              }
              hint={
                lang === "ar"
                  ? "أعلى ٨ صفوف إنفاقًا. العمود الأزرق هو الإنفاق والبرتقالي هو التحصيل — لو البرتقالي أقصر يبقى لسه ما رجّعش فلوسه."
                  : "The eight biggest spenders. Blue is spend, orange is revenue — where orange is shorter, the money has not come back."
              }
            >
              <span className="inline-flex items-center gap-1.5">
                <BarChart3 size={15} className="text-text-subtle" />
                {lang === "ar" ? "الإنفاق مقابل التحصيل" : "Spend against collections"}
              </span>
            </SectionTitle>
            <CompareBars
              rows={[...data.rows]
                .filter((r) => r.spend > 0)
                .sort((a, b) => b.spend - a.spend)
                .slice(0, 8)}
            />
          </Card>

          <div className="space-y-3">
            {grain === "adset" && (
              <Notice tone="info" title={t("adset_derived_note")} icon={<Info size={16} />}>
                {lang === "ar"
                  ? `المجموعة الإعلانية بتتحدد من معرّف الإعلان الأول — ده ربط مضبوط — وبعدين من اسم الإعلان لو لزم. أسماء الإعلانات مش فريدة، فاللي اتحدد بالاسم بياخد علامة «غير مؤكد». نسبة الاستنتاج دلوقتي ${fmtPct(data.health.adsetResolutionRate * 100, 1)}.`
                  : `Ad set is resolved from the ad id first — an exact join — then from the ad name where needed. Ad names are not unique, so name-derived values carry an "ambiguous" badge. Current resolution rate: ${fmtPct(data.health.adsetResolutionRate * 100, 1)}.`}
              </Notice>
            )}

            <Notice tone="info" title={t("data_notes")} icon={<Info size={16} />}>
              {lang === "ar"
                ? "الإيراد فوق وفي كل صف مصدره Accounting.USD Paid بتاريخ الدفع. الصفوف اللي مالهاش حملة معروفة مش بتظهر هنا، فمجموع الجدول ممكن يقل عن إجمالي الإيراد."
                : "Revenue at the top and in every row comes from Accounting.USD Paid by Payment Date. Rows without a known campaign are excluded here, so the table may total less than headline revenue."}
            </Notice>

            {filters.account && (
              <Notice
                tone="warning"
                title={lang === "ar" ? "نطاق الحساب الإعلاني" : "Ad-account scope"}
                icon={<Info size={16} />}
              >
                {lang === "ar"
                  ? "لما تختار حساب إعلاني، بيانات الـCRM والخسائر والإيراد بتترتبط بالحساب من خلال Campaign ID مطابق فعلًا بس. الصفوف اللي مالهاش Campaign ID بتتستبعد بدل ما نخمّن حسابها."
                  : "With an ad account selected, CRM, lost and revenue facts are scoped only through an exact Campaign ID observed in that account. Rows without a Campaign ID are excluded rather than guessed into the account."}
              </Notice>
            )}

            {unknownRow && (
              <Notice tone="warning" title={t("unknown_adset")}>
                {lang === "ar"
                  ? `${fmtNum(unknownRow.crmLeads)} عميل و${fmtUSD(unknownRow.revenue)} تحصيل ما قدرناش نربطهم بمجموعة إعلانية. بيظهروا كصف لوحده في الجدول بدل ما يتشالوا.`
                  : `${fmtNum(unknownRow.crmLeads)} leads and ${fmtUSD(unknownRow.revenue)} of revenue could not be tied to an ad set. They appear as their own row rather than being dropped.`}
              </Notice>
            )}
          </div>

          <PerfExplorer
            rows={data.rows}
            grain={grain}
            onGrainChange={setGrain}
            unknownAdsetKey={data.unknownAdsetKey}
            csvPrefix="engosoft"
            spendAvailable={spend > 0}
            spendNote={
              spend <= 0
                ? lang === "ar"
                  ? "مفيش إنفاق مسجّل في النطاق الحالي، فالمؤشرات المبنية على الإنفاق بتظهر شرطة."
                  : "No recorded spend in the current scope, so spend-derived metrics render as a dash."
                : undefined
            }
            title={lang === "ar" ? "الجدول التفصيلي" : "The detailed table"}
          />

          <p className="text-[11px] text-text-subtle px-1">
            {lang === "ar"
              ? `${fmtNum(data.rows.length)} صف في المستوى ده. متوسط تكلفة الصفقة ${fmtUSDFull(totals.cpa)} على أساس ${filters.cpaBasis === "invoices" ? "عدد الفواتير" : "الصفقات المكسوبة"}.`
              : `${fmtNum(data.rows.length)} rows at this level. Blended CPA is ${fmtUSDFull(totals.cpa)} on the ${filters.cpaBasis === "invoices" ? "invoice-count" : "won-deals"} basis.`}
          </p>
        </>
      )}
    </div>
  );
}
