import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowUpRight,
  BadgeDollarSign,
  CalendarRange,
  CopyPlus,
  Gauge,
  Image as ImageIcon,
  Info,
  Landmark,
  Pencil,
  Target,
  TriangleAlert,
  UserRoundCheck,
  Users,
  WalletCards,
} from "lucide-react";
import { MediaPlanActivityPanel } from "@/components/media-plan/MediaPlanActivityPanel";
import { MediaPlanEditor } from "@/components/media-plan/MediaPlanEditor";
import {
  Card,
  ErrorState,
  KpiCard,
  Notice,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { DashboardPageHeader, DashboardPanel, KpiRow } from "@/components/dashboard-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { topRows, type MetricDetail } from "@/lib/metric-detail";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import { mediaPlanMonths, OCTOBER_2026_SOURCE, type MonthlyMediaPlan } from "@/lib/media-plan";
import { useApi } from "@/lib/use-api";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

export const Route = createFileRoute("/media-plan")({ component: MediaPlanPage });

type PlanPhase = "upcoming" | "active" | "complete";

interface CourseRow {
  key: string;
  label: string;
  targetLeads: number;
  targetCpl: number;
  targetBudgetUsd: number;
  owners: string[];
  actual: {
    spend: number;
    platformLeads: number | null;
    crmLeads: number;
    won: number;
    lost: number;
    revenueUsd: number;
    invoices: number;
    actualLeads: number;
    leadBasis: "platform" | "crm_fallback";
    actualCpl: number | null;
    achievement: number | null;
    expectedLeads: number;
    expectedAchievement: number;
    budgetUsed: number | null;
    cplVariance: number | null;
  };
}

interface MediaPlanResponse {
  plan: MonthlyMediaPlan & {
    targetCpl: number | null;
    plannedCourseBudgetUsd: number;
    reserveBudgetUsd: number;
    additionalBudgetUsd: number;
    totalMarketingBudgetUsd: number;
  };
  window: {
    from: string;
    to: string;
    days: number;
    today: string;
    elapsed: number;
    phase: PlanPhase;
  };
  actual: {
    targetedSpend: number;
    targetedLeads: number;
    targetedCrmLeads: number;
    targetedCpl: number | null;
    paidLeadAchievement: number | null;
    organicWebinarLeads: number;
    organicAchievement: number | null;
    allSpend: number;
    unattributedOrUnplannedSpend: number;
    revenueUsd: number;
    salesAchievement: number | null;
  };
  courses: CourseRow[];
  deliverables: DeliverableRow[];
  unplanned: {
    course: string;
    spend: number;
    platformLeads: number | null;
    crmLeads: number;
  }[];
  availableMonths: string[];
  editable: boolean;
  edited: boolean;
  auth: {
    signedIn: boolean;
    via: "sso" | "admin-code" | null;
    name: string;
    sso: boolean;
    adminCode: boolean;
  };
  storeError: string;
  sources: string[];
}

interface DeliverableRow {
  key: string;
  label: string;
  category:
    "website" | "paid_media" | "landing_page" | "webinar" | "creative" | "organic" | "other";
  metric:
    | "leads"
    | "visits"
    | "submissions"
    | "campaigns"
    | "creatives"
    | "videos"
    | "posts"
    | "registrations"
    | "custom";
  target: number;
  unit: string;
  actual: number | null;
  connected: boolean;
  actualSource: string;
  dateScope: string;
  matchingRule: string;
  reportTo: string;
}

const ratioPct = (value: number | null): string => (value === null ? "—" : fmtPct(value * 100, 1));

const barWidth = (value: number | null): string =>
  `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%`;

function monthName(month: string, lang: "ar" | "en"): string {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, number - 1, 1)));
}

function courseState(row: CourseRow, phase: PlanPhase) {
  if (phase === "upcoming") return { tone: "neutral" as const, key: "upcoming" };
  if (row.actual.spend <= 0 && row.actual.actualLeads <= 0) {
    return { tone: "danger" as const, key: "no_delivery" };
  }
  if ((row.actual.cplVariance ?? 0) > 0.1) {
    return { tone: "warning" as const, key: "high_cpl" };
  }
  if ((row.actual.achievement ?? 0) + 0.04 < row.actual.expectedAchievement) {
    return { tone: "danger" as const, key: "behind" };
  }
  return { tone: "success" as const, key: "on_track" };
}

/**
 * The six plan figures, and how far through the month they are.
 *
 * A PLAN IS NOT AN ACHIEVEMENT. Every panel here states the target, what has
 * actually happened, and how much of the month has elapsed — because 60% of a
 * target on day 6 and 60% on day 26 are opposite readings of the same number.
 */
