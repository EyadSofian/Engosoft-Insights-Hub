import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  FileCheck2,
  Filter,
  Globe2,
  MousePointerClick,
  Send,
  ShieldCheck,
} from "lucide-react";
import { HBarChart, MultiLineChart } from "@/components/charts";
import { DataTable, type Col } from "@/components/DataTable";
import {
  DashboardPageHeader,
  KpiRow,
  PageSection,
  PageSections,
} from "@/components/dashboard-bits";
import { Card, Pill, SectionTitle } from "@/components/ui-bits";
import { FunnelBars } from "@/components/ui-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { topRows, type MetricBreakdownRow, type MetricDetail } from "@/lib/metric-detail";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/landing-pages")({ component: LandingPages });

interface BreakdownRow {
  views: number;
  uniqueVisitors: number;
  formStarts: number;
  submissions: number;
}

interface LandingPageRow extends BreakdownRow {
  landingPageId: string;
  landingPageName: string;
  landingPageSlug: string;
  topSource: string;
  topCampaign: string;
  viewToSubmissionRate: number | null;
}

interface LandingSummary {
  configured: boolean;
  touch?: "first" | "latest";
  totals: {
    views: number;
    uniqueVisitors: number;
    sessions: number;
    formStarts: number;
    submissions: number;
    viewToStartRate: number | null;
    viewToSubmissionRate: number | null;
    startToSubmissionRate: number | null;
  } | null;
  landingPages: LandingPageRow[];
  sources: (BreakdownRow & { source: string })[];
  mediums: (BreakdownRow & { medium: string })[];
  campaigns: (BreakdownRow & { campaign: string })[];
  contents: (BreakdownRow & { content: string })[];
  referrers: (BreakdownRow & { referrerType: string })[];
  trend: { date: string; views: number; formStarts: number; submissions: number }[];
  quality: {
    eventsReceived: number;
    eventsRejected: number;
    duplicateDeliveries: number;
    sessionsWithoutAttribution: number;
    submissionsWithoutPriorView: number;
    utmCoveredSessions: number;
    directSessions: number;
    unknownSessions: number;
  } | null;
}

/** The summary API returns ratios (0–1); `fmtPct` formats values already in percent. */
function ratioPct(value: number | null | undefined): string {
  return fmtPct(value === null || value === undefined ? value : value * 100, 1);
}

function dateBefore(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function filterInput(
  value: string,
  onChange: (value: string) => void,
  placeholder: string,
  label: string,
) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className="min-h-10 min-w-0 rounded-xl border border-border bg-surface px-3 text-xs text-text outline-none transition focus:border-brand"
    />
  );
}

