import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";
import { AcquisitionPerformance } from "@/components/acquisition/AcquisitionPerformance";
import {
  AssetPerformance,
  ChatwootAttributionHealth,
  ClosedLoopCoverage,
  CreativeDetail,
  GrainPerformance,
  InferredLinkAudit,
  LeadQuality,
  SalesOutcomes,
  useClosedLoop,
} from "@/components/acquisition/ClosedLoop";
import { CreativeGallery } from "@/components/acquisition/CreativeGallery";
import { MessagingReadinessPanel } from "@/components/acquisition/MessagingReadiness";
import {
  BestPerformers,
  CheapVersusQuality,
  DataCoverageCard,
  OverviewKpis,
  SimpleFunnel,
} from "@/components/acquisition/ManagementOverview";
import { DashboardPageHeader, PageSections } from "@/components/dashboard-bits";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { Card, Segmented } from "@/components/ui-bits";
import type { ClosedLoopGrain, GrainRow } from "@/lib/closed-loop";
import { useI18n } from "@/lib/i18n";
import { useReportingPeriod } from "@/lib/use-reporting-period";

/**
 * Acquisition, for managers first.
 *
 * Five sections instead of ten tabs. Every capability of the old tabs is still
 * here, one level down: Ads & Creatives drills Campaign → Ad set → Ad →
 * Creative → Assets; Leads & Quality holds today's intake, lead forms, landing
 * pages and lead quality; Data Coverage keeps the technical diagnostics behind
 * one disclosure. Section and view live in the URL so a view can be shared.
 */

export const SECTIONS = ["overview", "ads", "leads", "sales", "coverage"] as const;
type Section = (typeof SECTIONS)[number];
const AD_VIEWS = ["campaigns", "adsets", "ads", "creatives", "assets"] as const;
const LEAD_VIEWS = ["today", "forms", "landing", "quality"] as const;
type AdView = (typeof AD_VIEWS)[number];
type LeadView = (typeof LEAD_VIEWS)[number];

type AcquisitionSearch = { section?: Section; view?: string };

/** Old tab names keep working as deep links. */
const LEGACY: Record<string, { section: Section; view?: string }> = {
  campaigns: { section: "ads", view: "campaigns" },
  adsets: { section: "ads", view: "adsets" },
  ads: { section: "ads", view: "ads" },
  creatives: { section: "ads", view: "creatives" },
  assets: { section: "ads", view: "assets" },
  forms: { section: "leads", view: "forms" },
  landing: { section: "leads", view: "landing" },
  quality: { section: "leads", view: "quality" },
};

export const Route = createFileRoute("/acquisition")({
  validateSearch: (search: Record<string, unknown>): AcquisitionSearch => {
    const rawSection = typeof search.section === "string" ? search.section : "";
    const rawView = typeof search.view === "string" ? search.view : undefined;
    const legacy = LEGACY[typeof search.tab === "string" ? search.tab : ""];
    if (legacy) return { section: legacy.section, view: legacy.view };
    const section = (SECTIONS as readonly string[]).includes(rawSection)
      ? (rawSection as Section)
      : undefined;
    return { section: section === "overview" ? undefined : section, view: rawView };
  },
  component: Acquisition,
});

type RecordFilter = {
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  creativeId?: string;
  label: string;
};

const GRAIN_OF: Record<Exclude<AdView, "creatives" | "assets">, ClosedLoopGrain> = {
  campaigns: "campaign",
  adsets: "adset",
  ads: "ad",
};

