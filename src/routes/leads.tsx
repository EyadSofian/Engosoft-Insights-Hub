import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowLeft,
  Boxes,
  BriefcaseBusiness,
  ChevronLeft,
  CircleDot,
  FileText,
  Filter,
  Layers3,
  MessageCircleMore,
  Sparkles,
  Target,
  Trophy,
  UserRoundCheck,
  Users,
  XCircle,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import { BarList, Card, ErrorState, Pill, Skeleton } from "@/components/ui-bits";
import {
  DashboardPageHeader,
  DataHealthSummary,
  KpiRow,
  MoreDetails,
  PageSection,
  PageSections,
} from "@/components/dashboard-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { MetricDetailTrigger } from "@/components/metric-detail";
import type {
  CrmBusinessStatus,
  CrmRecordType,
  CrmStageKey,
  DataHealth,
  Grouped,
} from "@/lib/types";
import type { MetricBreakdownGroup, MetricDetail } from "@/lib/metric-detail";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

export const Route = createFileRoute("/leads")({ component: CrmWorkspace });

type WorkspaceView = "all" | "leads" | "pipeline" | "won" | "lost";
type FacetKey =
  | "byType"
  | "bySource"
  | "byTeam"
  | "byCourse"
  | "byPriority"
  | "byLeadSegment"
  | "byOpenStatus"
  | "byCallingReply"
  | "byClosingChannel"
  | "byLostCategory"
  | "byLostReason"
  | "byPreviousStage"
  | "byCourseLanguage"
  | "byCourseType"
  | "byCustomerType";

type Facets = Record<FacetKey, Grouped[]>;

interface CrmWorkspaceRow {
  id: string;
  createdAt: string;
  contact: string;
  phone: string;
  mobile: string;
  email: string;
  recordType: CrmRecordType;
  active: boolean;
  status: CrmBusinessStatus;
  stageKey: CrmStageKey;
  displayStageKey: CrmStageKey;
  stage: string;
  source: string;
  medium: string;
  communicationLanguage: string;
  campaign: string;
  campaignId: string;
  adName: string;
  adId: string;
  adset: string;
  course: string;
  courses: string;
  salesperson: string;
  salesTeam: string;
  probability: number;
  automatedProbability: number;
  closingDurationDays: number | null;
  priority: string;
  readyToConvert: boolean;
  leadSegment: string;
  openStatus: string;
  closingChannel: string;
  lostCategory: string;
  lossReason: string;
  inventoryBucket: string;
  courseLanguage: string;
  courseType: string;
  customerType: string;
  callingReply: string;
  jobType: string;
  howFoundUs: string;
  company: string;
  tags: string;
  targetName: string;
  resignTarget: string;
  facebookLeadId: string;
  validateClosedReason: string;
  lastStageUpdate: string;
  wonDate: string;
  lostDate: string;
  conversionDate: string;
  closedAt: string;
  daysToClose: number | null;
}

interface Resp {
  contractVersion: string;
  summary: {
    total: number;
    activeLeads: number;
    openOpportunities: number;
    won: number;
    lost: number;
    lostLeads: number;
    lostOpportunities: number;
    currentLostOpportunities: number;
    historicalLostOpportunities: number;
    unmappedOperationalStages: number;
    readyToConvert: number;
    unsourced: number;
  };
  stages: {
    key: Exclude<CrmStageKey, "other">;
    count: number;
    leads: number;
    opportunities: number;
    active: number;
  }[];
  facets: Facets;
  stageFacets: Partial<Record<CrmStageKey, Facets>>;
  statusFacets: Record<WorkspaceView | "activeLeads" | "ready" | "open", Facets>;
  detail: { rows: CrmWorkspaceRow[]; total: number; truncated: boolean };
  health: DataHealth;
}

const STAGES: Exclude<CrmStageKey, "other">[] = [
  "preparation",
  "new",
  "open",
  "quotation",
  "won",
  "lost",
];

const STAGE_COLOR: Record<Exclude<CrmStageKey, "other">, string> = {
  preparation: "var(--slate-strong)",
  new: "var(--sky-strong)",
  open: "var(--violet-strong)",
  quotation: "var(--amber-strong)",
  won: "var(--mint-strong)",
  lost: "var(--rose-strong)",
};

function stageIcon(stage: Exclude<CrmStageKey, "other">, size = 17) {
  const props = { size, strokeWidth: 2.2 };
  if (stage === "preparation") return <Archive {...props} />;
  if (stage === "new") return <Sparkles {...props} />;
  if (stage === "open") return <MessageCircleMore {...props} />;
  if (stage === "quotation") return <FileText {...props} />;
  if (stage === "won") return <Trophy {...props} />;
  return <XCircle {...props} />;
}

function stageCopy(stage: Exclude<CrmStageKey, "other">, lang: "ar" | "en") {
  const ar = {
    preparation: {
      name: "التجهيز",
      note: "مساحة إدارية للحصر، وليست نقطة دخول العميل الجديد.",
      fields: ["Inventory Bucket", "Lead Segment", "Sales Team"],
    },
    new: {
      name: "جديد",
      note: "نقطة الدخول الافتراضية لكل عميل جديد عادي.",
      fields: ["Source", "Lead Segment", "Priority", "Ready to Convert"],
    },
    open: {
      name: "مفتوح",
      note: "مرحلة العمل والمتابعة؛ الـOpen Status يوضح حالة التواصل الحالية.",
      fields: ["Open Status", "Calling reply?", "Last Stage Update", "Salesperson"],
    },
    quotation: {
      name: "عرض سعر",
      note: "فرصة وصلت للعرض التجاري قبل الحسم.",
      fields: ["Course", "Course Language", "Course Type", "Probability"],
    },
    won: {
      name: "رابحة",
      note: "فرصة نشطة داخل Won stage؛ لا نعتمد على probability أو won_status.",
      fields: ["Closing Won Channel", "Won Date", "Customer Type", "Days to Close"],
    },
    lost: {
      name: "ضائعة",
      note: "Lost Lead مؤرشف مع stage محفوظ؛ Lost Opportunity داخل Lost stage.",
      fields: ["Lost Category", "Lost Reason", "Lost Date", "Actual Odoo Stage"],
    },
  } as const;
  const en = {
    preparation: {
      name: "Preparation",
      note: "A management inventory area, not the normal entry point.",
      fields: ["Inventory Bucket", "Lead Segment", "Sales Team"],
    },
    new: {
      name: "New",
      note: "The default entry stage for ordinary new records.",
      fields: ["Source", "Lead Segment", "Priority", "Ready to Convert"],
    },
    open: {
      name: "Open",
      note: "The working stage; Open Status carries the current contact state.",
      fields: ["Open Status", "Calling reply?", "Last Stage Update", "Salesperson"],
    },
    quotation: {
      name: "Quotation Sent",
      note: "An opportunity that has reached the commercial offer.",
      fields: ["Course", "Course Language", "Course Type", "Probability"],
    },
    won: {
      name: "Won",
      note: "An active Opportunity in a Won stage; probability and won_status are not used.",
      fields: ["Closing Won Channel", "Won Date", "Customer Type", "Days to Close"],
    },
    lost: {
      name: "Lost",
      note: "Lost Leads are archived in place; Lost Opportunities occupy the Lost stage.",
      fields: ["Lost Category", "Lost Reason", "Lost Date", "Actual Odoo Stage"],
    },
  } as const;
  return (lang === "ar" ? ar : en)[stage];
}

