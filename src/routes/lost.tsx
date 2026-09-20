import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Info,
  MessageSquareWarning,
  Percent,
  TrendingDown,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import {
  BarList,
  Card,
  ErrorState,
  Notice,
  Pill,
  SectionTitle,
  Segmented,
  Skeleton,
} from "@/components/ui-bits";
import { DashboardPageHeader, KpiRow } from "@/components/dashboard-bits";
import { CourseLeadLossComparison } from "@/components/CourseLeadLossComparison";
import { CourseLostMovement } from "@/components/CourseLostMovement";
import { MetricDetailTrigger } from "@/components/metric-detail";
import type { MetricBreakdownGroup, MetricDetail } from "@/lib/metric-detail";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { DataTable, type Col } from "@/components/DataTable";
import type { Grouped, LostBreakdown, Matrix, Totals } from "@/lib/types";
import type { CourseLeadLossReport, CourseLostMovementReport } from "@/lib/course-lead-loss";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/lost")({ component: Lost });

type ShareView =
  "category" | "reason" | "type" | "course" | "team" | "salesperson" | "source" | "month";

interface DuplicateEvidenceView {
  supported: boolean;
  matchedRecordCount: number;
  sources: ("provider_id" | "phone")[];
}

interface LostRowView {
  id: string;
  contact: string;
  phone: string;
  mobile: string;
  email: string;
  odooUrl: string;
  createdAt: string;
  closeDate: string;
  lostDateBasis: string;
  recordType: "lead" | "opportunity";
  active: boolean;
  category: string;
  reportingDate: string;
  closedInPeriod?: boolean;
  campaign: string;
  adName: string;
  reason: string;
  rawReason?: string;
  canonicalReasonKey?: string;
  canonicalReasonLabelAr?: string;
  canonicalReasonLabelEn?: string;
  duplicateEvidence: DuplicateEvidenceView | null;
  course: string;
  mainCategory: string;
  salesTeam: string;
  salesperson: string;
  source: string;
  stage: string;
}

interface Resp {
  breakdown: LostBreakdown;
  courseLeadLoss: CourseLeadLossReport;
  courseLostMovement: CourseLostMovementReport;
  cohortAuthority: {
    source: "odoo_live" | "snapshot_fallback";
    total: number;
    lostLeads: number;
    lostOpportunities: number;
    snapshotTotal: number;
    snapshotDelta: number;
    fetchedAt: string;
  };
  teamLostRates: { team: string; leads: number; lost: number; rate: number | null }[];
  totals: Totals;
  closureMovement: {
    closedLost: number;
    fromCampaign: number;
    createdInPeriod: number;
    campaignCreatedInPeriod: number;
    fromOlderCohorts: number;
    olderCohortClosedLostInPeriod?: number;
    undatedCohortClosedLostInPeriod?: number;
    lostLeads: number;
    lostOpportunities: number;
    dateBasisCounts: Record<string, number>;
    dateFieldAudit: { closeDateInPeriod: number; lostDateInPeriod: number };
  };
  detail: {
    rows: LostRowView[];
    total: number;
    truncated: boolean;
    offset: number;
    limit: number;
    reasonKey?: string;
    courseKey?: string;
    scope?: "closed" | "cohort" | "cohort-live";
  };
}

/** A Lost distribution the response already carried, as a drill-down section. */
function lostSection(
  id: string,
  title: string,
  rows: Grouped[],
  lang: "ar" | "en",
): MetricBreakdownGroup {
  return {
    id,
    title,
    rows: [...rows]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((row) => ({
        key: row.label,
        label: row.label,
        value: row.count,
        display: fmtNum(row.count),
        meta: fmtPct(row.share, 1),
        tone: "rose" as const,
      })),
    emptyLabel: lang === "ar" ? "لا توجد بيانات في الفترة" : "Nothing in this period",
  };
}

/** Canonical reason keys in the reader's language; unknown keys fall back to themselves. */
type ShareRow = Grouped & { key?: string };

function translatedReasons(breakdown: LostBreakdown, lang: "ar" | "en"): ShareRow[] {
  return breakdown.byReason.map((row) => ({
    ...row,
    key: row.label,
    label: breakdown.reasonLabels?.[row.label]?.[lang] ?? row.label,
  }));
}

function translatedReasonMatrix(
  breakdown: LostBreakdown,
  matrix: Matrix,
  lang: "ar" | "en",
): Matrix {
  return {
    ...matrix,
    rows: matrix.rows.map((key) => breakdown.reasonLabels?.[key]?.[lang] ?? key),
  };
}

/**
 * What the four Lost figures are made of.
 *
 * The two dates matter more here than anywhere else on the dashboard: "total
 * lost" counts leads CREATED in the window, and "closed in period" counts deals
 * CLOSED in it. They are different populations and the drill-down says so.
 */
