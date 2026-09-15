import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Image, TrendingUp } from "lucide-react";
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
  CoverageTechnicalDetails,
  DataCoverageCard,
  OverviewKpis,
  SimpleFunnel,
} from "@/components/acquisition/ManagementOverview";
import {
  DashboardPageHeader,
  DrilldownBreadcrumb,
  MoreDetails,
  PageSections,
  ViewSelect,
} from "@/components/dashboard-bits";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { Card } from "@/components/ui-bits";
import type { ClosedLoopGrain, GrainRow } from "@/lib/closed-loop";
import { useI18n } from "@/lib/i18n";
import { ACQUISITION_SECTIONS } from "@/lib/navigation";
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

export const SECTIONS = ACQUISITION_SECTIONS.map((entry) => entry.value);
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
    campaignLabel?: string;
    adsetLabel?: string;
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
      const campaignLabel = row.campaignName || row.campaignId;
      setGrainFilter({ campaignId: row.campaignId, label: campaignLabel, campaignLabel });
      go("ads", "adsets");
    } else if (grain === "adset") {
      const adsetLabel = row.adsetName || row.adsetId;
      setGrainFilter((previous) => ({
        campaignId: row.campaignId,
        adsetId: row.adsetId,
        label: adsetLabel,
        campaignLabel: previous.campaignLabel ?? (row.campaignName || row.campaignId),
        adsetLabel,
      }));
      go("ads", "ads");
    } else if (grain === "ad" && row.creativeId) {
      setCreativeId(row.creativeId);
    }
  };
  const showRecords = (filter: RecordFilter) => {
    setRecordFilter(filter);
    go("sales");
  };

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

  const heading: Record<Section, { title: string; subtitle: string }> = {
    overview: {
      title: A ? "التسويق" : "Marketing",
      subtitle: A
        ? "كم صرفنا، كم عميلًا جاء، كم منهم اشترى، وكم دفعوا."
        : "What we spent, how many leads came, how many bought and what they paid.",
    },
    ads: grain
      ? {
          title: A ? "الحملات بالإسناد الدقيق" : "Campaigns by exact attribution",
          subtitle: A
            ? "افتح حملة لترى مجموعاتها، ثم إعلاناتها، ثم المادة الإعلانية."
            : "Open a campaign to see its ad sets, then its ads, then the creative.",
        }
      : {
          title: A ? "المواد الإعلانية" : "Creatives",
          subtitle: A
            ? "كل مادة إعلانية بإنفاقها وعملائها ومبيعاتها. اضغط أي مادة للتفاصيل."
            : "Every creative with its spend, leads and sales. Open one for the full story.",
        },
    leads: {
      title: A ? "مصادر العملاء" : "Lead sources",
      subtitle: A
        ? "من أين جاء العملاء وجودتهم."
        : "Where leads came from, and how good they were.",
    },
    sales: {
      title: A ? "سجلات المبيعات المرتبطة" : "Linked sales records",
      subtitle: A ? "كل عميل من إعلانه حتى الفاتورة." : "Every lead from its ad to its invoice.",
    },
    coverage: {
      title: A ? "تغطية البيانات" : "Data coverage",
      subtitle: A
        ? "دقة الربط وحالة المصادر — للمراجعة التقنية."
        : "Attribution accuracy and source health — for technical review.",
    },
  };

  const breadcrumb =
    grain === null
      ? null
      : [
          {
            key: "campaigns",
            label: A ? "كل الحملات" : "All campaigns",
            onSelect:
              grain === "campaign"
                ? undefined
                : () => {
                    setGrainFilter({});
                    go("ads", "campaigns");
                  },
          },
          ...(grain !== "campaign"
            ? [
                {
                  key: "campaign",
                  label: grainFilter.campaignLabel ?? (A ? "كل المجموعات" : "All ad sets"),
                  onSelect:
                    grain === "ad" && grainFilter.campaignId
                      ? () => {
                          setGrainFilter({
                            campaignId: grainFilter.campaignId,
                            label: grainFilter.campaignLabel,
                            campaignLabel: grainFilter.campaignLabel,
                          });
                          go("ads", "adsets");
                        }
                      : undefined,
                },
              ]
            : []),
          ...(grain === "ad"
            ? [
                {
                  key: "adset",
                  label: grainFilter.adsetLabel ?? (A ? "كل الإعلانات" : "All ads"),
                },
              ]
            : []),
        ];

  return (
    <PageSections>
      <DashboardPageHeader
        icon={section === "ads" && !grain ? <Image size={20} /> : <TrendingUp size={20} />}
        title={heading[section].title}
        subtitle={heading[section].subtitle}
        period={period || (A ? "الشهر الحالي" : "Month to date")}
      />
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
          <MoreDetails
            label={A ? "تحليل إضافي" : "More analysis"}
            hint={
              A
                ? "الأرخص مقابل الأفضل جودة، وملخص تغطية البيانات"
                : "Cheapest against best quality, and the data coverage summary"
            }
          >
            <CheapVersusQuality data={data} loading={loading} onOpenCreative={setCreativeId} />
            <DataCoverageCard data={data} loading={loading} onViewDetails={() => go("coverage")} />
          </MoreDetails>
        </>
      ) : null}

      {section === "ads" ? (
        <>
          {breadcrumb ? (
            <DrilldownBreadcrumb steps={breadcrumb} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ViewSelect
                label={A ? "العرض" : "Show"}
                value={adView === "assets" ? "assets" : creativeTable ? "table" : "cards"}
                options={[
                  { value: "cards", label: A ? "صور المواد" : "Creative cards" },
                  { value: "table", label: A ? "جدول المواد" : "Creative table" },
                  {
                    value: "assets",
                    label: A ? "الأصول (فيديو وصور)" : "Assets (video and images)",
                  },
                ]}
                onChange={(value) => {
                  if (value === "assets") {
                    go("ads", "assets");
                    return;
                  }
                  setCreativeTable(value === "table");
                  if (adView !== "creatives") go("ads", "creatives");
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setGrainFilter({});
                  go("ads", "campaigns");
                }}
                className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-brand hover:bg-brand-soft"
              >
                {A ? "تتبّع من الحملة للمادة" : "Drill down from campaign to creative"}
                {A ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
              </button>
            </div>
          )}
          {grain ? (
            <GrainPerformance
              data={data}
              loading={loading}
              grain={grain}
              filter={grain === "campaign" ? {} : grainFilter}
              onDrill={drill}
              onClearFilter={() => {
                setGrainFilter({});
                go("ads", "campaigns");
              }}
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
          ) : null}
          {adView === "assets" ? (
            <AssetPerformance data={data} loading={loading} onOpenCreative={setCreativeId} />
          ) : null}
        </>
      ) : null}

      {section === "leads" ? (
        <>
          <ViewSelect
            label={A ? "العرض" : "Show"}
            value={leadView}
            options={leadViews}
            onChange={(value) => go("leads", value)}
          />
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
              <CoverageTechnicalDetails data={data} loading={loading} />
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