function statusTone(status: CrmBusinessStatus): "brand" | "warning" | "success" | "danger" {
  if (status === "lead") return "brand";
  if (status === "open") return "warning";
  if (status === "won") return "success";
  return "danger";
}

function statusLabel(status: CrmBusinessStatus, lang: "ar" | "en") {
  const labels = {
    lead: { ar: "Lead", en: "Lead" },
    open: { ar: "فرصة مفتوحة", en: "Open opportunity" },
    won: { ar: "رابحة", en: "Won" },
    lost: { ar: "ضائعة", en: "Lost" },
  };
  return labels[status][lang];
}

function CrmWorkspace() {
  const { lang } = useI18n();
  const period = useReportingPeriod();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/leads");
  const [view, setView] = useState<WorkspaceView>("all");
  const [stage, setStage] = useState<Exclude<CrmStageKey, "other"> | null>(null);

  useRegisterNexusView("leads", { tab: view, parameters: { stage: stage ?? "all" } });

  const visibleRows = useMemo(() => {
    if (!data) return [];
    return data.detail.rows.filter((row) => {
      if (stage && row.displayStageKey !== stage) return false;
      if (view === "leads" && row.recordType !== "lead") return false;
      if (view === "pipeline" && row.status !== "lead" && row.status !== "open") return false;
      if (view === "won" && row.status !== "won") return false;
      if (view === "lost" && row.status !== "lost") return false;
      return true;
    });
  }, [data, stage, view]);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (isLoading || !data) {
    return (
      <PageSections>
        <Skeleton className="h-20" />
        <Skeleton className="h-44" />
        <Skeleton className="h-[520px]" />
      </PageSections>
    );
  }

  const A = lang === "ar";
  const summary = data.summary;
  const tabs: { key: WorkspaceView; label: string; count: number; icon: ReactNode }[] = [
    {
      key: "all",
      label: A ? "كل الـCRM" : "All CRM",
      count: summary.total,
      icon: <Boxes size={15} />,
    },
    {
      key: "leads",
      label: A ? "العملاء" : "Leads",
      count: summary.activeLeads + summary.lostLeads,
      icon: <Users size={15} />,
    },
    {
      key: "pipeline",
      label: A ? "المسار المفتوح" : "Open pipeline",
      count: summary.activeLeads + summary.openOpportunities,
      icon: <Target size={15} />,
    },
    { key: "won", label: A ? "الرابحة" : "Won", count: summary.won, icon: <Trophy size={15} /> },
    {
      key: "lost",
      label: A ? "الضائعة" : "Lost",
      count: summary.lost,
      icon: <XCircle size={15} />,
    },
  ];

  const breakdown = (id: string, title: string, rows: Grouped[]): MetricBreakdownGroup => ({
    id,
    title,
    rows: rows.slice(0, 6).map((row) => ({
      key: row.label || "—",
      label: row.label === "—" ? (A ? "غير محدد" : "Not set") : row.label,
      value: row.count,
      display: fmtNum(row.count),
      meta: fmtPct(row.share, 0),
    })),
  });
  const records = (
    title: string,
    rows: CrmWorkspaceRow[],
  ): NonNullable<MetricDetail["records"]> => ({
    title,
    rows: rows.slice(0, 8).map((row) => ({
      key: row.id,
      title: row.contact || `#${row.id}`,
      subtitle: `${row.recordType === "lead" ? "Lead" : "Opportunity"} · ${row.stage || "—"}`,
      value: row.salesperson || row.salesTeam || undefined,
    })),
    emptyLabel: A ? "لا توجد سجلات في هذا التحديد." : "No records in this selection.",
  });
  const metricDetails: Record<"all" | "leads" | "open" | "ready" | "won" | "lost", MetricDetail> = {
    all: {
      id: "crm-total",
      title: A ? "كل سجلات الـCRM" : "All CRM records",
      value: fmtNum(summary.total),
      tone: "sky",
      icon: <Layers3 size={17} />,
      definition: A
        ? "كل السجلات النشطة غير Lost، مضافًا إليها كل حالات Lost المؤكدة حسب عقد 1.26."
        : "Every active non-Lost record plus every confirmed Lost record under the 1.26 contract.",
      formula: A ? "Active non-Lost CRM + Canonical Lost" : "Active non-Lost CRM + canonical Lost",
      breakdowns: [
        breakdown("crm-type", A ? "حسب نوع السجل" : "By record type", data.facets.byType),
        breakdown("crm-source", A ? "حسب المصدر" : "By source", data.facets.bySource),
      ],
      supporting: [
        {
          key: "leads",
          label: A ? "Leads نشطة" : "Active Leads",
          value: fmtNum(summary.activeLeads),
        },
        {
          key: "opportunities",
          label: A ? "فرص مفتوحة" : "Open opportunities",
          value: fmtNum(summary.openOpportunities),
        },
        { key: "won", label: "Won", value: fmtNum(summary.won) },
        { key: "lost", label: "Lost", value: fmtNum(summary.lost) },
      ],
      records: records(A ? "أحدث سجلات CRM" : "Latest CRM records", data.detail.rows),
      report: { to: "/leads", label: A ? "فتح مركز الـCRM" : "Open CRM center" },
    },
    leads: {
      id: "crm-active-leads",
      title: A ? "Leads نشطة" : "Active Leads",
      value: fmtNum(summary.activeLeads),
      tone: "cyan",
      icon: <Users size={17} />,
      definition: A
        ? "السجلات التي نوعها الحالي Lead وما زالت active؛ الـLost Leads لا تدخل هنا."
        : "Records whose current type is Lead and remain active; Lost Leads are separate.",
      formula: "type = lead AND active = true",
      breakdowns: [
        breakdown(
          "lead-segment",
          A ? "حسب شريحة العميل" : "By lead segment",
          data.statusFacets.activeLeads.byLeadSegment,
        ),
        breakdown(
          "lead-source",
          A ? "حسب المصدر" : "By source",
          data.statusFacets.activeLeads.bySource,
        ),
      ],
      supporting: [
        {
          key: "ready",
          label: A ? "جاهز للتحويل" : "Ready to convert",
          value: fmtNum(summary.readyToConvert),
        },
        { key: "lost-leads", label: "Lost Leads", value: fmtNum(summary.lostLeads) },
      ],
      records: records(
        A ? "أحدث الـLeads النشطة" : "Latest active Leads",
        data.detail.rows.filter((row) => row.recordType === "lead" && row.active),
      ),
      report: { to: "/leads", label: A ? "فتح سجل الـLeads" : "Open Leads workspace" },
    },
    open: {
      id: "crm-open-opportunities",
      title: A ? "Opportunities مفتوحة" : "Open Opportunities",
      value: fmtNum(summary.openOpportunities),
      tone: "violet",
      icon: <Target size={17} />,
      definition: A
        ? "Opportunities نشطة ليست في Won stage ولا Lost stage."
        : "Active Opportunities in neither a Won nor the Lost stage.",
      formula: "type = opportunity AND active = true AND NOT Won AND NOT Lost",
      breakdowns: [
        breakdown("open-status", "Open Status", data.statusFacets.open.byOpenStatus),
        breakdown("open-team", A ? "حسب الفريق" : "By team", data.statusFacets.open.byTeam),
      ],
      records: records(
        A ? "أحدث الفرص المفتوحة" : "Latest open Opportunities",
        data.detail.rows.filter((row) => row.status === "open"),
      ),
      report: { to: "/leads", label: A ? "فتح المسار المفتوح" : "Open pipeline workspace" },
    },
    ready: {
      id: "crm-ready-to-convert",
      title: A ? "جاهز للتحويل" : "Ready to convert",
      value: fmtNum(summary.readyToConvert),
      tone: "amber",
      icon: <UserRoundCheck size={17} />,
      definition: A
        ? "Active Leads التي تحمل القيمة المخزنة Yes صراحة؛ القيمة الفارغة ليست No."
        : "Active Leads with the explicitly stored value Yes; an empty value is unmarked, not No.",
      formula: "type = lead AND active = true AND x_studio_ready_to_convert_1 = Yes",
      breakdowns: [
        breakdown(
          "ready-segment",
          A ? "حسب شريحة العميل" : "By lead segment",
          data.statusFacets.ready.byLeadSegment,
        ),
        breakdown("ready-team", A ? "حسب الفريق" : "By team", data.statusFacets.ready.byTeam),
      ],
      records: records(
        A ? "الـLeads الجاهزة للتحويل" : "Leads ready to convert",
        data.detail.rows.filter(
          (row) => row.recordType === "lead" && row.active && row.readyToConvert,
        ),
      ),
      report: { to: "/leads", label: A ? "فتح سجل الـLeads" : "Open Leads workspace" },
    },
    won: {
      id: "crm-won-opportunities",
      title: "Won",
      value: fmtNum(summary.won),
      tone: "mint",
      icon: <Trophy size={17} />,
      definition: A
        ? "Opportunity نشطة في stage معلّم عليها is_won؛ probability وwon_status ليسا مصدر الحكم."
        : "An active Opportunity in a stage marked is_won; probability and won_status are not authorities.",
      formula: "type = opportunity AND active = true AND stage_is_won = true",
      breakdowns: [
        breakdown("won-channel", "Closing Won Channel", data.statusFacets.won.byClosingChannel),
        breakdown("won-course", A ? "حسب الدورة" : "By course", data.statusFacets.won.byCourse),
      ],
      records: records(
        A ? "أحدث الفرص الرابحة" : "Latest Won Opportunities",
        data.detail.rows.filter((row) => row.status === "won"),
      ),
      report: { to: "/leads", label: A ? "فتح Won" : "Open Won workspace" },
    },
    lost: {
      id: "crm-lost-canonical",
      title: "Lost",
      value: fmtNum(summary.lost),
      tone: "rose",
      icon: <XCircle size={17} />,
      definition: A
        ? "Lost Lead مؤرشف ومعه سبب؛ Lost Opportunity حالية داخل Lost stage، مع الاحتفاظ بالتاريخ المؤرشف."
        : "A Lost Lead is archived with a reason; a current Lost Opportunity is active in the Lost stage, with archived history retained.",
      formula: A
        ? "قواعد مختلفة حسب type — لا نستخدم اسم الـstage المترجم"
        : "Type-specific rules; translated stage names are never used",
      caveat:
        data.health.lostAuthority === "unavailable"
          ? A
            ? "مصدر Lost الموثوق غير متاح الآن؛ لا تعتبر الصفر نتيجة أعمال."
            : "The authoritative Lost source is unavailable; do not treat zero as a business result."
          : undefined,
      breakdowns: [
        breakdown(
          "lost-category",
          A ? "حسب فئة الخسارة" : "By Lost category",
          data.statusFacets.lost.byLostCategory,
        ),
        breakdown(
          "lost-reason",
          A ? "حسب سبب الخسارة" : "By Lost reason",
          data.statusFacets.lost.byLostReason,
        ),
      ],
      supporting: [
        { key: "lost-leads", label: "Lost Leads", value: fmtNum(summary.lostLeads) },
        {
          key: "lost-opportunities",
          label: "Lost Opportunities",
          value: fmtNum(summary.lostOpportunities),
        },
        {
          key: "current-lost",
          label: A ? "فرص Lost حالية" : "Current Lost-stage opps",
          value: fmtNum(summary.currentLostOpportunities),
        },
      ],
      records: records(
        A ? "أحدث حالات Lost" : "Latest Lost records",
        data.detail.rows.filter((row) => row.status === "lost"),
      ),
      report: { to: "/lost", label: A ? "فتح تحليل Lost" : "Open Lost analysis" },
    },
  };

  const selectView = (next: WorkspaceView) => {
    setView(next);
    setStage(next === "won" ? "won" : next === "lost" ? "lost" : null);
  };
  const selectStage = (next: Exclude<CrmStageKey, "other">) => {
    setStage((current) => (current === next ? null : next));
    if (next === "won") setView("won");
    else if (next === "lost") setView("lost");
    else setView("all");
  };

  const activeFacets = stage
    ? (data.stageFacets[stage] ?? data.facets)
    : (data.statusFacets?.[view] ?? data.facets);
  const lens = lensFor(stage, view, A);
  const selectedStage = stage ? stageCopy(stage, lang) : null;
  const crmHealthIssues = [
    ...(data.health.crmAuthority !== "odoo-direct"
      ? [
          {
            tone: "warning" as const,
            message: A
              ? "الـCRM معروض من آخر نسخة متاحة."
              : "CRM is using the latest available copy.",
            impact: A
              ? "قد تتأخر أحدث تغييرات المراحل والحالات حتى عودة الاتصال المباشر."
              : "The latest stage and status changes may lag until the direct connection returns.",
            technical: `CRM authority: ${data.health.crmAuthority}`,
          },
        ]
      : []),
    ...(summary.unmappedOperationalStages > 0
      ? [
          {
            tone: "warning" as const,
            message: A
              ? `${fmtNum(summary.unmappedOperationalStages)} فرصة/Lead مفتوحة غير مربوطة بمرحلة من مراحل الـCRM.`
              : `${fmtNum(summary.unmappedOperationalStages)} open CRM records are not mapped to a lifecycle stage.`,
            impact: A
              ? "لن نوزّعها على جديد أو مفتوح أو عرض سعر بالتخمين؛ الأصفار في هذه المراحل ليست نتيجة أعمال."
              : "They are not guessed into New, Open, or Quotation; zeroes in those lanes are not business results.",
            technical:
              "Stage XMLID is outside the lifecycle table, or the snapshot was classified by another revision.",
          },
        ]
      : []),
  ];

  return (
    <div>
      <DashboardPageHeader
        flush
        icon={<BriefcaseBusiness size={21} />}
        title={A ? "العملاء والمبيعات" : "Leads and sales"}
        subtitle={
          A
            ? "كل عميل: في أي مرحلة، ومن يتابعه، وهل اشترى."
            : "Every lead: which stage it is in, who is following it up, and whether it bought."
        }
        period={period}
      />

      <PageSections className="gap-after-header">
        {crmHealthIssues.length > 0 && <DataHealthSummary issues={crmHealthIssues} />}

        <PageSection level="headline" aria-label={A ? "مؤشرات الـCRM" : "CRM headline figures"}>
          <KpiRow>
            <MetricDetailTrigger
              detail={metricDetails.all}
              card={{
                index: 0,
                hero: true,
                sub: A
                  ? `${fmtNum(summary.unsourced)} بدون مصدر — مسموح`
                  : `${fmtNum(summary.unsourced)} unsourced — valid`,
              }}
            />
            <MetricDetailTrigger
              detail={metricDetails.leads}
              card={{
                index: 1,
                sub: A
                  ? `${fmtNum(summary.readyToConvert)} جاهز للتحويل`
                  : `${fmtNum(summary.readyToConvert)} ready to convert`,
              }}
            />
            <MetricDetailTrigger
              detail={metricDetails.open}
              card={{ index: 2, sub: A ? "قبل Won أو Lost" : "Before Won or Lost" }}
            />
            <MetricDetailTrigger
              detail={metricDetails.ready}
              card={{ index: 3, sub: A ? "القيمة Yes فقط" : "Only the stored Yes value" }}
            />
            <MetricDetailTrigger
              detail={metricDetails.won}
              card={{ index: 4, sub: A ? "من Won stage" : "From the Won stage" }}
            />
            <MetricDetailTrigger
              detail={metricDetails.lost}
              card={{
                index: 5,
                sub: A
                  ? `${fmtNum(summary.lostLeads)} Leads · ${fmtNum(summary.lostOpportunities)} فرص`
                  : `${fmtNum(summary.lostLeads)} Leads · ${fmtNum(summary.lostOpportunities)} opportunities`,
              }}
            />
          </KpiRow>
        </PageSection>

        <PageSection
          level="primary"
          title={A ? "مسار الـCRM" : "CRM flow"}
          hint={
            A
              ? "اضغط على أي مرحلة لعرض الحقول والسجلات الخاصة بها."
              : "Select a stage to inspect its fields and records."
          }
          icon={<Layers3 size={17} />}
        >
          <Card padded={false} className="overflow-hidden">
            <div className="hscroll flex gap-1 border-b border-border bg-surface-2/75 p-2">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => selectView(tab.key)}
                  className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-[12px] font-bold transition-all ${view === tab.key ? "bg-text text-surface shadow-sm" : "text-text-muted hover:bg-surface hover:text-text"}`}
                >
                  {tab.icon}
                  {tab.label}
                  <span
                    className={`num rounded-full px-1.5 py-0.5 text-[10px] ${view === tab.key ? "bg-white/15 text-white" : "bg-surface-3 text-text-muted"}`}
                  >
                    {fmtNum(tab.count)}
                  </span>
                </button>
              ))}
            </div>

            <div className="crm-stage-rail grid min-w-[780px] grid-cols-6 gap-0 overflow-x-auto p-3 sm:p-4">
              {STAGES.map((key, index) => {
                const value = data.stages.find((item) => item.key === key);
                const copy = stageCopy(key, lang);
                const selected = stage === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectStage(key)}
                    aria-pressed={selected}
                    className={`group relative min-h-[116px] border-y border-s-0 bg-surface px-3 py-3 text-start transition-all first:rounded-s-2xl first:border-s last:rounded-e-2xl ${selected ? "z-10 -translate-y-1 border-border-strong shadow-md" : "border-border hover:-translate-y-0.5 hover:bg-surface-2"}`}
                    style={{
                      borderTopColor: selected ? STAGE_COLOR[key] : undefined,
                      borderTopWidth: selected ? 3 : 1,
                    }}
                  >
                    {index < STAGES.length - 1 && (
                      <span className="absolute top-[30px] z-20 size-2.5 rotate-45 border-e border-t border-border bg-inherit ltr:-right-1.5 rtl:-left-1.5" />
                    )}
                    <span
                      className="mb-3 grid size-8 place-items-center rounded-xl text-white shadow-sm"
                      style={{ background: STAGE_COLOR[key] }}
                    >
                      {stageIcon(key)}
                    </span>
                    <span className="block text-[12px] font-bold text-text">{copy.name}</span>
                    <span className="num mt-1 block text-[25px] font-bold leading-none text-text">
                      {fmtNum(value?.count ?? 0)}
                    </span>
                    <span className="mt-2 block text-[10px] text-text-muted">
                      {fmtNum(value?.leads ?? 0)} {A ? "Lead" : "leads"} ·{" "}
                      {fmtNum(value?.opportunities ?? 0)} {A ? "فرصة" : "opps"}
                    </span>
                  </button>
                );
              })}
            </div>
            {summary.unmappedOperationalStages > 0 && (
              <div
                role="status"
                className="border-t border-amber-border bg-amber-surface px-4 py-3 text-[12px] leading-5 text-amber-ink"
              >
                <strong>
                  {A
                    ? `${fmtNum(summary.unmappedOperationalStages)} سجلًا مفتوحًا خارج توزيع المراحل.`
                    : `${fmtNum(summary.unmappedOperationalStages)} open records are outside the stage distribution.`}
                </strong>{" "}
                {A
                  ? "مرحلتها ليست من مراحل الـCRM المعرّفة بـXMLID في هذه النسخة؛ لا نخمّن المرحلة من اسمها."
                  : "Their stage does not resolve to a lifecycle XMLID in this snapshot, so the dashboard does not guess from a stage name."}
              </div>
            )}
          </Card>
        </PageSection>

        <PageSection
          level="records"
          title={
            A
              ? `السجلات المطابقة · ${fmtNum(visibleRows.length)}`
              : `Matching records · ${fmtNum(visibleRows.length)}`
          }
          hint={
            A
              ? "فعّل الأعمدة الإضافية لرؤية كل حقول الـCRM المتاحة."
              : "Turn on optional columns to inspect every available CRM field."
          }
          action={
            stage || view !== "all" ? (
              <button
                type="button"
                onClick={() => {
                  setView("all");
                  setStage(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-bold text-text-muted hover:text-text"
              >
                <Filter size={12} /> {A ? "مسح التحديد" : "Clear selection"}
              </button>
            ) : undefined
          }
        >
          <CrmRecords
            rows={visibleRows}
            total={data.detail.total}
            truncated={data.detail.truncated}
          />
        </PageSection>

        <MoreDetails
          label={A ? "كيف تُعرَّف الحالات" : "How these states are defined"}
          hint={
            A
              ? `تعريف المرحلة المختارة وحقول Odoo التي تشرحها · عقد CRM ${data.contractVersion}`
              : `The selected stage's definition and the Odoo fields behind it · CRM contract ${data.contractVersion}`
          }
        >
          {(selectedStage || view === "lost") && (
            <PageSection level="insight" aria-label={A ? "تعريف الحالة" : "Status definition"}>
              <div
                className="relative overflow-hidden rounded-2xl border p-4 sm:p-5"
                style={{
                  borderColor: STAGE_COLOR[stage ?? "lost"],
                  background: `color-mix(in oklab, ${STAGE_COLOR[stage ?? "lost"]} 7%, var(--surface))`,
                }}
              >
                <div className="flex flex-wrap items-start gap-4">
                  <span
                    className="grid size-11 shrink-0 place-items-center rounded-2xl text-white"
                    style={{ background: STAGE_COLOR[stage ?? "lost"] }}
                  >
                    {stageIcon(stage ?? "lost", 20)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[17px] font-bold text-text">
                        {selectedStage?.name ??
                          (A ? "تعريف Lost في 1.26" : "Lost definition in 1.26")}
                      </h2>
                      {stage === "lost" || view === "lost" ? (
                        <Pill tone="danger">{A ? "قاعدتان مختلفتان" : "Two distinct rules"}</Pill>
                      ) : null}
                    </div>
                    <p className="mt-1 max-w-3xl text-[12.5px] leading-6 text-text-muted">
                      {selectedStage?.note ??
                        (A
                          ? "Lead الضائع: active=false ومعه Lost Reason والـstage يظل كما كان. Opportunity الضائعة: active=true وداخل Lost stage."
                          : "Lost Lead: active=false with a Lost Reason and its stage preserved. Lost Opportunity: active=true in the Lost stage.")}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(selectedStage?.fields ?? stageCopy("lost", lang).fields).map((field) => (
                        <span
                          key={field}
                          className="rounded-lg border border-border bg-surface/80 px-2 py-1 text-[10.5px] font-semibold text-text-muted"
                        >
                          {field}
                        </span>
                      ))}
                    </div>
                  </div>
                  {(stage === "lost" || view === "lost") && (
                    <div className="grid min-w-[260px] grid-cols-2 gap-2">
                      <MiniStat label={A ? "Lost Leads" : "Lost Leads"} value={summary.lostLeads} />
                      <MiniStat
                        label={A ? "Lost Opportunities" : "Lost Opportunities"}
                        value={summary.lostOpportunities}
                      />
                      <MiniStat
                        label={A ? "فرص حالية" : "Current opps"}
                        value={summary.currentLostOpportunities}
                      />
                      <MiniStat
                        label={A ? "فرص تاريخية" : "Historical opps"}
                        value={summary.historicalLostOpportunities}
                      />
                    </div>
                  )}
                </div>
              </div>
            </PageSection>
          )}

          <PageSection
            level="primary"
            title={A ? "الحقول التي تشرح الحالة" : "Fields that explain this state"}
            hint={
              A
                ? "كل توزيع محسوب من نفس السكان الظاهرين في التحديد الحالي."
                : "Every distribution follows the current workspace selection."
            }
            icon={<Filter size={17} />}
          >
            <div className="card-grid lg:grid-cols-3">
              {lens.map((item) => (
                <FacetCard
                  key={item.key}
                  title={item.label}
                  rows={activeFacets[item.key]}
                  empty={A ? "غير محدد" : "Not set"}
                  color={item.color}
                />
              ))}
            </div>
          </PageSection>
        </MoreDetails>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3 text-[11.5px] text-text-muted">
          <span className="inline-flex items-center gap-2">
            <CircleDot size={13} className="text-mint-strong" />
            {A
              ? "التصنيف مبني على type + active + Lost Reason + XMLID للـstage، وليس على اسم المرحلة أو won_status."
              : "Classification uses type + active + Lost Reason + stage XMLID, never translated stage names or won_status."}
          </span>
          <Link
            to="/lost"
            className="inline-flex items-center gap-1 font-bold text-brand hover:underline"
          >
            {A ? "فتح تحليل Lost المتقدم" : "Open advanced Lost analysis"}
            {A ? <ArrowLeft size={13} /> : <ChevronLeft className="rotate-180" size={13} />}
          </Link>
        </div>
      </PageSections>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface/85 px-3 py-2">
      <div className="text-[9.5px] font-semibold text-text-muted">{label}</div>
      <div className="num mt-1 text-lg font-bold text-text">{fmtNum(value)}</div>
    </div>
  );
}