function Acquisition() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const period = useReportingPeriod();
  const navigate = useNavigate({ from: "/acquisition" });
  const search = Route.useSearch();
  const section: Section = search.section ?? "overview";
  const adView: AdView = (AD_VIEWS as readonly string[]).includes(search.view ?? "")
    ? (search.view as AdView)
    : "creatives";
  const leadView: LeadView = (LEAD_VIEWS as readonly string[]).includes(search.view ?? "")
    ? (search.view as LeadView)
    : "today";
  const activeView = section === "ads" ? adView : section === "leads" ? leadView : null;

  /** The route is /acquisition on every section, so Nexus is told which one is open. */
  useRegisterNexusView("acquisition_performance", {
    tab: section,
    parameters: activeView ? { view: activeView } : undefined,
  });

  const closedLoop = useClosedLoop();
  const [grainFilter, setGrainFilter] = useState<{
    campaignId?: string;
    adsetId?: string;
    label?: string;
  }>({});
  const [recordFilter, setRecordFilter] = useState<RecordFilter | null>(null);
  const [creativeId, setCreativeId] = useState<string | null>(null);
  const [creativeTable, setCreativeTable] = useState(false);

  const go = (next: Section, view?: string) =>
    void navigate({
      search: (prev: AcquisitionSearch) => ({
        ...prev,
        section: next === "overview" ? undefined : next,
        view,
      }),
    });

  const drill = (grain: ClosedLoopGrain, row: GrainRow) => {
    if (grain === "campaign") {
      setGrainFilter({ campaignId: row.campaignId, label: row.campaignName || row.campaignId });
      go("ads", "adsets");
    } else if (grain === "adset") {
      setGrainFilter({
        campaignId: row.campaignId,
        adsetId: row.adsetId,
        label: row.adsetName || row.adsetId,
      });
      go("ads", "ads");
    } else if (grain === "ad" && row.creativeId) {
      setCreativeId(row.creativeId);
    }
  };
  const showRecords = (filter: RecordFilter) => {
    setRecordFilter(filter);
    go("sales");
  };

  const sections: { value: Section; label: string }[] = [
    { value: "overview", label: A ? "نظرة عامة" : "Overview" },
    { value: "ads", label: A ? "الإعلانات والمواد" : "Ads & creatives" },
    { value: "leads", label: A ? "العملاء والجودة" : "Leads & quality" },
    { value: "sales", label: A ? "المبيعات والإيراد" : "Sales & revenue" },
    { value: "coverage", label: A ? "تغطية البيانات" : "Data coverage" },
  ];
  const adViews: { value: AdView; label: string }[] = [
    { value: "campaigns", label: A ? "الحملات" : "Campaigns" },
    { value: "adsets", label: A ? "مجموعات الإعلانات" : "Ad sets" },
    { value: "ads", label: A ? "الإعلانات" : "Ads" },
    { value: "creatives", label: A ? "المواد الإعلانية" : "Creatives" },
    { value: "assets", label: A ? "الأصول" : "Assets" },
  ];
  const leadViews: { value: LeadView; label: string }[] = [
    { value: "today", label: A ? "اليوم والفترة" : "Today & period" },
    { value: "forms", label: A ? "نماذج العملاء" : "Lead forms" },
    { value: "landing", label: A ? "صفحات الهبوط" : "Landing pages" },
    { value: "quality", label: A ? "جودة العملاء" : "Lead quality" },
  ];

  const loading = closedLoop.isLoading;
  const data = closedLoop.data;
  const grain =
    section === "ads" && adView in GRAIN_OF ? GRAIN_OF[adView as keyof typeof GRAIN_OF] : null;

  return (
    <PageSections>
      <DashboardPageHeader
        icon={<TrendingUp size={22} />}
        title={A ? "تحليل أداء الاستحواذ" : "Acquisition Performance"}
        subtitle={
          A
            ? "كم صرفنا، كم عميلًا جاء، كم منهم اشترى، وكم دفعوا — لكل حملة ومادة إعلانية."
            : "What we spent, how many leads came, how many bought, and what they paid — for every campaign and creative."
        }
        period={period || (A ? "الشهر الحالي" : "Month to date")}
        tone="violet"
      />
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <Segmented value={section} onChange={(value) => go(value)} options={sections} size="md" />
      </div>
      {closedLoop.error ? (
        <Card padded className="text-sm text-danger">
          {A ? "تعذر تحميل بيانات الربط: " : "The closed-loop data could not load: "}
          {(closedLoop.error as Error).message}
        </Card>
      ) : null}

      {section === "overview" ? (
        <>
          <OverviewKpis data={data} loading={loading} />
          <SimpleFunnel data={data} loading={loading} />
          <BestPerformers data={data} loading={loading} onOpenCreative={setCreativeId} />
          <CheapVersusQuality data={data} loading={loading} onOpenCreative={setCreativeId} />
          <DataCoverageCard data={data} loading={loading} onViewDetails={() => go("coverage")} />
        </>
      ) : null}

      {section === "ads" ? (
        <>
          <div className="-mx-1 overflow-x-auto px-1">
            <Segmented
              value={adView}
              onChange={(value) => {
                // Choosing a level by hand clears a drill-down filter.
                if (value === "campaigns" || value === "creatives" || value === "assets")
                  setGrainFilter({});
                go("ads", value);
              }}
              options={adViews}
            />
          </div>
          {grain ? (
            <GrainPerformance
              data={data}
              loading={loading}
              grain={grain}
              filter={grain === "campaign" ? {} : grainFilter}
              onDrill={drill}
              onClearFilter={() => setGrainFilter({})}
              onOpenCreative={setCreativeId}
              onShowRecords={showRecords}
            />
          ) : null}
          {adView === "creatives" && !creativeTable ? (
            <CreativeGallery
              data={data}
              loading={loading}
              onOpenCreative={setCreativeId}
              onShowTable={() => setCreativeTable(true)}
            />
          ) : null}
          {adView === "creatives" && creativeTable ? (
            <>
              <button
                type="button"
                onClick={() => setCreativeTable(false)}
                className="self-start text-xs font-semibold text-brand hover:underline"
              >
                {A ? "عرض كصور" : "Show as cards"}
              </button>
              <GrainPerformance
                data={data}
                loading={loading}
                grain="creative"
                filter={{}}
                onDrill={drill}
                onClearFilter={() => setGrainFilter({})}
                onOpenCreative={setCreativeId}
                onShowRecords={showRecords}
              />
            </>
          ) : null}
          {adView === "assets" ? (
            <AssetPerformance data={data} loading={loading} onOpenCreative={setCreativeId} />
          ) : null}
        </>
      ) : null}

      {section === "leads" ? (
        <>
          <div className="-mx-1 overflow-x-auto px-1">
            <Segmented
              value={leadView}
              onChange={(value) => go("leads", value)}
              options={leadViews}
            />
          </div>
          {leadView === "today" ? <AcquisitionPerformance view="today" /> : null}
          {leadView === "forms" ? <AcquisitionPerformance view="forms" /> : null}
          {leadView === "landing" ? <AcquisitionPerformance view="landing" /> : null}
          {leadView === "quality" ? (
            <>
              <CheapVersusQuality data={data} loading={loading} onOpenCreative={setCreativeId} />
              <LeadQuality data={data} loading={loading} onOpenCreative={setCreativeId} />
            </>
          ) : null}
        </>
      ) : null}

      {section === "sales" ? (
        <SalesOutcomes
          data={data}
          loading={loading}
          recordFilter={recordFilter}
          onClearRecordFilter={() => setRecordFilter(null)}
          onOpenCreative={setCreativeId}
        />
      ) : null}

      {section === "coverage" ? (
        <>
          <DataCoverageCard data={data} loading={loading} />
          <details className="group card overflow-hidden">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-text [&::-webkit-details-marker]:hidden">
              {A ? "عرض التفاصيل التقنية" : "View technical details"}
            </summary>
            <div className="space-y-6 border-t border-border p-3 sm:p-5">
              <AcquisitionPerformance
                view="technical"
                before={<ClosedLoopCoverage data={data} loading={loading} />}
              />
              <MessagingReadinessPanel />
              <ChatwootAttributionHealth />
              <InferredLinkAudit />
            </div>
          </details>
        </>
      ) : null}

      <CreativeDetail creativeId={creativeId} onClose={() => setCreativeId(null)} />
    </PageSections>
  );
}