function mediaPlanMetrics(
  data: MediaPlanResponse,
  lang: "ar" | "en",
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const P = data.plan;
  const V = data.actual;
  const W = data.window;
  const pace = W.days > 0 ? (W.elapsed / W.days) * 100 : null;
  const paceFact = {
    key: "pace",
    label: A ? "المنقضي من الشهر" : "Month elapsed",
    value: pace === null ? "—" : fmtPct(pace, 0),
    hint: `${fmtNum(W.elapsed)} / ${fmtNum(W.days)} ${A ? "يوم" : "days"}`,
  };
  const byCourse = (
    pick: (row: CourseRow) => number,
    format: (n: number) => string,
    tone: "mint" | "rose" | "sky" | "amber" | "violet",
  ) =>
    topRows(
      data.courses.map((row) => ({
        key: row.key,
        label: row.label,
        value: pick(row),
        display: format(pick(row)),
        tone,
      })),
    );

  return {
    leadTarget: {
      id: "media_plan.leadTarget",
      title:
        P.month === "2026-10"
          ? A
            ? "تارجت ليدز الدورات"
            : "Course lead target"
          : A
            ? "تارجت الشهر"
            : "Monthly lead target",
      value: fmtNum(P.leadTarget),
      tone: "sky",
      icon: <Target size={16} />,
      definition:
        P.month === "2026-10"
          ? A
            ? "مجموع أهداف الدورات الست فقط. أهداف الموقع ويوتيوب والبراندينج تظهر مستقلة أسفلها؛ لا نجمعها هنا لأن مصادرها قد تتداخل."
            : "Only the six course goals. Website, YouTube and branding are separate below; channels may overlap."
          : A
            ? "عدد العملاء المحتملين الذي تلتزم به الخطة هذا الشهر، من المدفوع ومن الأورجانيك والويبينار معًا."
            : "The number of leads the plan commits to this month, paid and organic/webinar together.",
      formula: A
        ? `${fmtNum(P.paidLeadTarget)} مدفوع + ${fmtNum(P.organicWebinarLeadTarget)} أورجانيك/ويبينار = ${fmtNum(P.leadTarget)}.`
        : `${fmtNum(P.paidLeadTarget)} paid + ${fmtNum(P.organicWebinarLeadTarget)} organic/webinar = ${fmtNum(P.leadTarget)}.`,
      supporting: [
        { key: "paid", label: A ? "تارجت Paid" : "Paid target", value: fmtNum(P.paidLeadTarget) },
        {
          key: "organic",
          label: A ? "تارجت أورجانيك" : "Organic target",
          value: fmtNum(P.organicWebinarLeadTarget),
        },
        {
          key: "actual",
          label: A ? "المحقق من Paid" : "Paid so far",
          value: fmtNum(V.targetedLeads),
        },
        paceFact,
      ],
      breakdowns: [
        {
          id: "courses",
          title: A ? "التارجت حسب الدورة" : "Target by course",
          rows: byCourse((row) => row.targetLeads, fmtNum, "sky"),
          emptyLabel: A ? "لا توجد دورات في الخطة" : "No courses in the plan",
        },
      ],
    },
    paidTarget: {
      id: "media_plan.paidTarget",
      title: A ? "تارجت Paid" : "Paid lead target",
      value: fmtNum(P.paidLeadTarget),
      tone: "violet",
      icon: <Users size={16} />,
      definition: A
        ? "الجزء من تارجت الشهر الذي يُفترض أن تأتي به الحملات المدفوعة."
        : "The part of the month's target the paid campaigns are expected to deliver.",
      formula: A
        ? `${fmtNum(V.targetedLeads)} من ${fmtNum(P.paidLeadTarget)} = ${ratioPct(V.paidLeadAchievement)} بعد ${fmtNum(W.elapsed)} من ${fmtNum(W.days)} يوم.`
        : `${fmtNum(V.targetedLeads)} of ${fmtNum(P.paidLeadTarget)} = ${ratioPct(V.paidLeadAchievement)} after ${fmtNum(W.elapsed)} of ${fmtNum(W.days)} days.`,
      supporting: [
        { key: "actual", label: A ? "المحقق" : "Achieved", value: fmtNum(V.targetedLeads) },
        {
          key: "remaining",
          label: A ? "المتبقي" : "Remaining",
          value: fmtNum(Math.max(0, P.paidLeadTarget - V.targetedLeads)),
        },
        {
          key: "achievement",
          label: A ? "نسبة الإنجاز" : "Achievement",
          value: ratioPct(V.paidLeadAchievement),
        },
        paceFact,
      ],
      breakdowns: [
        {
          id: "courses",
          title: A ? "الليدز الفعلية حسب الدورة" : "Actual leads by course",
          rows: byCourse((row) => row.actual.crmLeads, fmtNum, "violet"),
          emptyLabel: A ? "لا توجد دورات في الخطة" : "No courses in the plan",
        },
      ],
      report: { to: "/leads", label: A ? "فتح تقرير العملاء" : "Open the leads report" },
    },
    budget: {
      id: "media_plan.budget",
      title: A ? "ميزانية الليدز" : "Lead-gen budget",
      value:
        P.overallMarketingBudgetUsd !== undefined && P.leadGenerationBudgetUsd === 0
          ? A
            ? "غير موزعة"
            : "Unallocated"
          : fmtUSDFull(P.leadGenerationBudgetUsd),
      tone: "amber",
      icon: <WalletCards size={16} />,
      definition: A
        ? "الميزانية المخصصة لجلب العملاء هذا الشهر. الأنشطة الأخرى لها ميزانيتها المنفصلة."
        : "The budget set aside to bring in leads this month. Other activities carry their own budget.",
      formula: A
        ? P.overallMarketingBudgetUsd !== undefined && P.leadGenerationBudgetUsd === 0
          ? `الصورة تحدد ${fmtUSDFull(P.overallMarketingBudgetUsd)} كإجمالي تسويق، لكنها لا توزع ميزانية جلب الليدز على الدورات أو الأنشطة.`
          : `${fmtUSDFull(V.targetedSpend)} مصروف من ${fmtUSDFull(P.leadGenerationBudgetUsd)} بعد ${fmtNum(W.elapsed)} من ${fmtNum(W.days)} يوم.`
        : P.overallMarketingBudgetUsd !== undefined && P.leadGenerationBudgetUsd === 0
          ? `The image sets ${fmtUSDFull(P.overallMarketingBudgetUsd)} for all marketing, without a lead-gen or activity split.`
          : `${fmtUSDFull(V.targetedSpend)} spent of ${fmtUSDFull(P.leadGenerationBudgetUsd)} after ${fmtNum(W.elapsed)} of ${fmtNum(W.days)} days.`,
      caveat:
        V.unattributedOrUnplannedSpend > 0
          ? A
            ? `${fmtUSDFull(V.unattributedOrUnplannedSpend)} أُنفقت خارج دورات الخطة أو بلا نسبة، وهي ليست داخل هذا الرقم.`
            : `${fmtUSDFull(V.unattributedOrUnplannedSpend)} ran outside the planned courses or with no attribution, and is not inside this figure.`
          : undefined,
      supporting: [
        { key: "spent", label: A ? "المصروف" : "Spent", value: fmtUSDFull(V.targetedSpend) },
        {
          key: "remaining",
          label: A ? "المتبقي" : "Remaining",
          value:
            P.overallMarketingBudgetUsd !== undefined && P.leadGenerationBudgetUsd === 0
              ? "—"
              : fmtUSDFull(Math.max(0, P.leadGenerationBudgetUsd - V.targetedSpend)),
        },
        { key: "allSpend", label: A ? "كل الإنفاق" : "All spend", value: fmtUSDFull(V.allSpend) },
        paceFact,
      ],
      breakdowns: [
        {
          id: "courses",
          title: A ? "الإنفاق الفعلي حسب الدورة" : "Actual spend by course",
          rows: byCourse((row) => row.actual.spend, fmtUSDFull, "amber"),
          emptyLabel: A ? "لا توجد دورات في الخطة" : "No courses in the plan",
        },
      ],
      report: { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" },
    },
    cpl: {
      id: "media_plan.cpl",
      title: A ? "CPL المستهدف" : "Target CPL",
      value: fmtUSDFull(P.targetCpl),
      tone: "amber",
      icon: <Gauge size={16} />,
      definition: A
        ? "التكلفة التي تفترضها الخطة لكل عميل محتمل. الفعلي فوقها يعني أن الميزانية لن تكفي التارجت."
        : "The cost per lead the plan assumes. An actual above it means the budget will not reach the target.",
      formula: A
        ? `المستهدف ${fmtUSDFull(P.targetCpl)} مقابل الفعلي ${fmtUSDFull(V.targetedCpl)}.`
        : `Target ${fmtUSDFull(P.targetCpl)} against an actual of ${fmtUSDFull(V.targetedCpl)}.`,
      supporting: [
        { key: "actual", label: A ? "الفعلي" : "Actual", value: fmtUSDFull(V.targetedCpl) },
        { key: "spent", label: A ? "المصروف" : "Spent", value: fmtUSDFull(V.targetedSpend) },
        { key: "leads", label: A ? "الليدز" : "Leads", value: fmtNum(V.targetedLeads) },
        paceFact,
      ],
      breakdowns: [
        {
          id: "courses",
          title: A ? "CPL الفعلي حسب الدورة" : "Actual CPL by course",
          rows: byCourse((row) => row.actual.actualCpl ?? 0, fmtUSDFull, "rose"),
          emptyLabel: A ? "لا توجد دورات قابلة للقياس" : "No measurable course",
        },
        {
          id: "targets",
          title: A ? "CPL المستهدف حسب الدورة" : "Target CPL by course",
          rows: byCourse((row) => row.targetCpl, fmtUSDFull, "amber"),
          emptyLabel: A ? "لا توجد دورات في الخطة" : "No courses in the plan",
        },
      ],
    },
    salesTarget: {
      id: "media_plan.salesTarget",
      title: A ? "تارجت المبيعات" : "Sales target",
      value: fmtUSDFull(P.salesTargetUsd),
      tone: "mint",
      icon: <Landmark size={16} />,
      definition: A
        ? "الإيراد الذي تلتزم به الخطة هذا الشهر، مقابل ما تم تحصيله فعلًا حتى الآن."
        : "The revenue the plan commits to this month, against what has actually been collected so far.",
      formula: A
        ? `${fmtUSDFull(V.revenueUsd)} من ${fmtUSDFull(P.salesTargetUsd)} = ${ratioPct(V.salesAchievement)} بعد ${fmtNum(W.elapsed)} من ${fmtNum(W.days)} يوم.`
        : `${fmtUSDFull(V.revenueUsd)} of ${fmtUSDFull(P.salesTargetUsd)} = ${ratioPct(V.salesAchievement)} after ${fmtNum(W.elapsed)} of ${fmtNum(W.days)} days.`,
      supporting: [
        { key: "actual", label: A ? "المحقق" : "Achieved", value: fmtUSDFull(V.revenueUsd) },
        {
          key: "remaining",
          label: A ? "المتبقي" : "Remaining",
          value: fmtUSDFull(Math.max(0, P.salesTargetUsd - V.revenueUsd)),
        },
        {
          key: "achievement",
          label: A ? "نسبة الإنجاز" : "Achievement",
          value: ratioPct(V.salesAchievement),
        },
        paceFact,
      ],
      breakdowns: [
        {
          id: "courses",
          title: A ? "الإيراد الفعلي حسب الدورة" : "Actual revenue by course",
          rows: byCourse((row) => row.actual.revenueUsd, fmtUSDFull, "mint"),
          emptyLabel: A ? "لا توجد دورات في الخطة" : "No courses in the plan",
        },
      ],
      report: { to: "/accounting", label: A ? "فتح تقرير الحسابات" : "Open the Accounting report" },
    },
    totalBudget: {
      id: "media_plan.totalBudget",
      title: A ? "إجمالي ميزانية التسويق" : "Total marketing budget",
      value: fmtUSDFull(P.totalMarketingBudgetUsd),
      tone: "slate",
      icon: <BadgeDollarSign size={16} />,
      definition: A
        ? P.overallMarketingBudgetUsd !== undefined
          ? "إجمالي الميزانية المذكور في مصدر الخطة، حتى لو توزيعها التفصيلي لم يُحدد بعد."
          : "كل ما خُصص للتسويق هذا الشهر: ميزانية جلب العملاء، بالإضافة إلى الأنشطة الأخرى."
        : P.overallMarketingBudgetUsd !== undefined
          ? "The source plan's overall budget, even if the detailed allocation is not yet specified."
          : "Everything set aside for marketing this month: lead generation plus other activities.",
      formula: A
        ? P.overallMarketingBudgetUsd !== undefined
          ? `${fmtUSDFull(P.totalMarketingBudgetUsd)} إجمالي من المصدر؛ الموزع حاليًا ${fmtUSDFull(P.leadGenerationBudgetUsd + P.additionalBudgetUsd)}، والباقي غير موزع.`
          : `${fmtUSDFull(P.leadGenerationBudgetUsd)} ليدز + ${fmtUSDFull(P.additionalBudgetUsd)} أنشطة إضافية = ${fmtUSDFull(P.totalMarketingBudgetUsd)}.`
        : P.overallMarketingBudgetUsd !== undefined
          ? `${fmtUSDFull(P.totalMarketingBudgetUsd)} source total; ${fmtUSDFull(P.leadGenerationBudgetUsd + P.additionalBudgetUsd)} allocated so far, the rest unallocated.`
          : `${fmtUSDFull(P.leadGenerationBudgetUsd)} lead-gen + ${fmtUSDFull(P.additionalBudgetUsd)} extra activities = ${fmtUSDFull(P.totalMarketingBudgetUsd)}.`,
      supporting: [
        {
          key: "leadGen",
          label: A ? "ميزانية الليدز" : "Lead-gen budget",
          value: fmtUSDFull(P.leadGenerationBudgetUsd),
        },
        {
          key: "extra",
          label: A ? "أنشطة إضافية" : "Extra activities",
          value: fmtUSDFull(P.additionalBudgetUsd),
        },
        {
          key: "reserve",
          label:
            P.overallMarketingBudgetUsd !== undefined
              ? A
                ? "غير موزع"
                : "Unallocated"
              : A
                ? "الاحتياطي"
                : "Reserve",
          value: fmtUSDFull(
            P.overallMarketingBudgetUsd !== undefined
              ? Math.max(
                  0,
                  P.overallMarketingBudgetUsd - P.leadGenerationBudgetUsd - P.additionalBudgetUsd,
                )
              : P.reserveBudgetUsd,
          ),
        },
        {
          key: "spent",
          label: A ? "المصروف فعلًا" : "Actually spent",
          value: fmtUSDFull(V.allSpend),
        },
      ],
      breakdowns: P.additionalActivities.length
        ? [
            {
              id: "activities",
              title: A ? "الأنشطة الإضافية" : "Extra activities",
              rows: topRows(
                P.additionalActivities.map((activity) => ({
                  key: activity.key,
                  label: activity.label,
                  value: activity.budgetUsd,
                  display: fmtUSDFull(activity.budgetUsd),
                  tone: "slate" as const,
                })),
              ),
            },
          ]
        : undefined,
    },
  };
}

function OctoberSourcePanel({ lang }: { lang: "ar" | "en" }) {
  const A = lang === "ar";
  const source = OCTOBER_2026_SOURCE;
  const confirmedLeadGoals = source.courseLeads + source.websiteLeads;
  const numericListed = confirmedLeadGoals + source.youtubeGoal + source.brandingGoal;
  const leadGap = source.statedTotalLeads - confirmedLeadGoals;
  const budgetPercent = (source.marketingBudgetUsd / source.salesTargetUsd) * 100;

  return (
    <Card className="overflow-hidden border-sky-border/70 bg-sky-surface/20">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,17rem)_1fr]">
        <a
          href={source.image}
          target="_blank"
          rel="noopener noreferrer"
          className="group block overflow-hidden rounded-xl border border-border bg-surface"
          aria-label={A ? "فتح صورة خطة أكتوبر بالحجم الكامل" : "Open the October plan image"}
        >
          <img
            src={source.image}
            alt={
              A
                ? "صورة خطة ميديا أكتوبر 2026 الأصلية: أهداف الدورات والموقع ويوتيوب والبراندينج"
                : "Original October 2026 media plan with course, website, YouTube and branding goals"
            }
            loading="lazy"
            className="aspect-[3/2] w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
          />
          <span className="flex items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-[11px] font-semibold text-brand">
            <ImageIcon size={13} />
            {A ? "افتح الصورة الأصلية" : "Open original image"}
          </span>
        </a>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-text">
              {A ? "مرجع خطة أكتوبر من الصورة" : "October plan image reference"}
            </h2>
            <Pill tone="warning">{A ? "مسودة للمراجعة" : "Draft for review"}</Pill>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            {A
              ? "أهداف الدورات والموقع متصلة بمصادرها في الداشبورد. يوتيوب والبراندينج يظهران كهدفين منفصلين بوحدة غير محددة في الصورة؛ والمحقق يُدخل يدويًا لحين تعريف المؤشر وتوصيل مصدر موثوق."
              : "Course and website goals use dashboard sources. YouTube and branding remain separate goals with units unspecified in the image; actuals are manually reported until their metrics and trustworthy sources are defined."}
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="text-[10px] text-text-muted">
                {A
                  ? `ليدز الدورات · ${fmtNum(source.dailyCourseLeads)} يوميًا × ${fmtNum(source.workingDays)} يوم`
                  : `Course leads · ${fmtNum(source.dailyCourseLeads)} daily × ${fmtNum(source.workingDays)} days`}
              </div>
              <div className="num mt-1 text-lg font-bold text-text">
                {fmtNum(source.courseLeads)}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="text-[10px] text-text-muted">
                {A ? "ليدز الموقع" : "Website leads"}
              </div>
              <div className="num mt-1 text-lg font-bold text-text">
                {fmtNum(source.websiteLeads)}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="text-[10px] text-text-muted">
                {A ? "يوتيوب · الوحدة غير مذكورة" : "YouTube · unit unspecified"}
              </div>
              <div className="num mt-1 text-lg font-bold text-text">
                {fmtNum(source.youtubeGoal)}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="text-[10px] text-text-muted">
                {A ? "براندينج · الوحدة غير مذكورة" : "Branding · unit unspecified"}
              </div>
              <div className="num mt-1 text-lg font-bold text-text">
                {fmtNum(source.brandingGoal)}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="text-[10px] text-text-muted">
                {A ? "إجمالي الصورة المعلن" : "Total stated in image"}
              </div>
              <div className="num mt-1 text-lg font-bold text-text">
                {fmtNum(source.statedTotalLeads)}
              </div>
            </div>
          </div>

          <p className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-relaxed text-warning">
            {A
              ? `ليدز الدورات والموقع = ${fmtNum(confirmedLeadGoals)}. جمع كل الأرقام الظاهرة حسابيًا = ${fmtNum(numericListed)}، لكن لا يصح اعتباره «إجمالي ليدز» لأن وحدة يوتيوب والبراندينج غير مذكورة وقد تتداخل القنوات. لذلك يبقى الفرق ${fmtNum(leadGap)} عن إجمالي ${fmtNum(source.statedTotalLeads)} ليد غير مفسّر. أيضًا ${fmtUSDFull(source.marketingBudgetUsd)} = ${fmtPct(budgetPercent, 1)} من هدف ${fmtUSDFull(source.salesTargetUsd)}، لا 17% بالضبط.`
              : `Course and website lead goals total ${fmtNum(confirmedLeadGoals)}. All visible numbers sum arithmetically to ${fmtNum(numericListed)}, but that is not a valid lead total: YouTube and branding units are unspecified and channels may overlap. The ${fmtNum(leadGap)} gap to the stated ${fmtNum(source.statedTotalLeads)} leads is unresolved. Also ${fmtUSDFull(source.marketingBudgetUsd)} is ${fmtPct(budgetPercent, 1)} of the ${fmtUSDFull(source.salesTargetUsd)} revenue goal, not exactly 17%.`}
          </p>
        </div>
      </div>
    </Card>
  );
}