function lensFor(
  stage: Exclude<CrmStageKey, "other"> | null,
  view: WorkspaceView,
  A: boolean,
): { key: FacetKey; label: string; color: string }[] {
  const labels: Record<FacetKey, [string, string]> = {
    byType: ["نوع السجل", "Record type"],
    bySource: ["المصدر", "Source"],
    byTeam: ["فريق المبيعات", "Sales team"],
    byCourse: ["الدورة", "Course"],
    byPriority: ["الأولوية", "Priority"],
    byLeadSegment: ["شريحة العميل", "Lead segment"],
    byOpenStatus: ["حالة Open", "Open status"],
    byCallingReply: ["نتيجة الاتصال", "Calling reply"],
    byClosingChannel: ["قناة الإغلاق الرابح", "Closing Won channel"],
    byLostCategory: ["فئة الخسارة", "Lost category"],
    byLostReason: ["سبب الخسارة", "Lost reason"],
    byPreviousStage: ["المرحلة الفعلية في Odoo", "Actual Odoo stage"],
    byCourseLanguage: ["لغة الدورة", "Course language"],
    byCourseType: ["نوع الدورة", "Course type"],
    byCustomerType: ["نوع العميل", "Customer type"],
  };
  const keys: FacetKey[] =
    stage === "preparation"
      ? ["byLeadSegment", "byTeam", "byType"]
      : stage === "new"
        ? ["bySource", "byLeadSegment", "byPriority"]
        : stage === "open"
          ? ["byOpenStatus", "byCallingReply", "byTeam"]
          : stage === "quotation"
            ? ["byCourse", "byCourseLanguage", "byCourseType"]
            : stage === "won" || view === "won"
              ? ["byClosingChannel", "byCourse", "byCustomerType"]
              : stage === "lost" || view === "lost"
                ? ["byLostCategory", "byLostReason", "byPreviousStage"]
                : view === "leads"
                  ? ["byLeadSegment", "bySource", "byPriority"]
                  : view === "pipeline"
                    ? ["byOpenStatus", "byTeam", "byCourse"]
                    : ["byType", "bySource", "byTeam"];
  return keys.map((key, index) => ({
    key,
    label: labels[key][A ? 0 : 1],
    color: ["var(--brand)", "var(--violet-strong)", "var(--amber-strong)"][index],
  }));
}