function lostMetrics(data: Resp, lang: "ar" | "en"): Record<string, MetricDetail> {
  const A = lang === "ar";
  const B = data.breakdown;
  const T = data.totals;
  const M = data.closureMovement;
  // Reasons arrive grouped by canonical key; each is shown in the reader's language.
  const reasons = translatedReasons(B, lang);
  const topReason = reasons[0] ?? null;

  const common = [
    lostSection("categories", A ? "فئات الخسارة" : "Loss categories", B.byCategory, lang),
    lostSection("reasons", A ? "أهم أسباب الخسارة" : "Main loss reasons", reasons, lang),
    lostSection("teams", A ? "أكثر الفرق تأثرًا" : "Most affected teams", B.byTeam, lang),
    lostSection("courses", A ? "أكثر الدورات تأثرًا" : "Most affected courses", B.byCourse, lang),
    lostSection("sources", A ? "حسب المصدر" : "By source", B.bySource, lang),
  ];

  return {
    total: {
      id: "lost.lost",
      title: A ? "إجمالي الصفقات الضائعة" : "Total lost",
      value: fmtNum(B.total),
      tone: "rose",
      icon: <TrendingDown size={16} />,
      definition: A
        ? "كل حالات Lost المطابقة لعقد CRM 1.26: الـLead المؤرشف بسبب، والـOpportunity الموجودة في Lost stage، مع التاريخ القديم المؤرشف."
        : "Every loss under CRM 1.26: archived Leads with a reason, Opportunities in the Lost stage, plus archived historical losses.",
      formula: A
        ? `${fmtNum(B.total)} صفقة ضائعة، محسوبة بتاريخ إنشاء الليد لا بتاريخ إغلاقه.`
        : `${fmtNum(B.total)} lost deals, counted on the lead's creation date and not on its close date.`,
      supporting: [
        { key: "rate", label: A ? "نسبة الخسارة" : "Lost rate", value: fmtPct(T.lostRate, 2) },
        { key: "leads", label: A ? "إجمالي العملاء" : "All leads", value: fmtNum(T.totalLeads) },
        { key: "won", label: A ? "صفقات رابحة" : "Won deals", value: fmtNum(T.won) },
        {
          key: "closed",
          label: A ? "أُغلقت في الفترة" : "Closed in period",
          value: fmtNum(M.closedLost),
        },
      ],
      breakdowns: common,
      records: {
        title: A ? "نسبة الخسارة حسب الفريق" : "Lost rate by team",
        rows: [...data.teamLostRates]
          .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
          .slice(0, 5)
          .map((row) => ({
            key: row.team,
            title: row.team,
            subtitle: `${fmtNum(row.lost)} / ${fmtNum(row.leads)}`,
            value: fmtPct(row.rate, 1),
          })),
      },
    },
    rate: {
      id: "lost.lostRate",
      title: A ? "نسبة الخسارة" : "Lost rate",
      value: fmtPct(T.lostRate, 2),
      tone: "rose",
      icon: <Percent size={16} />,
      definition: A
        ? "نسبة العملاء المحتملين الذين انتهت صفقتهم بالخسارة داخل الفترة. النسبة وحدها بلا معنى بغير عدديها."
        : "The share of leads whose deal ended as lost inside the period. The percentage means nothing without both of its numbers.",
      formula: `${fmtNum(T.lost)} ÷ ${fmtNum(T.totalLeads)} = ${fmtPct(T.lostRate, 2)}`,
      supporting: [
        { key: "lost", label: A ? "البسط · ضائعة" : "Numerator · lost", value: fmtNum(T.lost) },
        {
          key: "leads",
          label: A ? "المقام · كل العملاء" : "Denominator · all leads",
          value: fmtNum(T.totalLeads),
        },
        { key: "won", label: A ? "رابحة" : "Won", value: fmtNum(T.won) },
        {
          key: "open",
          label: A ? "ما زال مفتوحًا" : "Still open",
          value: fmtNum(Math.max(0, T.totalLeads - T.won - T.lost)),
        },
      ],
      breakdowns: [
        {
          id: "teams",
          title: A ? "النسبة حسب الفريق" : "Rate by team",
          rows: [...data.teamLostRates]
            .filter((row) => row.leads > 0)
            .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
            .slice(0, 5)
            .map((row) => ({
              key: row.team,
              label: row.team,
              value: row.rate ?? 0,
              display: fmtPct(row.rate, 1),
              meta: `${fmtNum(row.lost)} / ${fmtNum(row.leads)}`,
              tone: "rose" as const,
            })),
          emptyLabel: A ? "لا توجد فرق بعملاء" : "No team carries leads",
        },
        ...common.slice(0, 2),
      ],
    },
    closed: {
      id: "lost.closed",
      title: A ? "Lost بتاريخ إغلاق داخل الفترة" : "Lost by close date in period",
      value: fmtNum(M.closedLost),
      tone: "amber",
      icon: <CalendarClock size={16} />,
      definition: A
        ? "حالات Lost التي سُجل تاريخ خسارتها داخل الفترة: date_closed للـLeads وlost_verification_date للـOpportunities."
        : "Losses dated inside the window: date_closed for Leads and lost_verification_date for Opportunities.",
      formula: A
        ? `منها ${fmtNum(M.createdInPeriod)} أُنشئت داخل الفترة و${fmtNum(M.fromOlderCohorts)} من كوهورتات أقدم.`
        : `Of these, ${fmtNum(M.createdInPeriod)} were created inside the window and ${fmtNum(M.fromOlderCohorts)} came from older cohorts.`,
      supporting: [
        {
          key: "created",
          label: A ? "أُنشئت داخل الفترة" : "Created in period",
          value: fmtNum(M.createdInPeriod),
        },
        {
          key: "older",
          label: A ? "من كوهورتات أقدم" : "From older cohorts",
          value: fmtNum(M.olderCohortClosedLostInPeriod ?? M.fromOlderCohorts),
        },
        ...(M.undatedCohortClosedLostInPeriod
          ? [
              {
                key: "undated",
                label: A ? "بلا تاريخ إنشاء صالح" : "No valid creation date",
                value: fmtNum(M.undatedCohortClosedLostInPeriod),
              },
            ]
          : []),
        {
          key: "campaign",
          label: A ? "من حملات" : "From campaigns",
          value: fmtNum(M.fromCampaign),
        },
        { key: "cohort", label: A ? "كوهورت الفترة" : "Cohort lost", value: fmtNum(B.total) },
      ],
      breakdowns: common.slice(0, 4),
    },
    reason: {
      id: "lost.reason",
      title: A ? "أقدم سبب متكرر" : "Top recurring reason",
      value: topReason?.label ?? "—",
      tone: "amber",
      icon: <MessageSquareWarning size={16} />,
      definition: topReason
        ? A
          ? `أكثر سبب خسارة تكرارًا في الفترة: ${fmtNum(topReason.count)} صفقة، أي ${fmtPct(topReason.share, 1)} من كل الخسائر المصنّفة.`
          : `The most frequent loss reason in the period: ${fmtNum(topReason.count)} deals, ${fmtPct(topReason.share, 1)} of all classified losses.`
        : A
          ? "لا توجد أسباب خسارة مصنّفة في هذه الفترة."
          : "No classified loss reason in this period.",
      supporting: topReason
        ? [
            { key: "count", label: A ? "عدد الصفقات" : "Deals", value: fmtNum(topReason.count) },
            { key: "share", label: A ? "نسبتها" : "Share", value: fmtPct(topReason.share, 1) },
            { key: "total", label: A ? "إجمالي الخسائر" : "Total lost", value: fmtNum(B.total) },
            {
              key: "reasons",
              label: A ? "عدد الأسباب المصنّفة" : "Classified reasons",
              value: fmtNum(B.byReason.length),
            },
          ]
        : undefined,
      breakdowns: [common[1], common[0]],
    },
  };
}