function MediaPlanPage() {
  const { lang } = useI18n();
  const [month, setMonth] = useState(() => mediaPlanMonths()[0]);
  // Month is local page state, so declare it explicitly. Nexus then reads the
  // same plan the manager has selected instead of silently defaulting to now.
  useRegisterNexusView("media_plan", { parameters: { month } });
  const [editor, setEditor] = useState<"edit" | "create" | null>(null);
  const [showCampaignDelivery, setShowCampaignDelivery] = useState(false);
  const { data, isLoading, error, refetch } = useApi<MediaPlanResponse>(
    `/api/media-plan?month=${month}`,
  );

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  // One description per figure, built from the plan already on screen.
  const figures = data ? mediaPlanMetrics(data, lang) : ({} as ReturnType<typeof mediaPlanMetrics>);

  return (
    <div className="page-sections">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <DashboardPageHeader
          flush
          icon={<CalendarRange size={20} />}
          title={`${lang === "ar" ? "خطة" : "Plan"} · ${monthName(month, lang)}`}
          subtitle={
            lang === "ar"
              ? "لوحة واحدة تربط التارجت بالصرف والليدز الفعلية لكل دورة ومسؤول."
              : "One planning board linking every course target and owner to actual spend and leads."
          }
          period={data ? `${data.window.from} → ${data.window.to}` : undefined}
        />
        <div className="flex flex-wrap gap-2">
          <Link
            to="/management-review"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-brand/30 bg-brand/5 px-3 text-xs font-semibold text-brand transition-colors hover:bg-brand/10"
          >
            <Gauge size={14} />{" "}
            {lang === "ar" ? "مراجعة الخطة والـSales Funnel" : "Plan & sales funnel review"}
          </Link>
          {!!data && (
            <>
              <button
                type="button"
                onClick={() => setEditor("edit")}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-brand px-3 text-xs font-semibold text-white"
              >
                <Pencil size={14} /> {lang === "ar" ? "تعديل الخطة" : "Edit plan"}
              </button>
              <button
                type="button"
                onClick={() => setEditor("create")}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-brand"
              >
                <CopyPlus size={14} /> {lang === "ar" ? "خطة شهر جديد" : "New month"}
              </button>
            </>
          )}
          <Link
            to="/media-buyers"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-brand transition-colors hover:bg-surface-2"
          >
            {lang === "ar" ? "تقييم الميديا بايرز" : "Buyer evaluation"}
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>

      {isLoading || !data ? (
        <MediaPlanSkeleton />
      ) : (
        <>
          {/* The plan's own identity — which month, whether it is approved,
              and the window it covers. It used to be a full-bleed navy panel
              carrying a 34px grid, a blur and six white-on-navy tiles; the
              same facts now sit on the page's surface so the figures beneath
              read on the same scale as every other report. */}
          <DashboardPanel
            title={monthName(data.plan.month, lang)}
            hint={
              data.plan.status === "draft" && data.plan.basisMonth
                ? lang === "ar"
                  ? `الأرقام منسوخة بوضوح من خطة ${monthName(data.plan.basisMonth, lang)} كخط أساس، مع CPL Benchmarks من خطة يوليو، لحين اعتماد أرقام الشهر النهائية.`
                  : `Targets are visibly copied from ${monthName(data.plan.basisMonth, lang)} as a baseline, with July CPL benchmarks, until this month is approved.`
                : data.plan.status === "draft"
                  ? lang === "ar"
                    ? "أهداف مسودة للشهر مع مقارنة التنفيذ الفعلي؛ تحتاج مراجعة واعتماد."
                    : "Draft monthly targets against actual delivery; review and approval needed."
                  : lang === "ar"
                    ? "الخطة المعتمدة للشهر مع مقارنة التنفيذ الفعلي."
                    : "Approved monthly targets compared with actual delivery."
            }
            action={
              <label className="block min-w-44 text-[11px] font-semibold text-text-muted">
                {lang === "ar" ? "شهر الخطة" : "Plan month"}
                <select
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-text outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {data.availableMonths.map((value) => (
                    <option key={value} value={value}>
                      {monthName(value, lang)}
                    </option>
                  ))}
                </select>
              </label>
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={data.plan.status === "draft" ? "warning" : "success"}>
                {data.plan.status === "draft"
                  ? lang === "ar"
                    ? "مسودة تحتاج اعتماد"
                    : "Draft - approval needed"
                  : lang === "ar"
                    ? "خطة معتمدة"
                    : "Approved plan"}
              </Pill>
              {data.edited && (
                <Pill tone="brand">
                  {lang === "ar" ? "معدلة من الداشبورد" : "Dashboard edited"}
                </Pill>
              )}
              <span className="num text-xs text-text-muted">
                {data.window.from} - {data.window.to}
              </span>
            </div>
          </DashboardPanel>

          {data.plan.month === "2026-10" && <OctoberSourcePanel lang={lang} />}

          <KpiRow>
            <MetricDetailTrigger
              detail={figures.leadTarget}
              card={{
                index: 0,
                sub:
                  data.plan.month === "2026-10"
                    ? lang === "ar"
                      ? "الدورات الست فقط"
                      : "Six courses only"
                    : "Paid + Organic/Webinar",
              }}
            />
            {data.plan.month !== "2026-10" && (
              <MetricDetailTrigger
                detail={figures.paidTarget}
                card={{ index: 1, sub: ratioPct(data.actual.paidLeadAchievement) }}
              />
            )}
            <MetricDetailTrigger
              detail={figures.budget}
              card={{
                index: 2,
                sub: `${fmtUSDFull(data.actual.targetedSpend)} ${lang === "ar" ? "مصروف" : "spent"}`,
              }}
            />
            <MetricDetailTrigger
              detail={figures.cpl}
              card={{
                index: 3,
                sub: `${lang === "ar" ? "الفعلي" : "actual"} ${fmtUSDFull(data.actual.targetedCpl)}`,
              }}
            />
            <MetricDetailTrigger
              detail={figures.salesTarget}
              card={{ index: 4, hero: true, sub: ratioPct(data.actual.salesAchievement) }}
            />
            <MetricDetailTrigger
              detail={figures.totalBudget}
              card={{
                index: 5,
                sub:
                  data.plan.overallMarketingBudgetUsd !== undefined
                    ? lang === "ar"
                      ? "إجمالي الصورة · التوزيع لم يُحدد"
                      : "Image total · allocation pending"
                    : `+ ${fmtUSDFull(data.plan.additionalBudgetUsd)} ${lang === "ar" ? "أنشطة إضافية" : "extra activities"}`,
              }}
            />
          </KpiRow>

          {data.plan.status === "draft" && (
            <Notice tone="warning" icon={<TriangleAlert size={16} />}>
              {lang === "ar"
                ? "الخطة دي مازالت مسودة. عدّل الأرقام واعتمدها من محرر الخطة قبل اتخاذ قرار زيادة أو خفض الميزانية."
                : "This plan is still a draft. Edit and approve it before making budget allocation decisions."}
            </Notice>
          )}

          {!!data.storeError && <Notice tone="warning">{data.storeError}</Notice>}

          <PlanDeliverySection
            deliverables={data.deliverables}
            elapsed={data.window.elapsed}
            phase={data.window.phase}
            lang={lang}
            onEditManual={data.editable ? () => setEditor("edit") : undefined}
          />

          <NeedsAttention
            deliverables={data.deliverables}
            elapsed={data.window.elapsed}
            lang={lang}
            onEditManual={data.editable ? () => setEditor("edit") : undefined}
          />

          <Card className="border-dashed border-brand/25 bg-brand-soft/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-text">
                  {lang === "ar" ? "تفاصيل تنفيذ الحملات" : "Detailed campaign delivery"}
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  {lang === "ar"
                    ? "حالة التشغيل الرسمية والجدول التفصيلي متاحان عند الحاجة، خارج التدفق الإداري الرئيسي."
                    : "Official platform state and the full campaign table are available when needed, outside the main management flow."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCampaignDelivery((open) => !open)}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand px-3 text-xs font-bold text-white"
              >
                {showCampaignDelivery
                  ? lang === "ar"
                    ? "إخفاء التفاصيل"
                    : "Hide details"
                  : lang === "ar"
                    ? "عرض تفاصيل الحملات"
                    : "View campaign delivery"}
                <ArrowUpRight size={14} />
              </button>
            </div>
          </Card>

          {showCampaignDelivery && <MediaPlanActivityPanel month={data.plan.month} />}

          <Card padded={false} className="overflow-hidden">
            <div className="p-4 sm:p-5">
              <SectionTitle
                hint={
                  lang === "ar"
                    ? "Actual Leads من المنصة عند توفرها؛ وإذا المنصة لا ترسلها يظهر CRM fallback بوضوح."
                    : "Actual leads use platform reporting when available; CRM fallback is labelled explicitly."
                }
              >
                {lang === "ar" ? "خطة كل دورة والمسؤول عنها" : "Course targets and ownership"}
              </SectionTitle>
            </div>

            <div className="hidden table-wrap scroll-hint-x lg:block">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="bg-surface-2 text-xs text-text-muted">
                  <tr>
                    {[
                      lang === "ar" ? "الدورة" : "Course",
                      lang === "ar" ? "المسؤول" : "Owner",
                      lang === "ar" ? "تارجت الليدز" : "Lead target",
                      lang === "ar" ? "Budget" : "Budget",
                      lang === "ar" ? "Target CPL" : "Target CPL",
                      lang === "ar" ? "ليدز فعلية" : "Actual leads",
                      lang === "ar" ? "Actual CPL" : "Actual CPL",
                      lang === "ar" ? "الصرف" : "Spend",
                      lang === "ar" ? "الإنجاز" : "Progress",
                      lang === "ar" ? "الحالة" : "Status",
                    ].map((header) => (
                      <th key={header} className="px-3 py-3 text-start font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.courses.map((row) => (
                    <CourseTableRow key={row.key} row={row} phase={data.window.phase} lang={lang} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 p-3 pt-0 lg:hidden">
              {data.courses.map((row) => (
                <CourseMobileCard key={row.key} row={row} phase={data.window.phase} lang={lang} />
              ))}
            </div>
          </Card>

          <div className="card-grid xl:grid-cols-[1.25fr_.75fr]">
            <Card>
              <SectionTitle
                hint={
                  data.plan.overallMarketingBudgetUsd !== undefined
                    ? lang === "ar"
                      ? `الصورة تحدد ${fmtUSDFull(data.plan.overallMarketingBudgetUsd)} للتسويق كله، لكنها لا تفصل ميزانية كل نشاط.`
                      : `The image specifies ${fmtUSDFull(data.plan.overallMarketingBudgetUsd)} overall, without activity allocations.`
                    : lang === "ar"
                      ? `دي ليست ضمن ${fmtUSDFull(data.plan.leadGenerationBudgetUsd)} الخاصة بتوليد الليدز.`
                      : `These activities sit outside the ${fmtUSDFull(data.plan.leadGenerationBudgetUsd)} lead-generation budget.`
                }
              >
                {lang === "ar" ? "الميزانية الإضافية" : "Additional activity budget"}
              </SectionTitle>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {data.plan.additionalActivities.map((activity) => (
                  <div
                    key={activity.key}
                    className="rounded-2xl border border-border bg-surface-2 p-3"
                  >
                    <div className="text-[11px] leading-snug text-text-muted">{activity.label}</div>
                    <div className="num mt-2 text-lg font-bold text-text">
                      {data.plan.overallMarketingBudgetUsd !== undefined && activity.budgetUsd === 0
                        ? lang === "ar"
                          ? "غير محددة"
                          : "Unallocated"
                        : fmtUSDFull(activity.budgetUsd)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-text-muted">
                <span>
                  {lang === "ar" ? "المحجوز للدورات" : "Allocated to courses"}:{" "}
                  {fmtUSDFull(data.plan.plannedCourseBudgetUsd)}
                </span>
                <span>
                  {data.plan.overallMarketingBudgetUsd !== undefined
                    ? lang === "ar"
                      ? "غير موزع من الإجمالي"
                      : "Unallocated from total"
                    : lang === "ar"
                      ? "احتياطي من ميزانية الليدز"
                      : "Lead budget reserve"}
                  :{" "}
                  {fmtUSDFull(
                    data.plan.overallMarketingBudgetUsd !== undefined
                      ? Math.max(
                          0,
                          data.plan.overallMarketingBudgetUsd -
                            data.plan.leadGenerationBudgetUsd -
                            data.plan.additionalBudgetUsd,
                        )
                      : data.plan.reserveBudgetUsd,
                  )}
                </span>
              </div>
            </Card>

            <Card>
              <SectionTitle>
                {lang === "ar" ? "مصدر الخطة وطريقة القراءة" : "Plan source and reading guide"}
              </SectionTitle>
              <div className="space-y-3 text-xs leading-relaxed text-text-muted">
                <div className="flex gap-2">
                  <Info size={15} className="mt-0.5 shrink-0 text-brand" />
                  <p>
                    {data.plan.month === "2026-10"
                      ? lang === "ar"
                        ? `تارجت الدورات = ${fmtNum(data.courses.reduce((sum, row) => sum + row.targetLeads, 0))} ليد، وأهداف الموقع ويوتيوب والبراندينج مستقلة. إجمالي 24,700 في الصورة غير قابل للمطابقة مع هذه البنود حتى تتضح تعريفاته.`
                        : `Course rows target ${fmtNum(data.courses.reduce((sum, row) => sum + row.targetLeads, 0))} leads; website, YouTube and branding remain separate. The image's 24,700 total cannot be reconciled until its scope is clarified.`
                      : lang === "ar"
                        ? `تارجت الدورات = ${fmtNum(data.courses.reduce((sum, row) => sum + row.targetLeads, 0))} Paid Leads. وتارجت Organic وWebinar منفصل حتى لا يتحسب مرتين.`
                        : `Course rows total ${fmtNum(data.courses.reduce((sum, row) => sum + row.targetLeads, 0))} paid leads. Organic and Webinar remain separate so they are not double-counted.`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <UserRoundCheck size={15} className="mt-0.5 shrink-0 text-brand" />
                  <p>
                    {lang === "ar"
                      ? "المسؤولون قابلون للتعديل لكل شهر، والمسؤولية المشتركة تظل ظاهرة بدل تقسيم الليدز افتراضيًا."
                      : "Owners are editable per month. Joint ownership stays explicit instead of inventing a lead split."}
                  </p>
                </div>
                {data.sources.map((source) => (
                  <p
                    key={source}
                    className="border-t border-border pt-2 text-[11px] text-text-subtle"
                  >
                    {source}
                  </p>
                ))}
              </div>
            </Card>
          </div>

          {(data.actual.unattributedOrUnplannedSpend > 0 || data.unplanned.length > 0) && (
            <Notice tone="warning" icon={<TriangleAlert size={16} />}>
              {lang === "ar"
                ? `يوجد ${fmtUSDFull(data.actual.unattributedOrUnplannedSpend)} صرف خارج دورات الخطة أو غير قابل للربط بها في هذا الشهر. راجع أسماء الحملات وكلمات المطابقة قبل اعتباره جزءًا من تحقيق الخطة.`
                : `${fmtUSDFull(data.actual.unattributedOrUnplannedSpend)} of spend is outside planned courses or cannot be attributed. Review campaign names and match terms before counting it toward the plan.`}
            </Notice>
          )}

          <MediaPlanEditor
            open={editor !== null}
            onOpenChange={(open) => !open && setEditor(null)}
            mode={editor ?? "edit"}
            plan={data.plan}
            editable={data.editable}
            auth={data.auth}
            storeError={data.storeError}
            existingMonths={data.availableMonths}
            onSaved={(savedMonth) => {
              setMonth(savedMonth);
              setEditor(null);
              void refetch();
            }}
          />
        </>
      )}
    </div>
  );
}

function ProgressRail({
  label,
  actual,
  target,
  ratio,
  expected,
  accent,
}: {
  label: string;
  actual: string;
  target: string;
  ratio: number | null;
  expected: number;
  accent: string;
}) {
  const { lang } = useI18n();
  return (
    <div className="rounded-2xl border border-border bg-surface-2/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-text">{label}</span>
        <span className="num text-xs font-bold" style={{ color: accent }}>
          {ratioPct(ratio)}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="num text-xl font-bold text-text">{actual}</span>
        <span className="text-[11px] text-text-subtle">/ {target}</span>
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: barWidth(ratio), background: accent }}
        />
        <span
          className="absolute inset-y-[-2px] w-0.5 bg-text/55"
          style={{ insetInlineStart: barWidth(expected) }}
          title={lang === "ar" ? "المطلوب حتى اليوم" : "Expected to date"}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-text-subtle">
        <span>{lang === "ar" ? "المتحقق" : "Actual"}</span>
        <span>
          {lang === "ar" ? "المطلوب حتى اليوم" : "Expected today"}: {ratioPct(expected)}
        </span>
      </div>
    </div>
  );
}

function PlanDeliverySection({
  deliverables,
  elapsed,
  phase,
  lang,
  onEditManual,
}: {
  deliverables: DeliverableRow[];
  elapsed: number;
  phase: PlanPhase;
  lang: "ar" | "en";
  onEditManual?: () => void;
}) {
  return (
    <Card className="overflow-hidden border-brand/15">
      <SectionTitle
        hint={
          lang === "ar"
            ? "ما طُلب من الفريق مقابل ما تم تنفيذه فعلًا، مع مراعاة نسبة الشهر المنقضية."
            : "What the team was asked to deliver versus what is done, paced against the elapsed month."
        }
        action={
          <Pill tone={phase === "active" ? "brand" : "neutral"}>
            {phase === "upcoming"
              ? lang === "ar"
                ? "لم يبدأ الشهر"
                : "Month not started"
              : `${fmtPct(elapsed * 100, 0)} ${lang === "ar" ? "من الشهر" : "of month"}`}
          </Pill>
        }
      >
        {lang === "ar" ? "تنفيذ خطة الشهر" : "Monthly Plan Delivery"}
      </SectionTitle>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {deliverables.map((row, index) => (
          <DeliverableCard
            key={row.key}
            row={row}
            elapsed={elapsed}
            lang={lang}
            index={index}
            onEditManual={onEditManual}
          />
        ))}
      </div>
    </Card>
  );
}

function NeedsAttention({
  deliverables,
  elapsed,
  lang,
  onEditManual,
}: {
  deliverables: DeliverableRow[];
  elapsed: number;
  lang: "ar" | "en";
  onEditManual?: () => void;
}) {
  const priority = { not_connected: 0, not_started: 1, behind: 2 } as const;
  const rows = deliverables
    .map((row, index) => ({
      row,
      index,
      status: deliverableStatus(row.actual, row.target, elapsed, row.connected),
    }))
    .filter(({ status }) => status in priority)
    .sort(
      (a, b) =>
        priority[a.status as keyof typeof priority] - priority[b.status as keyof typeof priority],
    )
    .slice(0, 3);

  return (
    <Card className="border-amber-border/70 bg-amber-surface/35">
      <SectionTitle
        hint={
          lang === "ar"
            ? "أقصى ثلاثة عناصر تحتاج قرارًا أو توصيل مصدر بيانات."
            : "Up to three items that need a decision or a connected source."
        }
      >
        {lang === "ar" ? "تحتاج انتباه" : "Needs attention"}
      </SectionTitle>
      {rows.length === 0 ? (
        <p className="text-sm font-semibold text-mint-ink">
          {lang === "ar"
            ? "كل التسليمات المتصلة على المسار أو مكتملة."
            : "All connected deliverables are on track or complete."}
        </p>
      ) : (
        <div className="grid gap-2 md:grid-cols-3">
          {rows.map(({ row, status }) => {
            const isManual = row.actualSource === "Manual month-to-date report";
            const contents = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-bold text-text">{row.label}</span>
                  <span className="shrink-0 text-[10px] font-bold text-amber-ink">
                    {deliverableStatusLabel(status, lang)}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-text-muted">
                  {row.actual === null || !row.connected
                    ? lang === "ar"
                      ? isManual
                        ? "لم يُدخل المحقق بعد"
                        : "المصدر غير متصل"
                      : isManual
                        ? "Actual not reported yet"
                        : "Source not connected"
                    : `${fmtNum(row.actual)} / ${fmtNum(row.target)} ${row.unit === "units" ? (lang === "ar" ? "وحدة غير محددة" : "unspecified units") : row.unit}`}
                </div>
              </>
            );
            const className =
              "rounded-xl border border-amber-border/60 bg-surface px-3 py-2.5 text-start transition-colors hover:border-brand/40";
            return isManual ? (
              <button
                key={row.key}
                type="button"
                onClick={onEditManual}
                disabled={!onEditManual}
                className={className}
              >
                {contents}
              </button>
            ) : (
              <Link key={row.key} to={row.reportTo as never} className={className}>
                {contents}
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}

const DELIVERABLE_TONES = [
  { strong: "var(--sky-strong)", surface: "var(--sky-surface)", ink: "var(--sky-ink)" },
  { strong: "var(--violet-strong)", surface: "var(--violet-surface)", ink: "var(--violet-ink)" },
  { strong: "var(--amber-strong)", surface: "var(--amber-surface)", ink: "var(--amber-ink)" },
  { strong: "var(--mint-strong)", surface: "var(--mint-surface)", ink: "var(--mint-ink)" },
  { strong: "var(--rose-strong)", surface: "var(--rose-surface)", ink: "var(--rose-ink)" },
];

function deliverableStatus(
  actual: number | null,
  target: number,
  elapsed: number,
  connected: boolean,
) {
  if (!connected || actual === null) return "not_connected";
  if (actual >= target && target > 0) return "complete";
  if (actual <= 0) return "not_started";
  const achievement = target > 0 ? actual / target : 0;
  if (achievement >= elapsed + 0.05) return "ahead";
  if (achievement + 0.05 < elapsed) return "behind";
  return "on_track";
}

function deliverableStatusLabel(status: string, lang: "ar" | "en") {
  const labels: Record<string, { ar: string; en: string }> = {
    ahead: { ar: "متقدم", en: "Ahead" },
    on_track: { ar: "على المسار", en: "On track" },
    behind: { ar: "متأخر", en: "Behind" },
    not_started: { ar: "لم يبدأ", en: "Not started" },
    complete: { ar: "مكتمل", en: "Complete" },
    not_connected: { ar: "غير متصل", en: "Not connected" },
  };
  return labels[status]?.[lang] ?? status;
}

function DeliverableCard({
  row,
  elapsed,
  lang,
  index,
  onEditManual,
}: {
  row: DeliverableRow;
  elapsed: number;
  lang: "ar" | "en";
  index: number;
  onEditManual?: () => void;
}) {
  const tone = DELIVERABLE_TONES[index % DELIVERABLE_TONES.length];
  const actual = row.actual;
  const achievement =
    actual !== null && row.connected && row.target > 0 ? actual / row.target : null;
  const status = deliverableStatus(actual, row.target, elapsed, row.connected);
  const remaining = actual === null || !row.connected ? null : Math.max(0, row.target - actual);
  const label =
    row.key === "website" ? (lang === "ar" ? "ليدز الموقع" : "Website leads") : row.label;
  const isManual = row.actualSource === "Manual month-to-date report";
  const unit =
    row.unit === "units" ? (lang === "ar" ? "وحدة غير محددة" : "unspecified units") : row.unit;

  return (
    <div
      className="group rounded-2xl border border-border bg-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-md"
      style={{ borderTopColor: tone.strong, borderTopWidth: 3 }}
      title={`${row.actualSource} · ${row.dateScope} · ${row.matchingRule}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div
            className="text-[11px] font-bold uppercase tracking-[0.08em]"
            style={{ color: tone.ink }}
          >
            {label}
          </div>
          <div className="mt-2 text-xs text-text-muted">{lang === "ar" ? "التارجت" : "Target"}</div>
          <div className="num mt-0.5 text-2xl font-black tracking-tight text-text">
            {fmtNum(row.target)}{" "}
            <span className="text-xs font-semibold text-text-muted">{unit}</span>
          </div>
        </div>
        <span
          className="rounded-full px-2 py-1 text-[10px] font-bold"
          style={{ background: tone.surface, color: tone.ink }}
        >
          {deliverableStatusLabel(status, lang)}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-text-muted">{lang === "ar" ? "الفعلي" : "Actual"}</div>
          <div className="num mt-0.5 text-xl font-bold text-text">
            {actual === null || !row.connected ? "—" : fmtNum(actual)}
          </div>
        </div>
        <div className="text-end">
          <div className="text-xs text-text-muted">{lang === "ar" ? "الإنجاز" : "Achievement"}</div>
          <div className="num mt-0.5 text-lg font-bold" style={{ color: tone.ink }}>
            {achievement === null ? "—" : fmtPct(achievement * 100, 1)}
          </div>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: barWidth(achievement), background: tone.strong }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-text-subtle">
        <span>
          {remaining === null
            ? lang === "ar"
              ? isManual
                ? "لم يُدخل المحقق بعد"
                : "لا يوجد مصدر موصل"
              : isManual
                ? "Actual not reported yet"
                : "No source connected"
            : `${fmtNum(remaining)} ${lang === "ar" ? "متبقي" : "remaining"}`}
        </span>
        {isManual ? (
          onEditManual ? (
            <button type="button" onClick={onEditManual} className="font-semibold text-brand">
              {lang === "ar" ? "سجّل المحقق" : "Enter actual"}
            </button>
          ) : (
            <span>{lang === "ar" ? "يتطلب صلاحية تعديل" : "Editor access required"}</span>
          )
        ) : (
          <Link to={row.reportTo as never} className="font-semibold group-hover:text-brand">
            {lang === "ar" ? "فتح التقرير ↗" : "View report ↗"}
          </Link>
        )}
      </div>
      <p className="mt-2 border-t border-border/70 pt-2 text-[10px] text-text-muted">
        {isManual
          ? lang === "ar"
            ? "المصدر: إدخال يدوي غير متحقق آليًا"
            : "Source: manually reported, not API-verified"
          : lang === "ar"
            ? `المصدر: ${row.actualSource}`
            : `Source: ${row.actualSource}`}
      </p>
    </div>
  );
}

function CourseTableRow({
  row,
  phase,
  lang,
}: {
  row: CourseRow;
  phase: PlanPhase;
  lang: "ar" | "en";
}) {
  const state = courseState(row, phase);
  return (
    <tr className="hover:bg-surface-2/55">
      <td className="px-3 py-3.5 font-bold text-text">{row.label}</td>
      <td className="px-3 py-3.5">
        <OwnerList owners={row.owners} />
      </td>
      <td className="num px-3 py-3.5 font-semibold text-text">{fmtNum(row.targetLeads)}</td>
      <td className="num px-3 py-3.5">
        {row.targetCpl > 0 ? fmtUSDFull(row.targetBudgetUsd) : "—"}
      </td>
      <td className="num px-3 py-3.5">{row.targetCpl > 0 ? fmtUSDFull(row.targetCpl) : "—"}</td>
      <td className="px-3 py-3.5">
        <div className="num font-semibold text-text">{fmtNum(row.actual.actualLeads)}</div>
        <div className="mt-0.5 text-[10px] text-text-subtle">
          {row.actual.leadBasis === "platform" ? "Platform" : "CRM fallback"} · CRM{" "}
          {fmtNum(row.actual.crmLeads)}
        </div>
      </td>
      <td className="num px-3 py-3.5">{fmtUSDFull(row.actual.actualCpl)}</td>
      <td className="num px-3 py-3.5">{fmtUSDFull(row.actual.spend)}</td>
      <td className="min-w-32 px-3 py-3.5">
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-text-muted">
          <span>{ratioPct(row.actual.achievement)}</span>
          <span>{fmtNum(Math.round(row.actual.expectedLeads))}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: barWidth(row.actual.achievement) }}
          />
        </div>
      </td>
      <td className="px-3 py-3.5">
        <Pill tone={state.tone}>{stateLabel(state.key, lang)}</Pill>
      </td>
    </tr>
  );
}

function CourseMobileCard({
  row,
  phase,
  lang,
}: {
  row: CourseRow;
  phase: PlanPhase;
  lang: "ar" | "en";
}) {
  const state = courseState(row, phase);
  return (
    <article className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-text">{row.label}</h3>
          <div className="mt-1">
            <OwnerList owners={row.owners} />
          </div>
        </div>
        <Pill tone={state.tone}>{stateLabel(state.key, lang)}</Pill>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <CompactMetric
          label={lang === "ar" ? "التارجت" : "Target"}
          value={fmtNum(row.targetLeads)}
        />
        <CompactMetric
          label="Target CPL"
          value={row.targetCpl > 0 ? fmtUSDFull(row.targetCpl) : "—"}
        />
        <CompactMetric
          label={lang === "ar" ? "الميزانية" : "Budget"}
          value={row.targetCpl > 0 ? fmtUSDFull(row.targetBudgetUsd) : "—"}
        />
        <CompactMetric
          label={lang === "ar" ? "ليدز فعلية" : "Actual leads"}
          value={fmtNum(row.actual.actualLeads)}
        />
        <CompactMetric label="Actual CPL" value={fmtUSDFull(row.actual.actualCpl)} />
        <CompactMetric
          label={lang === "ar" ? "الصرف" : "Spend"}
          value={fmtUSDFull(row.actual.spend)}
        />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: barWidth(row.actual.achievement) }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-text-subtle">
        <span>{ratioPct(row.actual.achievement)}</span>
        <span>
          {lang === "ar" ? "المطلوب حتى اليوم" : "Expected today"}:{" "}
          {fmtNum(Math.round(row.actual.expectedLeads))}
        </span>
      </div>
    </article>
  );
}

function OwnerList({ owners }: { owners: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {owners.map((owner) => (
        <span
          key={owner}
          className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand"
        >
          {owner}
        </span>
      ))}
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <div className="text-[9px] leading-snug text-text-subtle">{label}</div>
      <div className="num mt-1 truncate text-xs font-bold text-text">{value}</div>
    </div>
  );
}

function stateLabel(key: string, lang: "ar" | "en") {
  const labels: Record<string, { ar: string; en: string }> = {
    upcoming: { ar: "لم يبدأ", en: "Not started" },
    no_delivery: { ar: "لا يوجد تشغيل", en: "No delivery" },
    high_cpl: { ar: "CPL أعلى", en: "CPL high" },
    behind: { ar: "أقل من المطلوب", en: "Behind plan" },
    on_track: { ar: "على المسار", en: "On track" },
  };
  return labels[key]?.[lang] ?? key;
}

function MediaPlanSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-80 rounded-[28px]" />
      <Skeleton className="h-52" />
      <Skeleton className="h-[420px]" />
    </div>
  );
}
