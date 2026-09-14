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
import { Card, KpiCard, Pill, SectionTitle } from "@/components/ui-bits";
import { FunnelBars } from "@/components/ui-bits";
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
  const cols: Col<LandingPageRow>[] = [
    {
      key: "page",
      header: A ? "صفحة الهبوط" : "Landing page",
      always: true,
      sticky: true,
      render: (row) => (
        <div>
          <div className="font-semibold text-text">{row.landingPageName}</div>
          <div className="mt-0.5 text-[11px] text-text-muted">
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
      render: (row) => fmtPct(row.viewToSubmissionRate, 1),
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
            <label className="grid gap-1 text-[11px] font-semibold text-text-muted">
              {A ? "من" : "From"}
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="min-h-10 rounded-xl border border-border bg-surface px-3 text-xs text-text outline-none focus:border-brand"
              />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold text-text-muted">
              {A ? "إلى" : "To"}
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="min-h-10 rounded-xl border border-border bg-surface px-3 text-xs text-text outline-none focus:border-brand"
              />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold text-text-muted">
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
            <div className="grid gap-1 text-[11px] font-semibold text-text-muted">
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
          <p className="text-[11px] leading-relaxed text-text-muted">
            {A
              ? "المصدر fb وig فقط يُوحّدان إلى facebook وinstagram. الحقول الناقصة تبقى غير محددة ولا تُخمن."
              : "Only fb→facebook and ig→instagram are normalized. Missing fields stay unset; they are never guessed."}
          </p>
        </Card>
      </PageSection>

      <PageSection level="headline" aria-label={A ? "مؤشرات صفحات الهبوط" : "Landing page metrics"}>
        <KpiRow>
          <KpiCard
            label={A ? "المشاهدات" : "Views"}
            value={fmtNum(totals?.views)}
            sub={A ? "أحداث مشاهدة فريدة داخل السيشن" : "Recorded page-view events"}
            icon={<MousePointerClick size={17} />}
            tone="sky"
            loading={summary.isLoading}
            index={0}
          />
          <KpiCard
            label={A ? "زوار فريدون" : "Unique visitors"}
            value={fmtNum(totals?.uniqueVisitors)}
            sub={A ? "معرّف المتصفح، وليس بيانات شخصية" : "Browser identifier, not PII"}
            icon={<Globe2 size={17} />}
            tone="violet"
            loading={summary.isLoading}
            index={1}
          />
          <KpiCard
            label={A ? "بدء الفورم" : "Form starts"}
            value={fmtNum(totals?.formStarts)}
            sub={`${A ? "مشاهدة ← بدء" : "View → start"}: ${fmtPct(totals?.viewToStartRate, 1)}`}
            icon={<FileCheck2 size={17} />}
            tone="amber"
            loading={summary.isLoading}
            index={2}
          />
          <KpiCard
            label={A ? "الإرسالات" : "Submissions"}
            value={fmtNum(totals?.submissions)}
            sub={`${A ? "بدء ← إرسال" : "Start → submit"}: ${fmtPct(totals?.startToSubmissionRate, 1)}`}
            icon={<Send size={17} />}
            tone="mint"
            loading={summary.isLoading}
            index={3}
          />
          <KpiCard
            label={A ? "تحويل المشاهدة" : "View CVR"}
            value={fmtPct(totals?.viewToSubmissionRate, 1)}
            sub={A ? "الإرسالات ÷ المشاهدات" : "Submissions ÷ views"}
            icon={<BarChart3 size={17} />}
            tone="rose"
            loading={summary.isLoading}
            index={4}
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
