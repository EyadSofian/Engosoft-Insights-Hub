import { useMemo, useState } from "react";
import { BadgeDollarSign, Gauge, Layers, Radio, Target, Trophy, Users, Wallet } from "lucide-react";
import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { Card, Pill, Segmented } from "@/components/ui-bits";
import {
  DashboardPageHeader,
  DrilldownBreadcrumb,
  KpiRow,
  MoreDetails,
  PageSection,
  PageSections,
} from "@/components/dashboard-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { CampaignCreativeGallery } from "@/components/ads/CampaignCreativeGallery";
import {
  CreativeDetail,
  GrainPerformance,
  SalesOutcomes,
  useClosedLoop,
} from "@/components/acquisition/ClosedLoop";
import { ownerCampaignVerdict } from "@/components/ads/owner-campaign-verdict";
import type { ClosedLoopGrain, GrainRow } from "@/lib/closed-loop";
import type { CampaignOperationalState, PerfRow } from "@/lib/types";
import type { MetricDetail } from "@/lib/metric-detail";

export type CampaignTab = "overview" | "ads" | "sales";

/** The Meta campaign id a row carries, when it is a Meta campaign. */
function metaCampaignId(row: PerfRow): string {
  if (row.campaignKey.startsWith("id:")) return row.campaignKey.slice(3);
  if (row.key.startsWith("id:")) return row.key.slice(3);
  return "";
}

/**
 * One campaign, on its own screen.
 *
 * The list answers "which campaign"; this answers "what about it" — the
 * figures, then the hierarchy under it, then the leads it produced and what
 * they bought. Those three used to be separate global tabs stacked under one
 * another; here they are three local views over ONE campaign, and each level
 * of the hierarchy opens the next rather than being a tab of its own.
 */
