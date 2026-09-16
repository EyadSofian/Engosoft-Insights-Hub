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
import { OverviewEfficiency } from "@/components/overview-records";
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
import type { LostMovementRecord, LostMovementResult } from "@/lib/crm-lost-movement.server";
import type { FreshLostPipelineRecord, FreshLostPipelineResult } from "@/lib/crm-fresh-lost.server";

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
  odooUrl: string;
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
  lostTypeFacets: { leads: Facets; opportunities: Facets };
  freshLostPipeline: Omit<FreshLostPipelineResult, "records">;
  freshLostPipelineFacets: Pick<Facets, "bySource" | "byTeam" | "byLostReason" | "byLostCategory">;
  freshLostPipelineDetail: { rows: FreshLostPipelineRecord[]; total: number; truncated: boolean };
  archivedLostLeads: Resp["freshLostPipeline"];
  archivedLostLeadsFacets: Resp["freshLostPipelineFacets"];
  archivedLostLeadsDetail: Resp["freshLostPipelineDetail"];
  lostMovement: Omit<LostMovementResult, "records" | "freshRecords" | "olderRecords">;
  lostMovementFacets: Pick<
    Facets,
    "byType" | "bySource" | "byTeam" | "byLostReason" | "byLostCategory"
  >;
  lostMovementCohortFacets: Record<"fresh" | "older", Resp["lostMovementFacets"]>;
  oldLeadLost: number | null;
  oldLeadLostFacets: Resp["lostMovementFacets"];
  oldLeadLostDetail: { rows: LostMovementRecord[]; total: number; truncated: boolean };
  oldLeadLostCreationMonths: Grouped[];
  olderLostCreationMonths: Grouped[];
  lostMovementDetail: {
    all: { rows: LostMovementRecord[]; total: number; truncated: boolean };
    fresh: { rows: LostMovementRecord[]; total: number; truncated: boolean };
    older: { rows: LostMovementRecord[]; total: number; truncated: boolean };
  };
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
      note: "مرحلة CRM مستقلة، وتظهر طبيعيًا ما دام السجل ليس Data Inventory.",
      fields: ["Lead Segment", "Sales Team", "Source"],
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
      note: "A normal CRM stage, included whenever the record is not Data Inventory.",
      fields: ["Lead Segment", "Sales Team", "Source"],
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
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/leads", {
    refetchInterval: 30_000,
  });
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
  const lostMovement = data.lostMovement;
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
    hint?: string,
  ): NonNullable<MetricDetail["records"]> => ({
    title,
    hint,
    rows: rows.slice(0, 8).map((row) => ({
      key: row.id,
      title: row.contact || `#${row.id}`,
      subtitle: `${row.source || (A ? "مصدر غير محدد" : "Source not set")} · ${row.stage || "—"}`,
      value: row.salesperson || row.salesTeam || undefined,
      href: row.odooUrl || undefined,
    })),
    emptyLabel: A ? "لا توجد سجلات في هذا التحديد." : "No records in this selection.",
  });
  const metricDetails: Record<
    "all" | "leads" | "open" | "ready" | "won" | "lostLeads" | "lostOpportunities",
    MetricDetail
  > = {
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
    lostLeads: {
      id: "crm-lost-leads",
      title: "Lost Leads",
      value: fmtNum(summary.lostLeads),
      tone: "rose",
      icon: <Users size={17} />,
      definition: A
        ? "سجل ما زال نوعه Lead، تم أرشفته في Odoo ومعه Lost Reason مسجّل. المرحلة التي كان فيها تظل محفوظة ولا نحوله إلى Lost Opportunity."
        : "A record that is still a Lead, archived in Odoo with a registered Lost Reason. Its previous stage is preserved; it does not become a Lost Opportunity.",
      formula:
        "inventory_bucket = False AND type = lead AND active = false AND lost_reason_id != False",
      caveat:
        data.health.lostAuthority === "unavailable"
          ? A
            ? "مصدر Lost الموثوق غير متاح الآن؛ لا تعتبر الصفر نتيجة أعمال."
            : "The authoritative Lost source is unavailable; do not treat zero as a business result."
          : A
            ? "اسم الـstage ليس شرطًا هنا؛ الـLead قد يظهر بمرحلة New أو Open أو غيرها لأنه يُؤرشف مكانه."
            : "Stage name is not a condition here; the Lead can retain New, Open or another previous stage because it is archived in place.",
      provenance: {
        system: A ? "Odoo CRM مباشرة ← /api/leads" : "Direct Odoo CRM → /api/leads",
        model: "crm.lead",
        query:
          "inventory_bucket = False AND type = 'lead' AND active = False AND lost_reason_id != False",
        fields: ["inventory_bucket", "type", "active", "lost_reason_id", "create_date"],
        dateBasis: A
          ? "create_date — الفلتر يختار الـLeads التي أُنشئت في الفترة ثم أصبحت Lost."
          : "create_date — the filter selects Leads created in the window that later became Lost.",
        note: A
          ? "كل سجل في الأمثلة بالأسفل يحمل Odoo ID حقيقي، ويمكن فتحه مباشرة لمراجعة الحقول."
          : "Every example below carries a real Odoo ID and can be opened directly for verification.",
      },
      breakdowns: [
        breakdown(
          "lost-lead-category",
          A ? "حسب فئة الخسارة" : "By Lost category",
          data.lostTypeFacets.leads.byLostCategory,
        ),
        breakdown(
          "lost-lead-reason",
          A ? "حسب سبب الخسارة" : "By Lost reason",
          data.lostTypeFacets.leads.byLostReason,
        ),
        breakdown(
          "lost-lead-source",
          A ? "جاءت من أي مصدر؟" : "Which source produced them?",
          data.lostTypeFacets.leads.bySource,
        ),
      ],
      supporting: [
        {
          key: "lead-active-rule",
          label: A ? "حالة Odoo" : "Odoo state",
          value: A ? "مؤرشف" : "Archived",
        },
        {
          key: "lead-reason-rule",
          label: A ? "Lost Reason" : "Lost Reason",
          value: A ? "مطلوب" : "Required",
        },
      ],
      records: records(
        A ? "أمثلة Lost Leads كوّنت الرقم" : "Lost Lead records behind the figure",
        data.detail.rows.filter((row) => row.status === "lost" && row.recordType === "lead"),
        A
          ? "اضغط علامة الفتح بجوار أي اسم لمراجعة السجل نفسه داخل Odoo."
          : "Use the open icon beside any name to inspect that exact record in Odoo.",
      ),
      report: { to: "/lost", label: A ? "فتح تحليل Lost Leads" : "Open Lost Lead analysis" },
    },
    lostOpportunities: {
      id: "crm-marked-lost-in-period",
      title: A ? "سجلات اتعملها Lost خلال الفترة" : "CRM records marked Lost in period",
      value:
        lostMovement.availability === "available"
          ? fmtNum(lostMovement.total)
          : A
            ? "غير متاح"
            : "Unavailable",
      tone: "violet",
      icon: <XCircle size={17} />,
      definition: A
        ? "سجلات CRM فريدة لها حدث Lost مؤكد خلال الفترة، سواء Lead أو Opportunity وقت الحدث، حتى لو اتفتحت بعدها. Fresh تعني الإنشاء داخل الفترة؛ Old Cohort تعني الإنشاء قبلها. لا نستبعد التجهيز، ونستبعد Data Inventory صراحة."
        : "Unique CRM records with a confirmed Lost event in the period, whether Lead or Opportunity at the event, even if reopened later. Fresh means created in the period; Older Cohort means created earlier. Preparation is allowed; Data Inventory is explicitly excluded.",
      formula:
        lostMovement.availability === "available"
          ? `${fmtNum(lostMovement.fresh)} Fresh + ${fmtNum(lostMovement.older)} Old Cohort + ${fmtNum(lostMovement.undated)} invalid creation dates = ${fmtNum(lostMovement.total)} unique records`
          : undefined,
      provenance: {
        system: A
          ? "Odoo — سجل التغييرات مباشرة عبر /api/leads"
          : "Odoo — direct lifecycle tracking via /api/leads",
        model: "crm.lead + mail.message + mail.tracking.value",
        query:
          "inventory_bucket = False; DISTINCT crm.lead.id with mail.message.date in [start_utc, end_utc) AND ((stage_id changes to XMLID-resolved Lost AND lost_reason_id is set in the SAME message) OR (active changes 1→0 AND (reason is set OR Lost Comment in the SAME message))); type reconstructed at event time",
        fields: [
          "inventory_bucket",
          "create_date",
          "mail.message.id",
          "mail.message.date",
          "field_id",
          "old_value_integer",
          "new_value_integer",
          "old_value_char",
          "new_value_char",
          "stage XMLID",
        ],
        dateBasis: A
          ? "تاريخ الخسارة = تاريخ رسالة الحدث المؤكد فقط. حدود الفترة نصف مفتوحة بتوقيت القاهرة ومحوّلة إلى UTC؛ create_date يفصل الكارتين. لا نستخدم write_date أو lost_verification_date أو تاريخ آخر مرحلة."
          : "Lost date is the confirmed event message date only. Half-open Cairo boundaries are converted to UTC; create_date separates the two cards. No write_date, lost_verification_date or stage-date fallback.",
        note: A
          ? `حساب الاتصال: ${lostMovement.integrationLogin}. الشركات: ${lostMovement.companyIds.join(", ")}، مع السجلات بلا شركة عند عدم اختيار شركة. UTC: [${lostMovement.bounds.start ?? "all history"}, ${lostMovement.bounds.end ?? "now"}). المصدر والمالك والفريق والشركة قيم حالية وليست وقت الحدث. ${lostMovement.confidence}.`
          : `Integration: ${lostMovement.integrationLogin}. Companies: ${lostMovement.companyIds.join(", ")}; unassigned company included unless a company is selected. UTC: [${lostMovement.bounds.start ?? "all history"}, ${lostMovement.bounds.end ?? "now"}). Source, owner, team and company are CURRENT values. ${lostMovement.confidence}.`,
      },
      caveat:
        lostMovement.availability !== "available"
          ? A
            ? "لا يمكن إثبات وقت الخسارة: حساب التكامل يحتاج صلاحية قراءة mail.tracking.value أو مصدر الأحداث غير متاح. لم نعرض صفرًا ولم نستبدل الدليل بتاريخ تحديث."
            : "Lost timing cannot be verified: the integration account needs mail.tracking.value read access or the event source is unavailable. No zero or mutable date substitute is shown."
          : A
            ? `${fmtNum(lostMovement.ambiguousEvents)} حدثًا غير مؤكد و${fmtNum(lostMovement.unknownArchiveEvents)} أرشفة بلا دليل Lost خارج الكارتين. ${fmtNum(lostMovement.eventCount)} حدثًا مؤكّدًا تخص ${fmtNum(lostMovement.total)} سجلًا؛ ${fmtNum(lostMovement.repeatedRecords)} سجلًا تكررت خسارته. ${fmtNum(lostMovement.undated)} سجلًا بلا تاريخ إنشاء صالح خارج الكارتين.`
            : `${fmtNum(lostMovement.ambiguousEvents)} ambiguous events and ${fmtNum(lostMovement.unknownArchiveEvents)} unproven archives are excluded. ${fmtNum(lostMovement.eventCount)} confirmed events for ${fmtNum(lostMovement.total)} unique records; ${fmtNum(lostMovement.repeatedRecords)} repeatedly lost records. ${fmtNum(lostMovement.undated)} invalid creation dates are outside both cards.`,
      breakdowns: [
        breakdown(
          "lost-event-type",
          A ? "نوع السجل وقت الخسارة" : "Type at Lost event",
          data.lostMovementFacets.byType,
        ),
        breakdown(
          "lost-event-category",
          A ? "فئة سبب الخسارة المثبت" : "Confirmed Lost reason category",
          data.lostMovementFacets.byLostCategory,
        ),
        breakdown(
          "lost-event-reason",
          A ? "سبب الخسارة في الحدث" : "Reason in the Lost event",
          data.lostMovementFacets.byLostReason,
        ),
        breakdown(
          "lost-event-source",
          A ? "المصدر الحالي" : "Current source",
          data.lostMovementFacets.bySource,
        ),
      ],
      supporting: [
        {
          key: "fresh",
          label: A ? "إنشاء وخسارة خلال الفترة" : "Created and marked Lost in period",
          value:
            lostMovement.availability === "available"
              ? fmtNum(lostMovement.fresh)
              : A
                ? "غير متاح"
                : "Unavailable",
        },
        {
          key: "older",
          label: A ? "إنشاء أقدم وخسارة خلال الفترة" : "Older creation, marked Lost in period",
          value:
            lostMovement.availability === "available"
              ? fmtNum(lostMovement.older)
              : A
                ? "غير متاح"
                : "Unavailable",
        },
      ],
      records: {
        title: A ? "السجلات التي كوّنت الرقم" : "Records behind the figure",
        hint: A
          ? "تاريخ ومعرّف أحدث حدث Lost مؤكد داخل الفترة، ورابط نفس السجل في Odoo."
          : "Date and message ID of the latest confirmed in-period Lost event, linked to the exact Odoo record.",
        rows: data.lostMovementDetail.all.rows.slice(0, 8).map((row) => ({
          key: row.id,
          title: row.contact || `#${row.id}`,
          subtitle: `Created ${row.createdAt} · Lost ${row.lostDate} · message #${row.messageId} · ${row.typeAtEvent}`,
          value: row.lossReason || undefined,
          href: row.odooUrl,
        })),
        emptyLabel:
          lostMovement.availability === "available"
            ? A
              ? "لا توجد أحداث Lost مؤكدة في الفترة."
              : "No confirmed Lost events in the period."
            : A
              ? "الأحداث غير متاحة للتحقق؛ القائمة الفارغة ليست صفر خسائر."
              : "Evidence unavailable; an empty list does not mean zero losses.",
      },
    },
  };

  const currentLostCard = (kind: "pipeline" | "archived"): MetricDetail => {
    const archived = kind === "archived";
    const result = archived ? data.archivedLostLeads : data.freshLostPipeline;
    const rows = archived ? data.archivedLostLeadsDetail : data.freshLostPipelineDetail;
    const facets = archived ? data.archivedLostLeadsFacets : data.freshLostPipelineFacets;
    const available = result.availability === "available";
    return {
      id: archived ? "crm-archived-lost-leads" : "crm-fresh-lost-pipeline",
      title: archived
        ? A
          ? "Lost Leads مؤرشفة — إنشاء خلال الفترة"
          : "Archived Lost Leads — created in period"
        : A
          ? "Lost Opportunities — من سجلات الفترة"
          : "Lost Opportunities — created in period",
      value: available ? fmtNum(result.total) : A ? "غير متاح" : "Unavailable",
      tone: archived ? "rose" : "violet",
      icon: archived ? <Archive size={17} /> : <XCircle size={17} />,
      definition: archived
        ? A
          ? "سجلات نوعها الحالي Lead، أُنشئت خلال الفترة ثم أصبحت مؤرشفة ومعها Lost Reason. تحتفظ بمرحلتها الأصلية؛ ليست Opportunities في عمود Lost، وليست كلها Duplicate. الأسباب أدناه هي القيم المسجلة حاليًا. الأرشفة بلا سبب لا تُعد Lost هنا."
          : "Current-type Leads created in the period, now archived with a Lost Reason. They keep their original stage and are not Opportunities in the Lost pipeline column. They are not assumed to be Duplicate: the reasons below are current recorded values. Archive without a reason is not counted here."
        : A
          ? "نفس فلتر Odoo Pipeline: Creation Date داخل الفترة + Stage Is Lost. Opportunities نشطة موجودة حاليًا في Lost؛ لا نضيف Lost Leads المؤرشفة. هذا كوهورت إنشاء بحالة حالية، وليس إثباتًا أن الخسارة حدثت خلال الفترة."
          : "Matches Odoo Pipeline: Creation Date in period + Stage Is Lost. Active Opportunities currently in the Lost stage; archived Lost Leads are not added. This is a creation cohort with a current state, not proof of in-period loss timing.",
      formula: archived
        ? "COUNT DISTINCT crm.lead.id: type = lead AND active = False AND lost_reason_id != False AND create_date in period"
        : "COUNT DISTINCT crm.lead.id: type = opportunity AND active = True AND stage_is_lost = True AND create_date in period",
      provenance: {
        system: A ? "Odoo CRM مباشرة عبر /api/leads" : "Direct Odoo CRM via /api/leads",
        model: "crm.lead",
        query: JSON.stringify(result.domain),
        fields: [
          "inventory_bucket",
          "type",
          "active",
          "stage_is_lost",
          "stage_id",
          "create_date",
          "lost_reason_id",
        ],
        dateBasis: A
          ? "create_date فقط بحدود القاهرة نصف المفتوحة، محوّلة إلى UTC. لا نعتمد على write_date أو Lost Verification Date، ولا ندّعي وقت حدوث الخسارة."
          : "create_date only, using half-open Cairo boundaries converted to UTC. No write_date or Lost Verification Date; loss timing is not claimed.",
        note: A
          ? `حساب الربط: ${result.integrationLogin}. الشركات: ${result.companyIds.join(", ")}. استبعاد Inventory صريح. المصدر والسبب والمالك والفريق قيم حالية. آخر قراءة: ${result.fetchedAt}.`
          : `Integration: ${result.integrationLogin}. Companies: ${result.companyIds.join(", ")}. Explicit Inventory exclusion. Source, reason, owner and team are CURRENT. Read at ${result.fetchedAt}.`,
      },
      caveat: !available
        ? A
          ? "قراءة CRM المباشرة غير متاحة؛ لم نستبدلها بصفر أو كاش قديم."
          : "Direct CRM read unavailable; no zero or stale-cache substitute."
        : A
          ? "تاريخ إنشاء السجل معروف، لكن هذا الكارد لا يحدد تاريخ حصول الـLost. Duplicate اسم سبب مسجل، وليس إثباتًا مستقلًا بأن العميل مكرر."
          : "Creation date is known, but this card does not establish loss timing. Duplicate is a recorded reason, not independent proof that the customer is duplicated.",
      breakdowns: [
        breakdown(
          `${kind}-current-reasons`,
          A ? "الأسباب المسجلة حاليًا" : "Current recorded reasons",
          facets.byLostReason,
        ),
        breakdown(
          `${kind}-current-categories`,
          A ? "فئات الأسباب الحالية" : "Current reason categories",
          facets.byLostCategory,
        ),
        breakdown(
          `${kind}-current-sources`,
          A ? "المصادر الحالية" : "Current sources",
          facets.bySource,
        ),
        breakdown(
          `${kind}-current-teams`,
          A ? "فرق المبيعات الحالية" : "Current sales teams",
          facets.byTeam,
        ),
      ],
      records: {
        title: A ? "السجلات التي كوّنت الرقم" : "Records behind the figure",
        hint: available
          ? A
            ? `محسوب من ${fmtNum(rows.total)} سجلًا؛ المعروض أمثلة مرتبطة بسجلات Odoo نفسها.`
            : `Computed from ${fmtNum(rows.total)} records; displayed examples link to the exact Odoo records.`
          : A
            ? "السجلات غير متاحة للتحقق."
            : "Records unavailable for verification.",
        rows: rows.rows.slice(0, 8).map((row) => ({
          key: row.id,
          title: row.contact || `#${row.id}`,
          subtitle: `${row.createdAt} · ${row.stage} · ${row.source}`,
          value: row.lossReason || undefined,
          href: row.odooUrl,
        })),
        emptyLabel: available
          ? A
            ? "لا توجد سجلات تطابق هذا الفلتر."
            : "No records match this filter."
          : A
            ? "تعذر قراءة السجلات؛ القائمة ليست صفرًا."
            : "Read failed; an empty list is not a zero.",
      },
      report: { to: "/lost", label: A ? "فتح تحليل Lost" : "Open Lost analysis" },
    };
  };

  const eventCohortCard = (
    cohort: "fresh" | "older",
    origin: "all" | "lead" = "all",
  ): MetricDetail => {
    const base = metricDetails.lostOpportunities;
    const leadOrigin = origin === "lead";
    const rows = leadOrigin ? data.oldLeadLostDetail : data.lostMovementDetail[cohort];
    const facets = leadOrigin ? data.oldLeadLostFacets : data.lostMovementCohortFacets[cohort];
    const count = leadOrigin ? data.oldLeadLost : lostMovement[cohort];
    const available = lostMovement.availability === "available" && count !== null;
    return {
      ...base,
      id: leadOrigin ? "crm-old-lost-leads" : `crm-lost-event-${cohort}`,
      title: leadOrigin
        ? A
          ? "Old Lost Leads — إنشاء أقدم وخسارة هذا الشهر"
          : "Old Lost Leads — older creation, Lost this period"
        : cohort === "fresh"
          ? A
            ? "Fresh — إنشاء وخسارة خلال الفترة"
            : "Fresh — created and marked Lost in period"
          : A
            ? "Old Cohort — إنشاء أقدم وخسارة خلال الفترة"
            : "Older Cohort — marked Lost in period",
      value: available ? fmtNum(count) : A ? "غير متاح" : "Unavailable",
      definition: leadOrigin
        ? A
          ? "سجلات كان نوعها Lead عند الإنشاء، أُنشئت قبل بداية الفترة، ولها حدث Lost مؤكد داخل الفترة الحالية. السجل يُحسب مرة واحدة حتى لو تم تحويله لاحقًا إلى Opportunity."
          : "Records created as Leads before the selected period with a confirmed Lost event inside the current period. Each record counts once even if it was later converted to an Opportunity."
        : cohort === "fresh"
          ? A
            ? "سجلات CRM أُنشئت داخل الفترة المحددة ولها حدث Lost مؤكد داخل نفس الفترة؛ النوع وقت الخسارة موضح أدناه. السجل يُحسب مرة واحدة حتى لو تكررت خسارته أو اتفتح بعدها."
            : "CRM records created in the selected period with a confirmed Lost event in the same period. Type at event is shown below. Each record counts once, even if repeatedly lost or reopened."
          : A
            ? "سجلات CRM أُنشئت قبل بداية الفترة المحددة ولها حدث Lost مؤكد داخل الفترة، مهما كانت حالتها الحالية. السجل يُحسب مرة واحدة؛ لا نعتبر تحديثات الترحيل أحداث خسارة."
            : "CRM records created before the selected period with a confirmed Lost event in it, regardless of current state. Each record counts once; migration writes are not Lost events.",
      formula: leadOrigin
        ? "DISTINCT crm.lead.id: origin type = lead AND create_date < period_start AND confirmed Lost event in period"
        : cohort === "fresh"
          ? "DISTINCT crm.lead.id: create_date in period AND confirmed Lost event in period"
          : "DISTINCT crm.lead.id: create_date before period AND confirmed Lost event in period",
      provenance: {
        ...base.provenance!,
        query: `${base.provenance!.query}; AND ${leadOrigin ? "origin_type_at_creation = lead AND create_date < start_utc" : cohort === "fresh" ? "create_date in [start_utc, end_utc)" : "create_date < start_utc"}`,
      },
      supporting: [
        {
          key: "total",
          label: A
            ? "كل السجلات ذات حدث Lost مؤكد خلال الفترة"
            : "All records with confirmed in-period Lost",
          value: available ? fmtNum(count) : "—",
        },
      ],
      breakdowns: [
        breakdown(`${cohort}-type`, A ? "نوع السجل وقت الخسارة" : "Type at event", facets.byType),
        ...(cohort === "older"
          ? [
              breakdown(
                "older-creation-months",
                A ? "حسب شهر الإنشاء الأصلي" : "By original creation month",
                leadOrigin ? data.oldLeadLostCreationMonths : data.olderLostCreationMonths,
              ),
            ]
          : []),
        breakdown(
          `${cohort}-reason`,
          A ? "سبب الخسارة المثبت في الحدث" : "Confirmed event reason",
          facets.byLostReason,
        ),
        breakdown(`${cohort}-source`, A ? "المصدر الحالي" : "Current source", facets.bySource),
      ],
      records: {
        ...base.records!,
        rows: rows.rows.slice(0, 8).map((row) => ({
          key: row.id,
          title: row.contact || `#${row.id}`,
          subtitle: `Created ${row.createdAt} · Lost ${row.lostDate} · message #${row.messageId} · ${row.typeAtEvent}`,
          value: row.lossReason || undefined,
          href: row.odooUrl,
        })),
        hint: available
          ? A
            ? `كل الرقم محسوب من ${fmtNum(rows.total)} سجلًا؛ معرّف الرسالة يثبت الحدث. القائمة المعروضة أمثلة فقط.`
            : `The figure is computed from ${fmtNum(rows.total)} records; message IDs identify the evidence. The displayed list is a sample only.`
          : A
            ? "السجلات غير متاحة للتحقق؛ لا يمكن تحديد عددها من هذا المصدر الآن."
            : "Evidence records are unavailable; their count cannot be determined from this source right now.",
      },
    };
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
              detail={metricDetails.won}
              card={{ index: 3, sub: A ? "من Won stage" : "From the Won stage" }}
            />
          </KpiRow>
        </PageSection>

        <PageSection
          level="primary"
          title={A ? "Lost — نطاقات منفصلة وواضحة" : "Lost — separate, explicit populations"}
          hint={
            A
              ? "Opportunities من إنشاء الفترة بحالة Lost الحالية، وLeads أقدم حدث لها Lost داخل الفترة، وLost Leads مؤرشفة في كارد مستقل."
              : "Current Lost Opportunities created in the period; older Leads with a Lost event in the period; archived Lost Leads separately."
          }
          icon={<XCircle size={17} />}
        >
          <div className="grid gap-4 xl:grid-cols-3 md:grid-cols-2">
            <MetricDetailTrigger
              detail={currentLostCard("pipeline")}
              card={{
                index: 0,
                sub: A
                  ? "Creation Date خلال الفترة + Stage Is Lost"
                  : "Creation Date in period + Stage Is Lost",
              }}
            />
            <MetricDetailTrigger
              detail={eventCohortCard("older", "lead")}
              card={{
                index: 1,
                sub: A
                  ? "Lead قديم + Lost خلال الفترة"
                  : "Created as Lead before period + Lost in period",
              }}
            />
            <MetricDetailTrigger
              detail={currentLostCard("archived")}
              card={{
                index: 2,
                sub: A
                  ? "Lead مؤرشف + Lost Reason — الأسباب بالتفصيل"
                  : "Archived Lead + Lost Reason — see recorded reasons",
              }}
            />
          </div>
          <div
            role="status"
            className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {A
              ? "الكارد الثاني يطابق التعريف المطلوب: Lead أقدم من بداية الفترة + حدث Lost مؤكد داخل الفترة. لا نخلطه مع مخزون Opportunities القديمة الحالي."
              : "The second card matches the requested definition: a Lead created before the period plus a confirmed Lost event inside the period. It is not mixed with the current stock of old Opportunities."}
          </div>
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
          label={A ? "كفاءة التحويل والمصادر" : "Conversion efficiency and sources"}
          hint={
            A
              ? "معدل التحويل والخسارة وزمن الإغلاق وتكلفة العميل، ومن أين جاء العملاء"
              : "Conversion, loss, close time and cost per lead — and where the leads came from"
          }
        >
          <OverviewEfficiency />
        </MoreDetails>

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