function LandingPages() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const [from, setFrom] = useState(() => dateBefore(29));
  const [to, setTo] = useState(() => dateBefore(0));
  const [landingPageId, setLandingPageId] = useState("");
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [touch, setTouch] = useState<"first" | "latest">("first");
  const query = useMemo(() => {
    const params = new URLSearchParams({ from, to, touch });
    for (const [key, value] of Object.entries({
      landingPageId,
      source,
      medium,
      campaign,
      content,
    })) {
      if (value.trim()) params.set(key, value.trim());
    }
    return params.toString();
  }, [from, to, touch, landingPageId, source, medium, campaign, content]);
  const summary = useQuery<LandingSummary>({
    queryKey: ["landing-attribution-summary", query],
    queryFn: async () => {
      const response = await fetch(`/api/landing-attribution/summary?${query}`);
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return response.json();
    },
    staleTime: 30_000,
  });
  const data = summary.data;
  const totals = data?.totals;
  const quality = data?.quality;
  // The page declares which attribution basis it is showing, so "اشرحلي التاب
  // دي" resolves against first-touch or latest-touch rather than guessing.
  useRegisterNexusView("landing_pages", { tab: touch });

  /**
   * The five headline figures, each able to explain itself.
   *
   * Every breakdown and the trend come out of the same `summary` response the
   * cards were rendered from, so opening a figure costs no request and can
   * never disagree with the number above it.
   */
  const figures = useMemo((): Record<string, MetricDetail> => {
    const pageRows = (metric: (row: LandingPageRow) => number): MetricBreakdownRow[] =>
      (data?.landingPages ?? []).map((row) => ({
        key: row.landingPageId,
        label: row.landingPageName || row.landingPageSlug || row.landingPageId,
        value: metric(row),
        display: fmtNum(metric(row)),
        meta: row.landingPageSlug || undefined,
      }));
    const sourceRows = (metric: (row: BreakdownRow) => number): MetricBreakdownRow[] =>
      (data?.sources ?? []).map((row) => ({
        key: row.source,
        label: row.source || (A ? "غير محدد" : "Unset"),
        value: metric(row),
        display: fmtNum(metric(row)),
      }));
    const byPage = (title: string, metric: (row: LandingPageRow) => number) => ({
      id: "pages",
      title,
      rows: topRows(pageRows(metric)),
      emptyLabel: A ? "لا توجد صفحات في الفترة." : "No pages in this window.",
    });
    const bySource = (title: string, metric: (row: BreakdownRow) => number) => ({
      id: "sources",
      title,
      hint: A
        ? "المصدر كما وصل في الـUTM؛ الناقص يبقى غير محدد ولا يُخمَّن."
        : "The source as the UTM delivered it; what is missing stays unset and is never guessed.",
      rows: topRows(sourceRows(metric)),
    });
    const basis = A
      ? touch === "first"
        ? "منسوب لأول لمسة وصلت الزائر."
        : "منسوب لآخر لمسة قبل الإرسال."
      : touch === "first"
        ? "Credited to the first touch that brought the visitor."
        : "Credited to the latest touch before submission.";
    const trendFor = (key: "views" | "formStarts" | "submissions", label: string) => ({
      points: (data?.trend ?? []).map((row) => ({ date: row.date, value: row[key] })),
      label,
      format: (value: number) => fmtNum(value),
    });
    return {
      views: {
        id: "landing_pages.views",
        title: A ? "المشاهدات" : "Views",
        value: fmtNum(totals?.views),
        tone: "sky",
        icon: <MousePointerClick size={17} />,
        definition: A
          ? `أحداث مشاهدة صفحة الهبوط المسجلة في الفترة. ${basis}`
          : `Recorded landing-page view events in the window. ${basis}`,
        trend: trendFor("views", A ? "مشاهدات" : "Views"),
        breakdowns: [
          byPage(A ? "أعلى الصفحات مشاهدة" : "Most viewed pages", (row) => row.views),
          bySource(A ? "المشاهدات حسب المصدر" : "Views by source", (row) => row.views),
        ],
      },
      visitors: {
        id: "landing_pages.views",
        title: A ? "زوار فريدون" : "Unique visitors",
        value: fmtNum(totals?.uniqueVisitors),
        tone: "violet",
        icon: <Globe2 size={17} />,
        definition: A
          ? "عدد المتصفحات المختلفة التي شاهدت الصفحة. المعرّف معرّف متصفح وليس بيانات شخصية."
          : "How many distinct browsers viewed the page. The identifier is a browser identifier, not personal data.",
        caveat: A
          ? "متصفح واحد على جهازين يُحسب زائرين، وجهاز مشترك يُحسب زائرًا واحدًا."
          : "One person on two devices counts twice; a shared device counts once.",
        supporting: [
          {
            key: "sessions",
            label: A ? "السيشنات" : "Sessions",
            value: fmtNum(totals?.sessions),
          },
          {
            key: "views",
            label: A ? "المشاهدات" : "Views",
            value: fmtNum(totals?.views),
          },
        ],
        breakdowns: [
          byPage(A ? "الزوار حسب الصفحة" : "Visitors by page", (row) => row.uniqueVisitors),
        ],
      },
      formStarts: {
        id: "landing_pages.submissions",
        title: A ? "بدء الفورم" : "Form starts",
        value: fmtNum(totals?.formStarts),
        tone: "amber",
        icon: <FileCheck2 size={17} />,
        definition: A
          ? "عدد المرات التي بدأ فيها الزائر تعبئة الفورم دون أن يكون أرسله بالضرورة."
          : "How many times a visitor began filling the form, whether or not they submitted it.",
        formula: `${A ? "مشاهدة ← بدء" : "View → start"} = ${fmtNum(totals?.formStarts)} ÷ ${fmtNum(totals?.views)} = ${ratioPct(totals?.viewToStartRate)}`,
        trend: trendFor("formStarts", A ? "بدء الفورم" : "Form starts"),
        breakdowns: [
          byPage(A ? "بدء الفورم حسب الصفحة" : "Form starts by page", (row) => row.formStarts),
        ],
      },
      submissions: {
        id: "landing_pages.submissions",
        title: A ? "الإرسالات" : "Submissions",
        value: fmtNum(totals?.submissions),
        tone: "mint",
        icon: <Send size={17} />,
        definition: A
          ? `الفورمات المُرسلة فعلًا من صفحات الهبوط. ${basis}`
          : `Forms actually submitted from the landing pages. ${basis}`,
        formula: `${A ? "بدء ← إرسال" : "Start → submit"} = ${fmtNum(totals?.submissions)} ÷ ${fmtNum(totals?.formStarts)} = ${ratioPct(totals?.startToSubmissionRate)}`,
        trend: trendFor("submissions", A ? "إرسالات" : "Submissions"),
        breakdowns: [
          byPage(A ? "الإرسالات حسب الصفحة" : "Submissions by page", (row) => row.submissions),
          bySource(A ? "الإرسالات حسب المصدر" : "Submissions by source", (row) => row.submissions),
        ],
      },
      conversion: {
        id: "landing_pages.submissions",
        title: A ? "تحويل المشاهدة" : "View CVR",
        value: ratioPct(totals?.viewToSubmissionRate),
        tone: "rose",
        icon: <BarChart3 size={17} />,
        definition: A
          ? "نسبة المشاهدات التي انتهت بإرسال فورم، وهي ما يفصل مشكلة جذب الزيارة عن مشكلة الفورم نفسه."
          : "The share of views that ended in a submitted form — what separates a traffic problem from a form problem.",
        formula: `${fmtNum(totals?.submissions)} ÷ ${fmtNum(totals?.views)} = ${ratioPct(totals?.viewToSubmissionRate)}`,
        supporting: [
          {
            key: "viewToStart",
            label: A ? "مشاهدة ← بدء" : "View → start",
            value: ratioPct(totals?.viewToStartRate),
          },
          {
            key: "startToSubmit",
            label: A ? "بدء ← إرسال" : "Start → submit",
            value: ratioPct(totals?.startToSubmissionRate),
          },
        ],
        breakdowns: [
          {
            id: "pageCvr",
            title: A ? "أعلى الصفحات تحويلًا" : "Best converting pages",
            hint: A
              ? "الصفحات التي لها مشاهدات فقط؛ الصفحة بلا مشاهدة ليس لها نسبة."
              : "Only pages with views; a page with none has no rate.",
            rows: topRows(
              (data?.landingPages ?? [])
                .filter((row) => row.views > 0)
                .map((row) => ({
                  key: row.landingPageId,
                  label: row.landingPageName || row.landingPageId,
                  value: (row.viewToSubmissionRate ?? 0) * 100,
                  display: ratioPct(row.viewToSubmissionRate),
                  meta: `${fmtNum(row.views)} ${A ? "مشاهدة" : "views"}`,
                })),
            ),
          },
        ],
      },
    };
  }, [A, data, totals, touch]);
  const cols: Col<LandingPageRow>[] = [
    {
      key: "page",
      header: A ? "صفحة الهبوط" : "Landing page",
      always: true,
      sticky: true,
      render: (row) => (
        <div>
          <div className="font-semibold text-text">{row.landingPageName}</div>
          <div className="mt-0.5 text-[12px] text-text-muted">
            {row.landingPageSlug || row.landingPageId}
          </div>
        </div>
      ),
      sortValue: (row) => row.landingPageName,
    },
    {
      key: "views",
      header: A ? "المشاهدات" : "Views",
      align: "right",
      render: (row) => fmtNum(row.views),
      sortValue: (row) => row.views,
    },
    {
      key: "visitors",
      header: A ? "زوار فريدون" : "Unique visitors",
      align: "right",
      render: (row) => fmtNum(row.uniqueVisitors),
      sortValue: (row) => row.uniqueVisitors,
    },
    {
      key: "starts",
      header: A ? "بدء الفورم" : "Form starts",
      align: "right",
      render: (row) => fmtNum(row.formStarts),
      sortValue: (row) => row.formStarts,
    },
    {
      key: "submissions",
      header: A ? "إرسالات" : "Submissions",
      align: "right",
      render: (row) => fmtNum(row.submissions),
      sortValue: (row) => row.submissions,
    },
    {
      key: "cvr",
      header: A ? "تحويل المشاهدة" : "View CVR",
      align: "right",
      render: (row) => ratioPct(row.viewToSubmissionRate),
      sortValue: (row) => row.viewToSubmissionRate ?? -1,
    },
    {
      key: "source",
      header: A ? "أعلى مصدر" : "Top source",
      render: (row) => row.topSource,
      sortValue: (row) => row.topSource,
    },
    {
      key: "campaign",
      header: A ? "أعلى حملة" : "Top campaign",
      render: (row) => row.topCampaign,
      sortValue: (row) => row.topCampaign,
    },
  ];

  return (
    <PageSections>
      <DashboardPageHeader
        icon={<Globe2 size={22} />}
        title={A ? "تحليلات صفحات الهبوط" : "Landing page analytics"}
        subtitle={
          A
            ? "تتبع مستقل داخل Insights Hub: مصدر الزيارة ومسار الفورم، من دون قراءة أو كتابة في Odoo."
            : "Independent Insights Hub tracking: visit source and form funnel, with no Odoo reads or writes."
        }
        period={`${from} — ${to}`}
        tone="sky"
      />

      <PageSection
        level="insight"
        title={A ? "فلاتر التقرير" : "Report filters"}
        icon={<Filter size={16} />}
        tone="sky"
      >
        <Card className="space-y-3" padded>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-[12px] font-semibold text-text-muted">
              {A ? "من" : "From"}
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="min-h-10 rounded-xl border border-border bg-surface px-3 text-xs text-text outline-none focus:border-brand"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold text-text-muted">
              {A ? "إلى" : "To"}
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="min-h-10 rounded-xl border border-border bg-surface px-3 text-xs text-text outline-none focus:border-brand"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold text-text-muted">
              {A ? "منظور اللمسة" : "Touch view"}
              <select
                value={touch}
                onChange={(event) => setTouch(event.target.value === "latest" ? "latest" : "first")}
                className="min-h-10 rounded-xl border border-border bg-surface px-3 text-xs text-text outline-none focus:border-brand"
              >
                <option value="first">{A ? "أول لمسة" : "First touch"}</option>
                <option value="latest">{A ? "آخر لمسة" : "Latest touch"}</option>
              </select>
            </label>
            <div className="grid gap-1 text-[12px] font-semibold text-text-muted">
              <span>{A ? "معرّف الصفحة" : "Page ID"}</span>
              {filterInput(
                landingPageId,
                setLandingPageId,
                A ? "مثال: ai-services" : "e.g. ai-services",
                A ? "معرّف الصفحة" : "Page ID",
              )}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {filterInput(source, setSource, "utm_source", A ? "المصدر" : "Source")}
            {filterInput(medium, setMedium, "utm_medium", A ? "الوسيط" : "Medium")}
            {filterInput(campaign, setCampaign, "utm_campaign", A ? "الحملة" : "Campaign")}
            {filterInput(content, setContent, "utm_content", A ? "المحتوى" : "Content")}
          </div>
          <p className="text-[12px] leading-relaxed text-text-muted">
            {A
              ? "المصدر fb وig فقط يُوحّدان إلى facebook وinstagram. الحقول الناقصة تبقى غير محددة ولا تُخمن."
              : "Only fb→facebook and ig→instagram are normalized. Missing fields stay unset; they are never guessed."}
          </p>
        </Card>
      </PageSection>

      <PageSection level="headline" aria-label={A ? "مؤشرات صفحات الهبوط" : "Landing page metrics"}>
        <KpiRow>
          <MetricDetailTrigger
            detail={figures.views!}
            card={{
              index: 0,
              loading: summary.isLoading,
              sub: A ? "أحداث مشاهدة مسجلة" : "Recorded page-view events",
            }}
          />
          <MetricDetailTrigger
            detail={figures.visitors!}
            card={{
              index: 1,
              loading: summary.isLoading,
              sub: A ? "معرّف المتصفح، وليس بيانات شخصية" : "Browser identifier, not PII",
            }}
          />
          <MetricDetailTrigger
            detail={figures.formStarts!}
            card={{
              index: 2,
              loading: summary.isLoading,
              sub: `${A ? "مشاهدة ← بدء" : "View → start"}: ${ratioPct(totals?.viewToStartRate)}`,
            }}
          />
          <MetricDetailTrigger
            detail={figures.submissions!}
            card={{
              index: 3,
              loading: summary.isLoading,
              sub: `${A ? "بدء ← إرسال" : "Start → submit"}: ${ratioPct(totals?.startToSubmissionRate)}`,
            }}
          />
          <MetricDetailTrigger
            detail={figures.conversion!}
            card={{
              index: 4,
              loading: summary.isLoading,
              sub: A ? "الإرسالات ÷ المشاهدات" : "Submissions ÷ views",
            }}
          />
        </KpiRow>
      </PageSection>

      {!data?.configured && !summary.isLoading ? (
        <Card className="border-amber-500/20 bg-amber-500/5 text-sm text-text-muted">
          {A
            ? "قاعدة بيانات Insights غير مهيأة بعد. لا يوجد مسار فورم تم تغييره أو بديل تم تشغيله."
            : "The Insights database is not configured yet. No form flow has been changed or replaced."}
        </Card>
      ) : (
        <>
          <PageSection
            title={A ? "مسار صفحة الهبوط إلى الإرسال" : "Landing page-to-submission funnel"}
            icon={<MousePointerClick size={16} />}
            tone="mint"
          >
            <Card>
              <FunnelBars
                steps={[
                  {
                    label: A ? "المشاهدات" : "Views",
                    value: totals?.views || 0,
                    display: fmtNum(totals?.views),
                    accent: true,
                  },
                  {
                    label: A ? "بدء الفورم" : "Form starts",
                    value: totals?.formStarts || 0,
                    display: fmtNum(totals?.formStarts),
                  },
                  {
                    label: A ? "الإرسالات" : "Submissions",
                    value: totals?.submissions || 0,
                    display: fmtNum(totals?.submissions),
                  },
                ]}
              />
            </Card>
          </PageSection>

          <PageSection
            title={A ? "الاتجاه اليومي" : "Daily trend"}
            icon={<BarChart3 size={16} />}
            tone="violet"
          >
            <Card>
              <MultiLineChart
                data={data?.trend || []}
                series={[
                  { key: "views", name: A ? "مشاهدات" : "Views", color: "var(--sky-strong)" },
                  {
                    key: "formStarts",
                    name: A ? "بدء الفورم" : "Form starts",
                    color: "var(--amber-strong)",
                  },
                  {
                    key: "submissions",
                    name: A ? "إرسالات" : "Submissions",
                    color: "var(--mint-strong)",
                  },
                ]}
                format={fmtNum}
              />
            </Card>
          </PageSection>

          <PageSection
            title={A ? "المصادر والحملات" : "Sources and campaigns"}
            icon={<BarChart3 size={16} />}
            tone="sky"
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <SectionTitle>
                  {A ? "المصادر حسب الإرسالات" : "Sources by submissions"}
                </SectionTitle>
                <HBarChart
                  data={(data?.sources || [])
                    .slice(0, 10)
                    .map((row) => ({ label: row.source, value: row.submissions }))}
                  format={fmtNum}
                  name={A ? "إرسالات" : "Submissions"}
                  color="var(--chart-2)"
                  showValues
                />
              </Card>
              <Card>
                <SectionTitle>
                  {A ? "الحملات حسب الإرسالات" : "Campaigns by submissions"}
                </SectionTitle>
                <HBarChart
                  data={(data?.campaigns || [])
                    .slice(0, 10)
                    .map((row) => ({ label: row.campaign, value: row.submissions }))}
                  format={fmtNum}
                  name={A ? "إرسالات" : "Submissions"}
                  color="var(--chart-4)"
                  showValues
                />
              </Card>
            </div>
          </PageSection>

          <PageSection
            level="records"
            title={A ? "تفاصيل صفحات الهبوط" : "Landing page details"}
            hint={
              A
                ? "المصدر والحملة الأعلى من اللمسة المحددة، دون دمج مع بيانات CRM."
                : "Top source and campaign for the selected touch, without any CRM data merge."
            }
          >
            <DataTable
              rows={data?.landingPages || []}
              cols={cols}
              loading={summary.isLoading}
              searchable={(row) =>
                `${row.landingPageName} ${row.landingPageId} ${row.topSource} ${row.topCampaign}`
              }
              rowKey={(row) => row.landingPageId}
              csvFilename="engosoft-landing-page-attribution.csv"
            />
          </PageSection>

          <PageSection
            title={A ? "سلامة التتبع" : "Tracking quality"}
            icon={<ShieldCheck size={16} />}
            tone="amber"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card padded className="space-y-1">
                <div className="text-xs text-text-muted">
                  {A ? "الأحداث المستلمة" : "Events received"}
                </div>
                <div className="num text-2xl font-bold text-text">
                  {fmtNum(quality?.eventsReceived)}
                </div>
              </Card>
              <Card padded className="space-y-1">
                <div className="text-xs text-text-muted">{A ? "المرفوضة" : "Rejected"}</div>
                <div className="num text-2xl font-bold text-text">
                  {fmtNum(quality?.eventsRejected)}
                </div>
              </Card>
              <Card padded className="space-y-1">
                <div className="text-xs text-text-muted">
                  {A ? "تسليمات مكررة" : "Duplicate deliveries"}
                </div>
                <div className="num text-2xl font-bold text-text">
                  {fmtNum(quality?.duplicateDeliveries)}
                </div>
              </Card>
              <Card padded className="space-y-1">
                <div className="text-xs text-text-muted">
                  {A ? "إرسال بلا مشاهدة سابقة" : "Submit without prior view"}
                </div>
                <div className="num text-2xl font-bold text-text">
                  {fmtNum(quality?.submissionsWithoutPriorView)}
                </div>
              </Card>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill tone="brand">UTM: {fmtNum(quality?.utmCoveredSessions)}</Pill>
              <Pill>
                {A ? "مباشر" : "Direct"}: {fmtNum(quality?.directSessions)}
              </Pill>
              <Pill tone="warning">
                {A ? "غير معروف" : "Unknown"}: {fmtNum(quality?.unknownSessions)}
              </Pill>
              <Pill tone="danger">
                {A ? "بلا دليل إسناد" : "Without attribution evidence"}:{" "}
                {fmtNum(quality?.sessionsWithoutAttribution)}
              </Pill>
            </div>
          </PageSection>
        </>
      )}
    </PageSections>
  );
}