export function CampaignDetail({
  row,
  rows,
  state,
  lostAvailable,
  tab,
  onTab,
  onBack,
  period,
}: {
  row: PerfRow;
  rows: PerfRow[];
  state?: CampaignOperationalState;
  lostAvailable: boolean;
  tab: CampaignTab;
  onTab: (tab: CampaignTab) => void;
  onBack: () => void;
  period?: string;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const closedLoop = useClosedLoop();
  const campaignId = metaCampaignId(row);
  const [grain, setGrain] = useState<ClosedLoopGrain>("adset");
  const [drill, setDrill] = useState<{ adsetId?: string; adsetLabel?: string; adLabel?: string }>(
    {},
  );
  const [creativeId, setCreativeId] = useState<string | null>(null);

  const verdict = useMemo(
    () => ownerCampaignVerdict(row, rows, state?.startTime, lostAvailable),
    [row, rows, state?.startTime, lostAvailable],
  );

  // Qualified leads exist only in the exact-attribution loop, so the card says
  // whose figure it is rather than mixing it silently with the sheet totals.
  const exact = closedLoop.data?.grains?.campaign?.find(
    (entry: GrainRow) => entry.campaignId === campaignId,
  );

  const detail = (
    id: string,
    title: string,
    value: string,
    tone: MetricDetail["tone"],
    icon: MetricDetail["icon"],
    definition: string,
    formula?: string,
  ): MetricDetail => ({
    id: `campaigns.detail.${id}`,
    title,
    value,
    tone,
    icon,
    definition,
    formula,
    entity: { type: "campaign", id: campaignId || row.campaignKey, name: row.name },
  });

  // "Live" is what the platform says right now, not a guess from spend.
  const live = (state?.effectiveStatus || "").toUpperCase() === "ACTIVE";
  const statusLabel = state
    ? live
      ? A
        ? "شغّالة"
        : "Live"
      : state.effectiveStatus || (A ? "متوقفة" : "Paused")
    : A
      ? "الحالة غير متاحة"
      : "Status unavailable";

  return (
    <PageSections>
      <DashboardPageHeader
        flush
        icon={<Layers size={20} />}
        title={row.name}
        subtitle={
          A
            ? "كل ما يخص هذه الحملة: الأرقام، ثم مجموعاتها وموادها، ثم عملاؤها ومبيعاتها."
            : "Everything about this campaign: the figures, then its ad sets and creatives, then its leads and sales."
        }
        period={period}
        actions={
          <span className="flex flex-wrap items-center gap-1.5">
            <Pill tone={live ? "success" : "neutral"}>
              <Radio size={11} className="me-1 inline" aria-hidden="true" />
              {statusLabel}
            </Pill>
            {row.platforms.map((platform) => (
              <Pill key={platform} tone="neutral">
                {platform}
              </Pill>
            ))}
            {row.course ? <Pill tone="brand">{row.course}</Pill> : null}
          </span>
        }
      />

      <DrilldownBreadcrumb
        steps={[
          { key: "all", label: A ? "الحملات" : "Campaigns", onSelect: onBack },
          { key: "campaign", label: row.name },
        ]}
      />

      <PageSection level="headline" aria-label={A ? "أرقام الحملة" : "Campaign figures"}>
        <KpiRow>
          <MetricDetailTrigger
            detail={detail(
              "spend",
              A ? "الإنفاق" : "Spend",
              fmtUSD(row.spend),
              "rose",
              <Wallet size={17} />,
              A
                ? "ما صرفته هذه الحملة في الفترة المختارة."
                : "What this campaign spent in the selected period.",
            )}
            card={{ index: 0 }}
          />
          <MetricDetailTrigger
            detail={detail(
              "leads",
              A ? "العملاء المحتملون" : "Leads",
              fmtNum(row.crmLeads),
              "violet",
              <Users size={17} />,
              A ? "عدد عملاء CRM المنسوبين لهذه الحملة." : "CRM leads attributed to this campaign.",
            )}
            card={{
              index: 1,
              sub:
                row.cpl === null
                  ? undefined
                  : `${A ? "تكلفة العميل" : "Cost per lead"} ${fmtUSDFull(row.cpl)}`,
            }}
          />
          <MetricDetailTrigger
            detail={detail(
              "qualified",
              A ? "العملاء المؤهلون" : "Qualified",
              exact ? fmtNum(exact.qualified) : A ? "غير متاح" : "Unavailable",
              "sky",
              <Target size={17} />,
              A
                ? "العملاء الذين وصلوا لمرحلة مؤهل، من العملاء المعروف إعلانهم بالضبط."
                : "Leads that reached the qualified stage, among leads traced to their exact ad.",
            )}
            card={{
              index: 2,
              sub: exact
                ? A
                  ? `من ${fmtNum(exact.leads)} عميل بإسناد دقيق`
                  : `of ${fmtNum(exact.leads)} exactly attributed leads`
                : A
                  ? "لا يوجد إسناد دقيق لهذه الحملة"
                  : "No exact attribution for this campaign",
              valueWrap: !exact,
            }}
          />
          <MetricDetailTrigger
            detail={detail(
              "won",
              A ? "الصفقات المغلقة" : "Won",
              fmtNum(row.won),
              "mint",
              <Trophy size={17} />,
              A ? "الصفقات الرابحة من عملاء هذه الحملة." : "Deals won from this campaign's leads.",
            )}
            card={{ index: 3, sub: fmtPct(row.conversionRate, 1) }}
          />
          <MetricDetailTrigger
            detail={detail(
              "revenue",
              A ? "الإيراد المحصّل" : "Collected revenue",
              fmtUSD(row.revenue),
              "mint",
              <BadgeDollarSign size={17} />,
              A
                ? "التحصيل المرتبط بعملاء هذه الحملة، بتاريخ الدفع."
                : "Revenue collected from this campaign's leads, by payment date.",
            )}
            card={{
              index: 4,
              hero: true,
              sub: `${fmtNum(row.invoices)} ${A ? "فاتورة" : "invoices"}`,
            }}
          />
          <MetricDetailTrigger
            detail={detail(
              "roas",
              A ? "العائد على الإنفاق" : "ROAS",
              row.roas === null ? (A ? "غير متاح" : "Unavailable") : `${row.roas.toFixed(2)}×`,
              "amber",
              <Gauge size={17} />,
              A ? "الإيراد ÷ الإنفاق لهذه الحملة." : "Revenue ÷ spend for this campaign.",
              `${fmtUSD(row.revenue)} ÷ ${fmtUSD(row.spend)}`,
            )}
            card={{ index: 5, valueWrap: row.roas === null }}
          />
        </KpiRow>
      </PageSection>

      <Segmented
        value={tab}
        onChange={onTab}
        size="md"
        options={[
          { value: "overview", label: A ? "نظرة عامة" : "Overview" },
          { value: "ads", label: A ? "المجموعات والمواد" : "Ads & creatives" },
          { value: "sales", label: A ? "العملاء والمبيعات" : "Leads & sales" },
        ]}
      />

      {tab === "overview" ? (
        <>
          <Card>
            <h2 className="text-[14px] font-semibold text-text">
              {A ? "لماذا هذا الحكم؟" : "Why this verdict?"}
            </h2>
            <p className="mt-1 text-[12.5px] leading-6 text-text-muted">{verdict.reason[lang]}</p>
            <dl className="mt-3 grid gap-2 text-[12.5px] sm:grid-cols-2">
              {[
                [A ? "الفواتير المدفوعة" : "Paid invoices", fmtNum(row.invoices)],
                [A ? "قيد المتابعة" : "Under follow-up", fmtNum(row.followUp)],
                [A ? "الصفقات الضائعة" : "Lost", fmtNum(row.lost)],
                [
                  A ? "تكلفة الصفقة" : "Cost per won deal",
                  row.cpa === null ? "—" : fmtUSDFull(row.cpa),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3 border-b border-border/60 py-1"
                >
                  <dt className="text-text-muted">{label}</dt>
                  <dd className="num font-medium text-text">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <MoreDetails label={A ? "تفاصيل تقنية" : "Technical details"}>
            <Card>
              <dl className="grid gap-2 font-mono text-[11.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">campaign id</dt>
                  <dd className="break-all text-text">{campaignId || "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">campaign key</dt>
                  <dd className="break-all text-text">{row.campaignKey || row.key}</dd>
                </div>
                {row.spendDateMin ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-muted">spend data covers</dt>
                    <dd className="text-text">{`${row.spendDateMin} → ${row.spendDateMax}`}</dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          </MoreDetails>
        </>
      ) : null}

      {tab === "ads" ? (
        campaignId ? (
          <>
            <DrilldownBreadcrumb
              steps={[
                {
                  key: "adsets",
                  label: A ? "المجموعات الإعلانية" : "Ad sets",
                  onSelect:
                    grain === "adset"
                      ? undefined
                      : () => {
                          setDrill({});
                          setGrain("adset");
                        },
                },
                ...(grain === "ad"
                  ? [{ key: "ads", label: drill.adsetLabel ?? (A ? "الإعلانات" : "Ads") }]
                  : []),
              ]}
            />
            <GrainPerformance
              data={closedLoop.data}
              loading={closedLoop.isLoading}
              grain={grain}
              filter={{ campaignId, adsetId: grain === "ad" ? drill.adsetId : undefined }}
              onDrill={(level, entity) => {
                if (level === "adset") {
                  setDrill({
                    adsetId: entity.adsetId,
                    adsetLabel: entity.adsetName || entity.adsetId,
                  });
                  setGrain("ad");
                } else if (level === "ad" && entity.creativeId) {
                  setCreativeId(entity.creativeId);
                }
              }}
              onClearFilter={() => {
                setDrill({});
                setGrain("adset");
              }}
              onOpenCreative={setCreativeId}
              onShowRecords={() => onTab("sales")}
            />
            <MoreDetails
              label={A ? "كل المواد الإعلانية في الحملة" : "All creatives in this campaign"}
            >
              <CampaignCreativeGallery
                campaignKey={row.campaignKey || row.key}
                campaignName={row.name}
              />
            </MoreDetails>
          </>
        ) : (
          <CampaignCreativeGallery
            campaignKey={row.campaignKey || row.key}
            campaignName={row.name}
          />
        )
      ) : null}

      {tab === "sales" ? (
        campaignId ? (
          <SalesOutcomes
            data={closedLoop.data}
            loading={closedLoop.isLoading}
            recordFilter={{ campaignId, label: row.name }}
            onClearRecordFilter={onBack}
            onOpenCreative={setCreativeId}
          />
        ) : (
          <Card>
            <p className="text-[12.5px] leading-6 text-text-muted">
              {A
                ? "سجلات العملاء بالإسناد الدقيق متاحة لحملات Meta فقط. هذه الحملة تعرض أرقامها أعلاه من مصدر الأداء."
                : "Lead-level records with exact attribution exist for Meta campaigns only. This campaign's figures above come from the performance source."}
            </p>
          </Card>
        )
      ) : null}

      <CreativeDetail creativeId={creativeId} onClose={() => setCreativeId(null)} />
    </PageSections>
  );
}
