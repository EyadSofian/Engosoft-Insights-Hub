import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";
import { AcquisitionPerformance } from "@/components/acquisition/AcquisitionPerformance";
import {
  AssetPerformance,
  ClosedLoopCoverage,
  ClosedLoopFunnel,
  CreativeDetail,
  GrainPerformance,
  LeadQuality,
  SalesOutcomes,
  useClosedLoop,
} from "@/components/acquisition/ClosedLoop";
import { DashboardPageHeader, PageSections } from "@/components/dashboard-bits";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { Card, Segmented } from "@/components/ui-bits";
import type { ClosedLoopGrain, GrainRow } from "@/lib/closed-loop";
import { useI18n } from "@/lib/i18n";
import { useReportingPeriod } from "@/lib/use-reporting-period";

export const Route = createFileRoute("/acquisition")({ component: Acquisition });

type RecordFilter = {
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  creativeId?: string;
  label: string;
};

const GRAIN_TAB = {
  campaigns: "campaign",
  adsets: "adset",
  ads: "ad",
  creatives: "creative",
} as const satisfies Record<string, ClosedLoopGrain>;

function Acquisition() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const period = useReportingPeriod();
  const [tab, setTab] = useState<
    | "overview"
    | "campaigns"
    | "adsets"
    | "ads"
    | "creatives"
    | "assets"
    | "forms"
    | "landing"
    | "quality"
    | "sales"
  >("overview");
  /** The tab and the route stay separate: the route is /acquisition on every tab. */
  useRegisterNexusView("acquisition_performance", { tab });

  const closedLoop = useClosedLoop();
  const [grainFilter, setGrainFilter] = useState<{
    campaignId?: string;
    adsetId?: string;
    label?: string;
  }>({});
  const [recordFilter, setRecordFilter] = useState<RecordFilter | null>(null);
  const [creativeId, setCreativeId] = useState<string | null>(null);

  const drill = (grain: ClosedLoopGrain, row: GrainRow) => {
    if (grain === "campaign") {
      setGrainFilter({ campaignId: row.campaignId, label: row.campaignName || row.campaignId });
      setTab("adsets");
    } else if (grain === "adset") {
      setGrainFilter({
        campaignId: row.campaignId,
        adsetId: row.adsetId,
        label: row.adsetName || row.adsetId,
      });
      setTab("ads");
    } else if (grain === "ad" && row.creativeId) {
      setCreativeId(row.creativeId);
    }
  };
  const showRecords = (filter: RecordFilter) => {
    setRecordFilter(filter);
    setTab("sales");
  };

  const tabs = [
    { value: "overview", label: A ? "نظرة عامة" : "Overview" },
    { value: "campaigns", label: A ? "الحملات" : "Campaigns" },
    { value: "adsets", label: A ? "مجموعات الإعلانات" : "Ad sets" },
    { value: "ads", label: A ? "الإعلانات" : "Ads" },
    { value: "creatives", label: A ? "المواد الإعلانية" : "Creatives" },
    { value: "assets", label: A ? "الأصول" : "Assets" },
    { value: "forms", label: A ? "نماذج العملاء" : "Lead forms" },
    { value: "landing", label: A ? "صفحات الهبوط" : "Landing pages" },
    { value: "quality", label: A ? "جودة العملاء" : "Lead quality" },
    { value: "sales", label: A ? "نتائج المبيعات" : "Sales outcomes" },
  ] as const;

  const grain = tab in GRAIN_TAB ? GRAIN_TAB[tab as keyof typeof GRAIN_TAB] : null;

  return (
    <PageSections>
      <DashboardPageHeader
        icon={<TrendingUp size={22} />}
        title={A ? "تحليل أداء الاستحواذ" : "Acquisition Performance"}
        subtitle={
          A
            ? "من الإعلان إلى الإيراد: الحملة ومجموعة الإعلان والإعلان والمادة، ثم العميل في CRM وعرض السعر والفوز والفاتورة المدفوعة. بالمعرّف الدقيق فقط."
            : "From ad to revenue: campaign, ad set, ad and creative, then the CRM lead, quotation, win and paid invoice. Exact IDs only."
        }
        period={period || (A ? "الشهر الحالي" : "Month to date")}
        tone="violet"
      />
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <Segmented
          value={tab}
          onChange={(value) => {
            // Switching tabs by hand clears a drill-down, so a filter never
            // follows the user somewhere they did not ask it to.
            if (value === "campaigns" || value === "creatives") setGrainFilter({});
            setTab(value);
          }}
          options={tabs.map((t) => ({ value: t.value, label: t.label }))}
          size="md"
        />
      </div>
      {closedLoop.error && tab !== "overview" && tab !== "forms" && tab !== "landing" ? (
        <Card padded className="text-sm text-danger">
          {A ? "تعذر تحميل الربط المغلق: " : "Closed-loop data could not load: "}
          {(closedLoop.error as Error).message}
        </Card>
      ) : null}

      {tab === "overview" ? (
        <AcquisitionPerformance
          view="overview"
          before={
            <>
              <ClosedLoopCoverage data={closedLoop.data} loading={closedLoop.isLoading} />
              <ClosedLoopFunnel data={closedLoop.data} loading={closedLoop.isLoading} />
            </>
          }
        />
      ) : null}
      {grain ? (
        <>
          <ClosedLoopCoverage data={closedLoop.data} loading={closedLoop.isLoading} />
          <GrainPerformance
            data={closedLoop.data}
            loading={closedLoop.isLoading}
            grain={grain}
            filter={grain === "campaign" || grain === "creative" ? {} : grainFilter}
            onDrill={drill}
            onClearFilter={() => setGrainFilter({})}
            onOpenCreative={setCreativeId}
            onShowRecords={showRecords}
          />
        </>
      ) : null}
      {tab === "assets" ? (
        <AssetPerformance
          data={closedLoop.data}
          loading={closedLoop.isLoading}
          onOpenCreative={setCreativeId}
        />
      ) : null}
      {tab === "forms" ? <AcquisitionPerformance view="forms" /> : null}
      {tab === "landing" ? <AcquisitionPerformance view="landing" /> : null}
      {tab === "quality" ? (
        <LeadQuality
          data={closedLoop.data}
          loading={closedLoop.isLoading}
          onOpenCreative={setCreativeId}
        />
      ) : null}
      {tab === "sales" ? (
        <SalesOutcomes
          data={closedLoop.data}
          loading={closedLoop.isLoading}
          recordFilter={recordFilter}
          onClearRecordFilter={() => setRecordFilter(null)}
          onOpenCreative={setCreativeId}
        />
      ) : null}
      <CreativeDetail creativeId={creativeId} onClose={() => setCreativeId(null)} />
    </PageSections>
  );
}