function FacetCard({
  title,
  rows,
  empty,
  color,
}: {
  title: string;
  rows: Grouped[];
  empty: string;
  color: string;
}) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold text-text">{title}</h3>
        <span className="size-2 rounded-full" style={{ background: color }} />
      </div>
      <BarList
        items={rows.slice(0, 6).map((row) => ({
          label: row.label === "—" ? empty : row.label,
          value: row.count,
          meta: (
            <span className="num text-[10.5px] text-text-muted">
              {fmtNum(row.count)} · {fmtPct(row.share, 0)}
            </span>
          ),
        }))}
        format={fmtNum}
        color={color}
      />
    </Card>
  );
}

function CrmRecords({
  rows,
  total,
  truncated,
}: {
  rows: CrmWorkspaceRow[];
  total: number;
  truncated: boolean;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const cols: Col<CrmWorkspaceRow>[] = [
    {
      key: "createdAt",
      header: A ? "تاريخ الإنشاء" : "Created",
      render: (row) => fmtDate(row.createdAt, lang),
      sortValue: (row) => row.createdAt,
      sticky: true,
      always: true,
      width: "118px",
      group: "identity",
    },
    {
      key: "contact",
      header: A ? "العميل" : "Customer",
      render: (row) => (
        <span className="block max-w-[170px] truncate" title={row.contact}>
          {row.contact || "—"}
        </span>
      ),
      sortValue: (row) => row.contact,
      group: "identity",
    },
    {
      key: "phone",
      header: A ? "الهاتف" : "Phone",
      render: (row) => row.phone || row.mobile || "—",
      sortValue: (row) => row.phone || row.mobile,
      group: "identity",
      hideByDefault: true,
    },
    {
      key: "email",
      header: A ? "البريد" : "Email",
      render: (row) => row.email || "—",
      sortValue: (row) => row.email,
      group: "identity",
      hideByDefault: true,
    },
    {
      key: "recordType",
      hideByDefault: true,
      header: A ? "النوع" : "Type",
      render: (row) => (
        <Pill tone="neutral">{row.recordType === "lead" ? "Lead" : "Opportunity"}</Pill>
      ),
      sortValue: (row) => row.recordType,
      group: "state",
    },
    {
      key: "status",
      header: A ? "النتيجة" : "Status",
      render: (row) => <Pill tone={statusTone(row.status)}>{statusLabel(row.status, lang)}</Pill>,
      sortValue: (row) => row.status,
      group: "state",
    },
    {
      key: "active",
      header: A ? "نشط" : "Active",
      render: (row) => (row.active ? "Yes" : "No"),
      sortValue: (row) => Number(row.active),
      group: "state",
      hideByDefault: true,
    },
    {
      key: "stage",
      header: A ? "Odoo Stage" : "Odoo stage",
      render: (row) => (
        <span className="block max-w-[150px]">
          <span className="block truncate" title={row.stage}>
            {row.stage || "—"}
          </span>
          {row.status === "lost" && row.recordType === "lead" && (
            <span className="block text-[9.5px] text-danger">
              {A ? "مرحلة محفوظة قبل الأرشفة" : "preserved before archive"}
            </span>
          )}
        </span>
      ),
      sortValue: (row) => row.stage,
      group: "state",
    },
    {
      key: "openStatus",
      hideByDefault: true,
      header: "Open Status",
      render: (row) => row.openStatus || "—",
      sortValue: (row) => row.openStatus,
      group: "qualification",
    },
    {
      key: "leadSegment",
      hideByDefault: true,
      header: "Lead Segment",
      render: (row) => row.leadSegment || "—",
      sortValue: (row) => row.leadSegment,
      group: "qualification",
    },
    {
      key: "priority",
      hideByDefault: true,
      header: A ? "الأولوية" : "Priority",
      render: (row) => row.priority || "—",
      sortValue: (row) => row.priority,
      group: "qualification",
    },
    {
      key: "probability",
      header: A ? "الاحتمالية" : "Probability",
      render: (row) => fmtPct(row.probability, 0),
      sortValue: (row) => row.probability,
      group: "qualification",
      hideByDefault: true,
    },
    {
      key: "automatedProbability",
      header: A ? "الاحتمالية الآلية" : "Automated probability",
      render: (row) => fmtPct(row.automatedProbability, 0),
      sortValue: (row) => row.automatedProbability,
      group: "qualification",
      hideByDefault: true,
    },
    {
      key: "ready",
      hideByDefault: true,
      header: A ? "جاهز للتحويل" : "Ready",
      render: (row) =>
        row.readyToConvert ? (
          <Pill tone="success">Yes</Pill>
        ) : (
          <span className="text-text-subtle">—</span>
        ),
      sortValue: (row) => Number(row.readyToConvert),
      group: "qualification",
    },
    {
      key: "callingReply",
      header: A ? "نتيجة الاتصال" : "Calling reply",
      render: (row) => row.callingReply || "—",
      sortValue: (row) => row.callingReply,
      group: "qualification",
      hideByDefault: true,
    },
    {
      key: "tags",
      header: A ? "الوسوم" : "Tags",
      render: (row) => row.tags || "—",
      sortValue: (row) => row.tags,
      group: "qualification",
      hideByDefault: true,
    },
    {
      key: "jobType",
      header: A ? "نوع الوظيفة" : "Job type",
      render: (row) => row.jobType || "—",
      sortValue: (row) => row.jobType,
      group: "qualification",
      hideByDefault: true,
    },
    {
      key: "howFoundUs",
      header: A ? "كيف عرفنا؟" : "How found us?",
      render: (row) => row.howFoundUs || "—",
      sortValue: (row) => row.howFoundUs,
      group: "qualification",
      hideByDefault: true,
    },
    {
      key: "course",
      header: A ? "الدورة" : "Course",
      render: (row) => (
        <span className="block max-w-[170px] truncate" title={row.course}>
          {row.course || "—"}
        </span>
      ),
      sortValue: (row) => row.course,
      group: "commercial",
    },
    {
      key: "courseLanguage",
      header: A ? "لغة الدورة" : "Course language",
      render: (row) => row.courseLanguage || "—",
      sortValue: (row) => row.courseLanguage,
      group: "commercial",
      hideByDefault: true,
    },
    {
      key: "courses",
      header: A ? "الكورسات" : "Courses",
      render: (row) => row.courses || "—",
      sortValue: (row) => row.courses,
      group: "commercial",
      hideByDefault: true,
    },
    {
      key: "courseType",
      header: A ? "نوع الدورة" : "Course type",
      render: (row) => row.courseType || "—",
      sortValue: (row) => row.courseType,
      group: "commercial",
      hideByDefault: true,
    },
    {
      key: "customerType",
      header: A ? "نوع العميل" : "Customer type",
      render: (row) => row.customerType || "—",
      sortValue: (row) => row.customerType,
      group: "commercial",
      hideByDefault: true,
    },
    {
      key: "communicationLanguage",
      header: A ? "لغة التواصل" : "Communication language",
      render: (row) => row.communicationLanguage || "—",
      sortValue: (row) => row.communicationLanguage,
      group: "commercial",
      hideByDefault: true,
    },
    {
      key: "source",
      header: A ? "المصدر" : "Source",
      render: (row) => row.source || <Pill tone="warning">{A ? "بدون مصدر" : "No source"}</Pill>,
      sortValue: (row) => row.source,
      group: "ownership",
    },
    {
      key: "medium",
      header: A ? "الوسيط" : "Medium",
      render: (row) => row.medium || "—",
      sortValue: (row) => row.medium,
      group: "ownership",
      hideByDefault: true,
    },
    {
      key: "campaign",
      header: A ? "الحملة" : "Campaign",
      render: (row) => row.campaign || "—",
      sortValue: (row) => row.campaign,
      group: "ownership",
    },
    {
      key: "campaignId",
      header: A ? "معرّف الحملة" : "Campaign ID",
      render: (row) => row.campaignId || "—",
      sortValue: (row) => row.campaignId,
      group: "ownership",
      hideByDefault: true,
    },
    {
      key: "adset",
      header: A ? "مجموعة الإعلانات" : "Ad set",
      render: (row) => row.adset || "—",
      sortValue: (row) => row.adset,
      group: "ownership",
      hideByDefault: true,
    },
    {
      key: "adName",
      header: A ? "الإعلان" : "Ad",
      render: (row) => row.adName || "—",
      sortValue: (row) => row.adName,
      group: "ownership",
      hideByDefault: true,
    },
    {
      key: "adId",
      header: A ? "معرّف الإعلان" : "Ad ID",
      render: (row) => row.adId || "—",
      sortValue: (row) => row.adId,
      group: "ownership",
      hideByDefault: true,
    },
    {
      key: "facebookLeadId",
      header: A ? "معرّف Facebook Lead" : "Facebook Lead ID",
      render: (row) => row.facebookLeadId || "—",
      sortValue: (row) => row.facebookLeadId,
      group: "ownership",
      hideByDefault: true,
    },
    {
      key: "inventoryBucket",
      header: A ? "مخزن البيانات" : "Data inventory",
      render: (row) => row.inventoryBucket || "—",
      sortValue: (row) => row.inventoryBucket,
      group: "ownership",
      hideByDefault: true,
    },
    {
      key: "salesTeam",
      hideByDefault: true,
      header: A ? "الفريق" : "Team",
      render: (row) => row.salesTeam || "—",
      sortValue: (row) => row.salesTeam,
      group: "ownership",
    },
    {
      key: "salesperson",
      header: A ? "الموظف" : "Salesperson",
      render: (row) => (
        <span className="block max-w-[150px] truncate" title={row.salesperson}>
          {row.salesperson || "—"}
        </span>
      ),
      sortValue: (row) => row.salesperson,
      group: "ownership",
    },
    {
      key: "company",
      header: A ? "الشركة" : "Company",
      render: (row) => row.company || "—",
      sortValue: (row) => row.company,
      group: "ownership",
      hideByDefault: true,
    },
    {
      key: "targetName",
      header: A ? "اسم التارجت" : "Target name",
      render: (row) => row.targetName || "—",
      sortValue: (row) => row.targetName,
      group: "ownership",
      hideByDefault: true,
    },
    {
      key: "resignTarget",
      header: A ? "إعادة تعيين التارجت" : "Resign target",
      render: (row) => row.resignTarget || "—",
      sortValue: (row) => row.resignTarget,
      group: "ownership",
      hideByDefault: true,
    },
    {
      key: "closingChannel",
      header: "Closing Won Channel",
      render: (row) => row.closingChannel || "—",
      sortValue: (row) => row.closingChannel,
      group: "outcome",
      hideByDefault: true,
    },
    {
      key: "lostCategory",
      header: "Lost Category",
      render: (row) => row.lostCategory || "—",
      sortValue: (row) => row.lostCategory,
      group: "outcome",
      hideByDefault: true,
    },
    {
      key: "lossReason",
      header: "Lost Reason",
      render: (row) => (
        <span className="block max-w-[180px] truncate" title={row.lossReason}>
          {row.lossReason || "—"}
        </span>
      ),
      sortValue: (row) => row.lossReason,
      group: "outcome",
      hideByDefault: true,
    },
    {
      key: "resultDate",
      header: A ? "تاريخ النتيجة" : "Outcome date",
      render: (row) =>
        fmtDate(
          row.status === "lost"
            ? row.lostDate
            : row.status === "won"
              ? row.wonDate
              : row.lastStageUpdate,
          lang,
        ),
      sortValue: (row) =>
        row.status === "lost"
          ? row.lostDate
          : row.status === "won"
            ? row.wonDate
            : row.lastStageUpdate,
      group: "outcome",
      hideByDefault: true,
    },
    {
      key: "conversionDate",
      header: A ? "تاريخ التحويل" : "Conversion date",
      render: (row) => fmtDate(row.conversionDate, lang),
      sortValue: (row) => row.conversionDate,
      group: "outcome",
      hideByDefault: true,
    },
    {
      key: "closingDurationDays",
      header: A ? "مدة الإغلاق" : "Closing duration",
      render: (row) =>
        row.closingDurationDays === null
          ? "—"
          : A
            ? `${fmtNum(row.closingDurationDays)} يوم`
            : `${fmtNum(row.closingDurationDays)} days`,
      sortValue: (row) => row.closingDurationDays ?? -1,
      group: "outcome",
      hideByDefault: true,
    },
    {
      key: "validateClosedReason",
      header: A ? "مراجعة سبب Lost" : "Lost reason validation",
      render: (row) => row.validateClosedReason || "—",
      sortValue: (row) => row.validateClosedReason,
      group: "outcome",
      hideByDefault: true,
    },
  ];

  return (
    <DataTable
      rows={rows}
      cols={cols}
      columnChooser
      groupLabels={{
        identity: A ? "الهوية" : "Identity",
        state: A ? "الحالة" : "State",
        qualification: A ? "التأهيل والمتابعة" : "Qualification & follow-up",
        commercial: A ? "التجاري" : "Commercial",
        ownership: A ? "المصدر والملكية" : "Source & ownership",
        outcome: A ? "النتيجة" : "Outcome",
      }}
      searchable={(row) =>
        `${row.contact} ${row.phone} ${row.mobile} ${row.email} ${row.stage} ${row.openStatus} ${row.leadSegment} ${row.source} ${row.medium} ${row.campaign} ${row.adset} ${row.adName} ${row.course} ${row.courses} ${row.tags} ${row.salesTeam} ${row.salesperson} ${row.lostCategory} ${row.lossReason}`
      }
      initialSort={{ key: "createdAt", dir: -1 }}
      maxHeight={680}
      csvFilename="engosoft-crm-1.26"
      truncatedNote={
        truncated
          ? A
            ? `السجل التفصيلي مفلتر داخل أحدث ٣٬٠٠٠ صف من أصل ${fmtNum(total)}؛ الأرقام والتوزيعات بالأعلى كاملة.`
            : `Detail filters the latest 3,000 of ${fmtNum(total)} rows; totals and distributions above are complete.`
          : undefined
      }
      emptyState={
        <div className="grid min-h-40 place-items-center text-sm text-text-muted">
          {A ? "لا توجد سجلات تطابق هذا التحديد." : "No records match this selection."}
        </div>
      }
      csvRow={(row) => ({
        id: row.id,
        created_at: row.createdAt,
        customer: row.contact,
        phone: row.phone,
        mobile: row.mobile,
        email: row.email,
        record_type: row.recordType,
        active: String(row.active),
        business_status: row.status,
        odoo_stage: row.stage,
        open_status: row.openStatus,
        lead_segment: row.leadSegment,
        priority: row.priority,
        probability: row.probability,
        automated_probability: row.automatedProbability,
        ready_to_convert: row.readyToConvert ? "Yes" : "",
        calling_reply: row.callingReply,
        course: row.course,
        courses: row.courses,
        course_language: row.courseLanguage,
        course_type: row.courseType,
        source: row.source,
        medium: row.medium,
        communication_language: row.communicationLanguage,
        campaign: row.campaign,
        campaign_id: row.campaignId,
        ad_set: row.adset,
        ad_name: row.adName,
        ad_id: row.adId,
        facebook_lead_id: row.facebookLeadId,
        sales_team: row.salesTeam,
        salesperson: row.salesperson,
        company: row.company,
        tags: row.tags,
        target_name: row.targetName,
        resign_target: row.resignTarget,
        data_inventory: row.inventoryBucket,
        customer_type: row.customerType,
        job_type: row.jobType,
        how_found_us: row.howFoundUs,
        closing_won_channel: row.closingChannel,
        lost_category: row.lostCategory,
        lost_reason: row.lossReason,
        lost_date: row.lostDate,
        won_date: row.wonDate,
        conversion_date: row.conversionDate,
        closing_duration_days: row.closingDurationDays ?? "",
        validate_closed_lost_reason: row.validateClosedReason,
      })}
    />
  );
}