function Lost() {
  const reportingPeriod = useReportingPeriod();
  const { t, lang } = useI18n();
  const [matrixView, setMatrixView] = useState<"team" | "course">("team");
  const [courseReportView, setCourseReportView] = useState<"movement" | "cohort">("cohort");

  /** Tell Nexus which view is open — the route does not change with the tab. */
  useRegisterNexusView("lost", {
    tab: matrixView,
    parameters: { courseReport: courseReportView },
  });
  const [shareView, setShareView] = useState<ShareView>("reason");
  const [selectedReason, setSelectedReason] = useState<{ key: string; label: string } | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<{
    key: string;
    label: string;
    scope: "closed" | "cohort-live";
  } | null>(null);
  const [reasonOffset, setReasonOffset] = useState(0);
  const [courseOffset, setCourseOffset] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<LostRowView | null>(null);
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/lost");
  const reasonQuery = useApi<Resp>(
    `/api/lost?detailReason=${encodeURIComponent(selectedReason?.key ?? "")}&detailOffset=${reasonOffset}&detailLimit=50`,
    { enabled: selectedReason !== null },
  );
  const courseQuery = useApi<Resp>(
    `/api/lost?detailCourse=${encodeURIComponent(selectedCourse?.key ?? "")}&detailScope=${selectedCourse?.scope ?? "cohort-live"}&detailOffset=${courseOffset}&detailLimit=50`,
    { enabled: selectedCourse !== null },
  );

  useEffect(() => setReasonOffset(0), [selectedReason?.key]);
  useEffect(() => setCourseOffset(0), [selectedCourse?.key]);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  // Built from the response the strip already renders, so a card and its panel
  // can never disagree.
  const metrics = data ? lostMetrics(data, lang) : null;
  const lostDateFallbackCount = data
    ? Object.entries(data.closureMovement.dateBasisCounts)
        .filter(([basis]) => basis.includes("fallback") || basis === "unknown")
        .reduce((sum, [, count]) => sum + count, 0)
    : 0;

  const cols: Col<LostRowView>[] = [
    {
      key: "contact",
      header: lang === "ar" ? "الليد" : "Lead",
      sticky: true,
      always: true,
      minWidth: "180px",
      sortValue: (r) => r.contact || r.id,
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-text" title={r.contact}>
            {r.contact || `CRM #${r.id}`}
          </div>
          <div className="num mt-0.5 text-[10px] text-text-muted">CRM #{r.id}</div>
        </div>
      ),
    },
    {
      key: "reportingDate",
      header: lang === "ar" ? "تاريخ إنشاء الليد" : "Lead creation date",
      width: "120px",
      sortValue: (r) => r.reportingDate,
      render: (r) => fmtDate(r.reportingDate, lang),
    },
    {
      key: "closeDate",
      header: lang === "ar" ? "اتقفل Lost إمتى" : "Lost close date",
      width: "120px",
      sortValue: (r) => r.closeDate,
      render: (r) => fmtDate(r.closeDate, lang),
    },
    {
      key: "recordType",
      header: lang === "ar" ? "النوع" : "Type",
      sortValue: (r) => r.recordType,
      render: (r) => (
        <Pill tone={r.recordType === "lead" ? "brand" : "warning"}>
          {r.recordType === "lead" ? "Lead" : "Opportunity"}
        </Pill>
      ),
    },
    {
      key: "category",
      header: lang === "ar" ? "فئة الخسارة" : "Lost category",
      sortValue: (r) => r.category,
      render: (r) => r.category || "—",
    },
    {
      key: "reason",
      header: t("loss_reason"),
      // Canonical reason on screen; the raw Odoo spelling stays on hover and in the CSV.
      sortValue: (r) => r.canonicalReasonKey ?? r.reason,
      render: (r) => {
        const label =
          (lang === "ar" ? r.canonicalReasonLabelAr : r.canonicalReasonLabelEn) || r.reason || "—";
        return (
          <span
            className="truncate block max-w-[220px]"
            title={r.rawReason !== undefined ? `${label} · Odoo: ${r.rawReason || "—"}` : r.reason}
          >
            {label}
          </span>
        );
      },
    },
    {
      key: "duplicateEvidence",
      header: lang === "ar" ? "دليل التكرار" : "Duplicate evidence",
      sortValue: (r) => (r.duplicateEvidence?.supported ? 1 : 0),
      render: (r) =>
        r.canonicalReasonKey !== "duplicate" ? (
          <span className="text-text-subtle">—</span>
        ) : r.duplicateEvidence?.supported ? (
          <Pill tone="success">
            {lang === "ar"
              ? `${fmtNum(r.duplicateEvidence.matchedRecordCount)} مطابق`
              : `${fmtNum(r.duplicateEvidence.matchedRecordCount)} match`}
          </Pill>
        ) : (
          <Pill tone="warning">{lang === "ar" ? "يحتاج مراجعة" : "Needs review"}</Pill>
        ),
    },
    {
      key: "course",
      header: t("course"),
      sortValue: (r) => r.course,
      render: (r) => r.course || "—",
    },
    {
      key: "salesTeam",
      header: t("sales_team"),
      sortValue: (r) => r.salesTeam,
      render: (r) => (
        <span className="truncate block max-w-[160px]" title={r.salesTeam}>
          {r.salesTeam || "—"}
        </span>
      ),
    },
    {
      key: "salesperson",
      header: t("salesperson"),
      sortValue: (r) => r.salesperson,
      render: (r) => (
        <span className="truncate block max-w-[150px]" title={r.salesperson}>
          {r.salesperson || "—"}
        </span>
      ),
    },
    {
      key: "source",
      header: t("source"),
      sortValue: (r) => r.source,
      render: (r) => r.source || "—",
    },
    {
      key: "campaign",
      header: t("campaign"),
      sortValue: (r) => r.campaign,
      render: (r) => (
        <span className="truncate block max-w-[180px]" title={r.campaign}>
          {r.campaign || "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<TrendingDown size={20} />}
        title={t("lost")}
        subtitle={
          lang === "ar"
            ? "Lost Leads وLost Opportunities بقواعد CRM 1.26، مع فصل الكوهورت عن حركة الخسارة"
            : "Lost Leads and Opportunities under CRM 1.26, separating cohort quality from loss movement"
        }
        period={reportingPeriod}
      />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          {/* Four coloured cards rather than four cells of a divided strip
              inside a card. Same four figures, each of them now openable — and
              one less card-inside-a-card. */}
          <KpiRow>
            <MetricDetailTrigger
              detail={{ ...metrics!.total, title: t("total_lost") }}
              card={{
                index: 0,
                sub: lang === "ar" ? "حسب تاريخ إنشاء الليد" : "By lead creation date",
              }}
            />
            <MetricDetailTrigger
              detail={{ ...metrics!.rate, title: t("lost_rate") }}
              card={{
                index: 1,
                sub: `${fmtNum(data.totals.lost)} / ${fmtNum(data.totals.totalLeads)}`,
              }}
            />
            <MetricDetailTrigger
              detail={metrics!.closed}
              card={{
                index: 2,
                sub:
                  lang === "ar"
                    ? `يشمل ${fmtNum(data.closureMovement.fromOlderCohorts)} سجلًا من إنشاء أقدم`
                    : `Includes ${fmtNum(data.closureMovement.fromOlderCohorts)} older-created records`,
              }}
            />
            <MetricDetailTrigger
              detail={metrics!.reason}
              card={{
                index: 3,
                valueWrap: true,
                sub: data.breakdown.byReason[0]
                  ? `${fmtNum(data.breakdown.byReason[0].count)} · ${fmtPct(data.breakdown.byReason[0].share, 1)}`
                  : undefined,
              }}
            />
          </KpiRow>

          <Card className="border-brand/20 bg-brand-soft/35">
            <SectionTitle
              hint={
                lang === "ar"
                  ? "ده تقرير حركة تشغيلية بتاريخ الإغلاق؛ منفصل عن تحليل جودة حملات الفترة اللي فوق."
                  : "This operational movement uses close date and stays separate from the acquisition cohort above."
              }
            >
              <span className="inline-flex items-center gap-2">
                <CalendarClock size={17} className="text-brand" />
                {lang === "ar"
                  ? "إيه اللي اتقفل Lost خلال الفترة؟"
                  : "What closed Lost in the period?"}
              </span>
            </SectionTitle>
            <p className="mb-4 text-sm leading-7 text-text-muted">
              {lang === "ar"
                ? `خلال الفترة اتسجل ${fmtNum(data.closureMovement.closedLost)} حالة Lost: ${fmtNum(data.closureMovement.lostLeads)} Leads و${fmtNum(data.closureMovement.lostOpportunities)} Opportunities. منها ${fmtNum(data.closureMovement.createdInPeriod)} أُنشئت داخل الفترة و${fmtNum(data.closureMovement.fromOlderCohorts)} من إنشاء أقدم.`
                : `${fmtNum(data.closureMovement.closedLost)} losses were dated in the period: ${fmtNum(data.closureMovement.lostLeads)} Leads and ${fmtNum(data.closureMovement.lostOpportunities)} Opportunities. ${fmtNum(data.closureMovement.createdInPeriod)} were created in-period and ${fmtNum(data.closureMovement.fromOlderCohorts)} came from older cohorts.`}
            </p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {[
                [lang === "ar" ? "اتقفل Lost" : "Closed Lost", data.closureMovement.closedLost],
                [lang === "ar" ? "Lost Leads" : "Lost Leads", data.closureMovement.lostLeads],
                [
                  lang === "ar" ? "Lost Opportunities" : "Lost Opportunities",
                  data.closureMovement.lostOpportunities,
                ],
                [
                  lang === "ar" ? "من إنشاء أقدم" : "Created before period",
                  data.closureMovement.fromOlderCohorts,
                ],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-xl border border-border bg-surface/85 p-3"
                >
                  <div className="text-[11px] text-text-muted">{label}</div>
                  <div className="num mt-1 text-xl font-semibold text-text">
                    {fmtNum(Number(value))}
                  </div>
                </div>
              ))}
            </div>
            {lostDateFallbackCount > 0 && (
              <Notice tone="warning" className="mt-3" icon={<Info size={16} />}>
                {lang === "ar"
                  ? `${fmtNum(lostDateFallbackCount)} Opportunity لا تملك lost_verification_date؛ تاريخ الحركة فيها محسوب من آخر تغيير مرحلة وفق عقد CRM 1.26، ومعلّم بوضوح داخل تفاصيل السجل.`
                  : `${fmtNum(lostDateFallbackCount)} Opportunities have no lost_verification_date. Their movement date uses the last stage change under CRM 1.26 and is explicitly labelled in record details.`}
              </Notice>
            )}
          </Card>

          {data.cohortAuthority.snapshotDelta !== 0 && (
            <Notice tone="warning" icon={<AlertTriangle size={16} />}>
              {lang === "ar"
                ? `Odoo المباشر = ${fmtNum(data.cohortAuthority.total)} (${fmtNum(data.cohortAuthority.lostLeads)} Lost Leads + ${fmtNum(data.cohortAuthority.lostOpportunities)} Lost Opportunities). الـsnapshot المتأخر كان ${fmtNum(data.cohortAuthority.snapshotTotal)}؛ لذلك الأرقام أدناه تعتمد Odoo المباشر.`
                : `Live Odoo = ${fmtNum(data.cohortAuthority.total)} (${fmtNum(data.cohortAuthority.lostLeads)} Lost Leads + ${fmtNum(data.cohortAuthority.lostOpportunities)} Lost Opportunities). The delayed snapshot was ${fmtNum(data.cohortAuthority.snapshotTotal)}, so the figures below use live Odoo.`}
            </Notice>
          )}

          <div className="rounded-2xl border border-border bg-surface p-1.5 shadow-sm">
            <div
              className="grid grid-cols-2 gap-1.5"
              role="tablist"
              aria-label={lang === "ar" ? "تقارير Lost حسب الكورس" : "Course Lost reports"}
            >
              <button
                type="button"
                role="tab"
                aria-selected={courseReportView === "cohort"}
                onClick={() => setCourseReportView("cohort")}
                className={`rounded-xl px-3 py-3 text-xs font-bold transition sm:text-sm ${courseReportView === "cohort" ? "bg-brand text-white shadow-md shadow-brand/20" : "text-text-muted hover:bg-surface-2"}`}
              >
                {lang === "ar"
                  ? "Lost حسب الكورس · Creation Date"
                  : "Lost by course · creation date"}
                <span className="num ms-2 rounded-full bg-white/15 px-2 py-0.5">
                  {fmtNum(data.courseLeadLoss.totals.lost)}
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={courseReportView === "movement"}
                onClick={() => setCourseReportView("movement")}
                className={`rounded-xl px-3 py-3 text-xs font-bold transition sm:text-sm ${courseReportView === "movement" ? "bg-danger text-white shadow-md shadow-danger/20" : "text-text-muted hover:bg-surface-2"}`}
              >
                {lang === "ar" ? "حركة Lost · تاريخ الإغلاق" : "Lost movement · close date"}
                <span className="num ms-2 rounded-full bg-white/15 px-2 py-0.5">
                  {fmtNum(data.courseLostMovement.totals.lost)}
                </span>
              </button>
            </div>
          </div>

          {courseReportView === "movement" ? (
            <CourseLostMovement
              report={data.courseLostMovement}
              onSelect={(row) =>
                setSelectedCourse({ key: row.key, label: row.label, scope: "closed" })
              }
            />
          ) : (
            <CourseLeadLossComparison
              report={data.courseLeadLoss}
              onSelect={(row) =>
                setSelectedCourse({ key: row.key, label: row.label, scope: "cohort-live" })
              }
            />
          )}

          <Card>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "اختار زاوية واحدة بدل عرض كل الرسومات معًا."
                  : "Choose one lens instead of displaying every chart at once."
              }
            >
              {lang === "ar" ? "أين تتجمع الخسائر؟" : "Where are losses concentrated?"}
            </SectionTitle>
            <div className="hscroll mb-5 flex gap-2">
              {(
                [
                  ["category", lang === "ar" ? "فئة الخسارة" : "Lost category"],
                  ["type", "Lead / Opportunity"],
                  ["reason", t("loss_reason")],
                  ["course", t("by_course")],
                  ["team", t("by_team")],
                  ["salesperson", t("by_salesperson")],
                  ["source", t("by_source")],
                  ["month", t("by_month")],
                ] as [ShareView, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setShareView(key)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${shareView === key ? "border-danger bg-danger-soft text-danger" : "border-border text-text-muted hover:bg-surface-2"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <ShareRows
              rows={
                shareView === "reason"
                  ? translatedReasons(data.breakdown, lang)
                  : shareRows(data.breakdown, shareView)
              }
              sorted={shareView === "month"}
              selectedKey={selectedReason?.key}
              onSelect={
                shareView === "reason"
                  ? (row) => setSelectedReason({ key: row.key ?? row.label, label: row.label })
                  : undefined
              }
            />
          </Card>

          <details className="card overflow-hidden">
            <summary className="cursor-pointer list-none px-4 py-4 text-sm font-semibold text-text sm:px-5">
              {lang === "ar"
                ? "تحليل متقدم: نسب الفرق ومصفوفة الأسباب"
                : "Advanced: team rates and reason matrix"}
            </summary>
            <div className="space-y-5 border-t border-border p-4 sm:p-5">
              <div className="table-wrap scroll-hint-x">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                      <th className="py-2 text-start">{t("team")}</th>
                      <th className="py-2 text-end">{t("crm_leads")}</th>
                      <th className="py-2 text-end">{t("lost_count")}</th>
                      <th className="py-2 text-end">{t("lost_rate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teamLostRates.map((row) => (
                      <tr key={row.team} className="border-t border-border">
                        <td className="max-w-[220px] truncate py-2.5 pe-3" title={row.team}>
                          {row.team}
                        </td>
                        <td className="num py-2.5 text-end">{fmtNum(row.leads)}</td>
                        <td className="num py-2.5 text-end">{fmtNum(row.lost)}</td>
                        <td className="num py-2.5 text-end font-medium">{fmtPct(row.rate, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SectionTitle
                action={
                  <Segmented
                    value={matrixView}
                    onChange={setMatrixView}
                    options={[
                      { value: "team", label: t("by_team") },
                      { value: "course", label: t("by_course") },
                    ]}
                  />
                }
              >
                {lang === "ar" ? "سبب الضياع × " : "Loss reason × "}
                {matrixView === "team" ? t("team") : t("course")}
              </SectionTitle>
              <MatrixTable
                matrix={translatedReasonMatrix(
                  data.breakdown,
                  matrixView === "team"
                    ? data.breakdown.reasonByTeam
                    : data.breakdown.reasonByCourse,
                  lang,
                )}
              />
            </div>
          </details>

          <details className="card overflow-hidden">
            <summary className="cursor-pointer list-none px-4 py-4 text-sm font-semibold text-text sm:px-5">
              {lang === "ar"
                ? `السجلات التفصيلية (${fmtNum(data.detail.total)})`
                : `Detailed records (${fmtNum(data.detail.total)})`}
            </summary>
            <div className="border-t border-border p-3">
              <DataTable
                rows={data.detail.rows}
                cols={cols}
                searchable={(r) =>
                  `${r.id} ${r.contact} ${r.category} ${r.reason} ${r.recordType} ${r.course} ${r.salesTeam} ${r.salesperson} ${r.campaign}`
                }
                onRowClick={setSelectedRecord}
                rowKey={(r) => r.id}
                initialSort={{ key: "reportingDate", dir: -1 }}
                csvFilename="engosoft-lost"
                maxHeight={620}
                csvRow={(r) => ({
                  crm_id: r.id,
                  contact: r.contact,
                  created: r.createdAt,
                  close_date: r.closeDate,
                  lost_date_basis: r.lostDateBasis,
                  reporting_date: r.reportingDate,
                  record_type: r.recordType,
                  active: String(r.active),
                  lost_category: r.category,
                  reason: r.reason,
                  canonical_reason_key: r.canonicalReasonKey ?? "",
                  canonical_reason:
                    (lang === "ar" ? r.canonicalReasonLabelAr : r.canonicalReasonLabelEn) ?? "",
                  raw_reason: r.rawReason ?? r.reason,
                  duplicate_identity_supported: String(r.duplicateEvidence?.supported ?? ""),
                  duplicate_matched_records: r.duplicateEvidence?.matchedRecordCount ?? "",
                  course: r.course,
                  main_category: r.mainCategory,
                  sales_team: r.salesTeam,
                  salesperson: r.salesperson,
                  source: r.source,
                  campaign: r.campaign,
                  ad_name: r.adName,
                  stage: r.stage,
                })}
              />
            </div>
          </details>
        </>
      )}

      <Dialog
        open={selectedReason !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedReason(null);
        }}
      >
        <DialogContent
          dir={lang === "ar" ? "rtl" : "ltr"}
          className="max-h-[90vh] w-[min(97vw,1180px)] max-w-none overflow-y-auto rounded-2xl border-border bg-surface p-0 text-text"
        >
          <DialogHeader className="sticky top-0 z-20 border-b border-border bg-surface px-5 py-4 pe-12 text-start">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span>{selectedReason?.label}</span>
              {reasonQuery.data && (
                <Pill tone="danger">{fmtNum(reasonQuery.data.detail.total)}</Pill>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs leading-6 text-text-muted">
              {lang === "ar"
                ? "كل الـLeads والـOpportunities تحت سبب الخسارة ده. اضغط على أي صف لعرض تفاصيله ثم فتحه والتعديل عليه في Odoo."
                : "Every Lead and Opportunity under this loss reason. Select a row to inspect it, then open and edit it in Odoo."}
            </DialogDescription>
          </DialogHeader>
          <div className="p-3 sm:p-4">
            {reasonQuery.isLoading ? (
              <Skeleton className="h-[420px]" />
            ) : reasonQuery.error ? (
              <ErrorState
                message={(reasonQuery.error as Error).message}
                onRetry={() => reasonQuery.refetch()}
              />
            ) : reasonQuery.data ? (
              <DataTable
                rows={reasonQuery.data.detail.rows}
                cols={cols}
                onRowClick={setSelectedRecord}
                rowKey={(r) => r.id}
                searchable={(r) =>
                  `${r.id} ${r.contact} ${r.course} ${r.salesTeam} ${r.salesperson} ${r.source} ${r.campaign}`
                }
                serverPage={{
                  offset: reasonQuery.data.detail.offset,
                  total: reasonQuery.data.detail.total,
                  size: reasonQuery.data.detail.limit,
                  onOffset: setReasonOffset,
                }}
                maxHeight={560}
                csvFilename={`engosoft-lost-${selectedReason?.key ?? "reason"}`}
                csvRow={(r) => ({
                  crm_id: r.id,
                  contact: r.contact,
                  created: r.createdAt,
                  close_date: r.closeDate,
                  lost_date_basis: r.lostDateBasis,
                  record_type: r.recordType,
                  reason: r.reason,
                  canonical_reason_key: r.canonicalReasonKey ?? "",
                  duplicate_identity_supported: String(r.duplicateEvidence?.supported ?? ""),
                  duplicate_matched_records: r.duplicateEvidence?.matchedRecordCount ?? "",
                  course: r.course,
                  sales_team: r.salesTeam,
                  salesperson: r.salesperson,
                  source: r.source,
                  campaign: r.campaign,
                  stage: r.stage,
                })}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedCourse !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedCourse(null);
        }}
      >
        <DialogContent
          dir={lang === "ar" ? "rtl" : "ltr"}
          className="max-h-[90vh] w-[min(97vw,1180px)] max-w-none overflow-y-auto rounded-2xl border-border bg-surface p-0 text-text"
        >
          <DialogHeader className="sticky top-0 z-20 border-b border-border bg-surface px-5 py-4 pe-12 text-start">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span>{lang === "ar" ? "Lost حسب الكورس:" : "Lost by course:"}</span>
              <span>{selectedCourse?.label}</span>
              {courseQuery.data && (
                <Pill tone="danger">{fmtNum(courseQuery.data.detail.total)}</Pill>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs leading-6 text-text-muted">
              {selectedCourse?.scope === "cohort-live"
                ? lang === "ar"
                  ? "كل الـLeads والـOpportunities التي Creation Date بتاعها داخل الفترة وأصبحت Lost تحت الكورس ده — من Odoo المباشر. اضغط على أي صف لفتحه في Odoo."
                  : "Every Lead and Opportunity created in the period that became Lost for this course, read from live Odoo. Select a row to open it in Odoo."
                : lang === "ar"
                  ? "كل الـLeads والـOpportunities التي اتقفلت Lost خلال الفترة تحت الكورس ده. اضغط على أي صف لعرض بياناته وفتحه في Odoo."
                  : "Every Lead and Opportunity closed Lost during the period for this course. Select a row to inspect it and open it in Odoo."}
            </DialogDescription>
          </DialogHeader>
          <div className="p-3 sm:p-4">
            {courseQuery.isLoading ? (
              <Skeleton className="h-[420px]" />
            ) : courseQuery.error ? (
              <ErrorState
                message={(courseQuery.error as Error).message}
                onRetry={() => courseQuery.refetch()}
              />
            ) : courseQuery.data ? (
              <DataTable
                rows={courseQuery.data.detail.rows}
                cols={cols}
                onRowClick={setSelectedRecord}
                rowKey={(r) => r.id}
                searchable={(r) =>
                  `${r.id} ${r.contact} ${r.course} ${r.salesTeam} ${r.salesperson} ${r.source} ${r.reason}`
                }
                serverPage={{
                  offset: courseQuery.data.detail.offset,
                  total: courseQuery.data.detail.total,
                  size: courseQuery.data.detail.limit,
                  onOffset: setCourseOffset,
                }}
                maxHeight={560}
                csvFilename={`engosoft-lost-course-${selectedCourse?.key ?? "course"}`}
                csvRow={(r) => ({
                  crm_id: r.id,
                  contact: r.contact,
                  created: r.createdAt,
                  close_date: r.closeDate,
                  lost_date_basis: r.lostDateBasis,
                  record_type: r.recordType,
                  reason: r.reason,
                  course: r.course,
                  sales_team: r.salesTeam,
                  salesperson: r.salesperson,
                  source: r.source,
                  campaign: r.campaign,
                  stage: r.stage,
                  odoo_url: r.odooUrl,
                })}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <LostRecordSheet
        record={selectedRecord}
        lang={lang}
        onOpenChange={(open) => {
          if (!open) setSelectedRecord(null);
        }}
      />
    </div>
  );
}

function shareRows(breakdown: LostBreakdown, view: ShareView): Grouped[] {
  return {
    category: breakdown.byCategory,
    reason: breakdown.byReason,
    type: breakdown.byType,
    course: breakdown.byCourse,
    team: breakdown.byTeam,
    salesperson: breakdown.bySalesperson,
    source: breakdown.bySource,
    month: breakdown.byMonth,
  }[view];
}

function ShareRows({
  rows,
  sorted,
  selectedKey,
  onSelect,
}: {
  rows: ShareRow[];
  sorted?: boolean;
  selectedKey?: string;
  onSelect?: (row: ShareRow) => void;
}) {
  const { lang } = useI18n();
  const items = (sorted ? rows : [...rows].sort((a, b) => b.count - a.count)).slice(0, 10);
  const peak = Math.max(...items.map((item) => item.count), 1);
  if (onSelect) {
    return (
      <div className="space-y-2.5">
        {items.map((item, index) => {
          const key = item.key ?? item.label;
          const selected = key === selectedKey;
          return (
            <button
              key={`${key}-${index}`}
              type="button"
              onClick={() => onSelect(item)}
              className={`stagger group block w-full rounded-xl border px-3 py-2.5 text-start transition hover:-translate-y-0.5 hover:border-danger/45 hover:shadow-sm ${
                selected ? "border-danger/50 bg-danger-soft/45" : "border-transparent bg-surface"
              }`}
              style={{ "--i": index } as CSSProperties}
            >
              <span className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-semibold text-text" title={item.label}>
                  {item.label}
                </span>
                <span className="num shrink-0 text-[13px] font-semibold text-text">
                  {fmtNum(item.count)}
                  <span className="ms-1.5 text-[11px] font-normal text-text-muted">
                    ({fmtPct(item.share, 1)})
                  </span>
                </span>
              </span>
              <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full bg-danger transition-[width] duration-500 group-hover:brightness-95"
                  style={{ width: `${Math.max(1.5, (item.count / peak) * 100)}%` }}
                />
              </span>
              <span className="mt-1.5 flex items-center justify-end gap-1 text-[10px] font-medium text-danger opacity-80">
                {lang === "ar" ? "عرض السجلات" : "View records"}
                <ExternalLink size={11} />
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <BarList
      items={items.map((g) => ({
        label: g.label,
        value: g.count,
        meta: (
          <span>
            <span className="num">{fmtNum(g.count)}</span>
            <span className="num text-[11px] text-text-muted ms-1.5">({fmtPct(g.share, 1)})</span>
          </span>
        ),
      }))}
      format={fmtNum}
      color="var(--danger)"
    />
  );
}

function LostRecordSheet({
  record,
  lang,
  onOpenChange,
}: {
  record: LostRowView | null;
  lang: "ar" | "en";
  onOpenChange: (open: boolean) => void;
}) {
  const reason = record
    ? (lang === "ar" ? record.canonicalReasonLabelAr : record.canonicalReasonLabelEn) ||
      record.reason ||
      "—"
    : "—";
  const facts: [string, string][] = [];
  if (record) {
    facts.push(
      [lang === "ar" ? "CRM ID" : "CRM ID", record.id],
      [lang === "ar" ? "النوع" : "Type", record.recordType],
      [lang === "ar" ? "الحالة" : "Status", "Registered Lost"],
      [lang === "ar" ? "سبب الخسارة" : "Loss reason", reason],
      [lang === "ar" ? "المرحلة" : "Stage", record.stage || "—"],
      [lang === "ar" ? "تاريخ الإنشاء" : "Created", record.createdAt || "—"],
      [lang === "ar" ? "تاريخ Lost" : "Lost date", record.closeDate || "—"],
      [lang === "ar" ? "فريق المبيعات" : "Sales team", record.salesTeam || "—"],
      [lang === "ar" ? "الموظف" : "Salesperson", record.salesperson || "—"],
      [lang === "ar" ? "المصدر" : "Source", record.source || "—"],
    );
    facts.push(
      [lang === "ar" ? "أساس تاريخ Lost" : "Lost date basis", record.lostDateBasis || "—"],
      [lang === "ar" ? "الدورة" : "Course", record.course || "—"],
      [lang === "ar" ? "الحملة" : "Campaign", record.campaign || "—"],
    );
  }

  return (
    <Sheet open={record !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={lang === "ar" ? "left" : "right"}
        dir={lang === "ar" ? "rtl" : "ltr"}
        className="w-[min(94vw,480px)] overflow-y-auto border-border bg-surface p-0 text-text sm:max-w-[480px]"
      >
        {record && (
          <>
            <SheetHeader className="border-b border-border bg-surface-2/60 px-5 py-5 pe-12 text-start">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Pill tone="danger">Registered Lost</Pill>
                <span className="num text-[11px] text-text-muted">CRM #{record.id}</span>
              </div>
              <SheetTitle className="text-start text-xl text-text">
                {record.contact || `CRM #${record.id}`}
              </SheetTitle>
              <SheetDescription className="text-start text-xs leading-6 text-text-muted">
                {lang === "ar"
                  ? "راجع الدليل هنا، ثم افتح السجل الأصلي في Odoo لو محتاج تعديل."
                  : "Review the evidence here, then open the source record in Odoo if it needs editing."}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 p-5">
              {record.canonicalReasonKey === "duplicate" && (
                <Notice
                  tone={record.duplicateEvidence?.supported ? "info" : "warning"}
                  icon={
                    record.duplicateEvidence?.supported ? (
                      <CheckCircle2 size={16} className="text-success" />
                    ) : (
                      <AlertTriangle size={16} />
                    )
                  }
                >
                  {record.duplicateEvidence?.supported
                    ? lang === "ar"
                      ? `يوجد دليل هوية مطابق مع ${fmtNum(record.duplicateEvidence.matchedRecordCount)} سجل CRM آخر عبر ${record.duplicateEvidence.sources.includes("provider_id") ? "Provider Lead ID" : "رقم الهاتف"}.`
                      : `Identity evidence matches ${fmtNum(record.duplicateEvidence.matchedRecordCount)} other CRM record(s).`
                    : lang === "ar"
                      ? "لم نجد سجلًا آخر مطابقًا بالـProvider Lead ID أو الهاتف داخل نطاق بيانات الداشبورد؛ السبب يحتاج مراجعة يدوية."
                      : "No other record matched by provider lead id or phone in dashboard scope; the reason needs manual review."}
                </Notice>
              )}

              <dl className="overflow-hidden rounded-2xl border border-border bg-surface">
                {facts.map(([label, value], index) => (
                  <div
                    key={label}
                    className={`grid grid-cols-[minmax(100px,0.8fr)_minmax(0,1.2fr)] gap-3 px-4 py-3 text-xs ${index ? "border-t border-border" : ""}`}
                  >
                    <dt className="text-text-muted">{label}</dt>
                    <dd className="min-w-0 break-words font-medium text-text" dir="auto">
                      {value || "—"}
                    </dd>
                  </div>
                ))}
              </dl>

              {(record.phone || record.mobile || record.email) && (
                <div className="rounded-2xl border border-border bg-surface-2/45 p-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    {lang === "ar" ? "بيانات التواصل" : "Contact details"}
                  </div>
                  <div className="space-y-1 text-sm text-text" dir="ltr">
                    {record.phone && <div>{record.phone}</div>}
                    {record.mobile && record.mobile !== record.phone && <div>{record.mobile}</div>}
                    {record.email && <div>{record.email}</div>}
                  </div>
                </div>
              )}

              <a
                href={record.odooUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                <ExternalLink size={17} />
                {lang === "ar" ? "فتح وتعديل الـLead في Odoo" : "Open and edit the Lead in Odoo"}
              </a>
              <p className="text-center text-[10px] leading-5 text-text-muted">
                {lang === "ar"
                  ? "التعديل يتم في Odoo نفسه للحفاظ على الصلاحيات والـaudit trail."
                  : "Editing stays in Odoo so permissions and the audit trail remain intact."}
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MatrixTable({ matrix }: { matrix: Matrix }) {
  const { lang } = useI18n();
  if (!matrix.rows.length) return null;
  const share = (n: number) => (matrix.total > 0 ? (n / matrix.total) * 100 : 0);
  // Cell tint scales with the largest single cell so the hot spots stand out.
  const peak = Math.max(...matrix.cells.flat(), 1);

  return (
    <div className="table-wrap" style={{ maxHeight: 480 }}>
      <table className="text-sm border-separate border-spacing-0 min-w-full">
        <thead className="sticky top-0 z-10">
          <tr>
            <th
              className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide bg-surface-2 border-b border-border text-start sticky-col z-20 text-text-muted"
              style={{ background: "var(--surface-2)", minWidth: 200 }}
            >
              {lang === "ar" ? "السبب" : "Reason"}
            </th>
            {matrix.cols.map((c) => (
              <th
                key={c}
                className="px-2 py-2.5 text-[11px] font-semibold bg-surface-2 border-b border-border text-end text-text-muted whitespace-nowrap"
                title={c}
              >
                <span className="block max-w-[110px] truncate">{c}</span>
              </th>
            ))}
            <th className="px-3 py-2.5 text-[11px] font-semibold uppercase bg-surface-2 border-b border-border text-end text-text-muted">
              {lang === "ar" ? "الإجمالي" : "Total"}
            </th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((r, i) => (
            <tr key={r} className="group">
              <td className="px-3 py-2 border-b border-border sticky-col bg-surface group-hover:bg-brand-soft transition-colors">
                <span className="block max-w-[220px] truncate" title={r}>
                  {r}
                </span>
              </td>
              {matrix.cells[i].map((v, j) => (
                <td
                  key={j}
                  className="px-2 py-2 border-b border-border text-end num whitespace-nowrap"
                  style={{
                    background:
                      v > 0
                        ? `color-mix(in oklab, var(--danger-soft) ${Math.round((v / peak) * 100)}%, transparent)`
                        : undefined,
                  }}
                  title={`${v} · ${fmtPct(share(v), 1)}`}
                >
                  {v === 0 ? (
                    <span className="text-text-subtle">—</span>
                  ) : (
                    <>
                      {fmtNum(v)}
                      <span className="text-[10px] text-text-muted ms-1">
                        {share(v).toFixed(1)}%
                      </span>
                    </>
                  )}
                </td>
              ))}
              <td className="px-3 py-2 border-b border-border text-end num font-semibold bg-surface-2/60">
                {fmtNum(matrix.rowTotals[i])}
                <span className="text-[10px] text-text-muted ms-1">
                  {share(matrix.rowTotals[i]).toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
