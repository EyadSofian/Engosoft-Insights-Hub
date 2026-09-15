import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  BadgeDollarSign,
  BarChart3,
  BellRing,
  BookOpenCheck,
  CalendarDays,
  CircleDollarSign,
  GraduationCap,
  History,
  Info,
  LayoutGrid,
  Leaf,
  ReceiptText,
  Search,
  Sparkles,
  ShoppingCart,
  Target,
  TrendingDown,
  TriangleAlert,
  Users,
} from "lucide-react";
import { FilterSummary } from "@/components/ads/FilterSummary";
import { CourseCreativeGallery } from "@/components/ads/CampaignCreativeGallery";
import { DeltaBadge, EmptyState, ErrorState, Notice, Pill, Skeleton } from "@/components/ui-bits";
import { MoreDetails } from "@/components/dashboard-bits";
import { OverviewCourseContribution } from "@/components/overview-records";
import { DashboardPageHeader, DataHealthSummary, KpiRow } from "@/components/dashboard-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { topRows, type MetricDetail } from "@/lib/metric-detail";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/constants";
import type { CourseLeadAlertReport, CourseLeadSignal } from "@/lib/course-lead-alerts";
import { useFilters } from "@/lib/filter-store";
import { fmtDate, fmtNum, fmtPct, fmtRoas, fmtUSD, useI18n } from "@/lib/i18n";
import type { CampaignObjective, CourseAgg, Platform, Totals } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import {
  useRegisterNexusEntity,
  useRegisterNexusView,
} from "@/components/engo-nexus/state/nexus-view-context";

export const Route = createFileRoute("/courses")({ component: Courses });

type AttributionSource = "source_mapping" | "campaign_name" | "crm_leads";

interface CourseCampaign {
  key: string;
  name: string;
  platforms: Platform[];
  accounts: string[];
  sources: string[];
  objective: CampaignObjective;
  spend: number;
  latestSpend: number;
  latestDates: string[];
  platformLeads: number | null;
  crmLeads: number;
  lost: number;
  won: number;
  revenue: number;
  invoices: number;
  salesOrders: number;
  roas: number | null;
  spendDateMin: string;
  spendDateMax: string;
  attributionSources: AttributionSource[];
  attributionConfidence: number;
  officialActive: boolean;
  statusSpend24h: number;
  statusCheckedAt: string;
  statusSource: string;
}

interface CourseMonth {
  month: string;
  spend: number;
  platformLeads: number | null;
  leads: number;
  lost: number;
  won: number;
  salesOrders: number;
  invoices: number;
  revenue: number;
  roas: number | null;
}

interface CourseDrill {
  course: string;
  latestWindow: Partial<Record<Platform, string>>;
  activeCampaigns: CourseCampaign[];
  previousCampaigns: CourseCampaign[];
  previousCampaignCount: number;
  attribution: {
    spendBySource: Record<AttributionSource, number>;
    totalAttributedSpend: number;
  };
  monthly: CourseMonth[];
}

interface CoursesResponse {
  courses: CourseAgg[];
  totals: Totals;
  drill?: CourseDrill | null;
}

/**
 * The five course figures, and the courses behind each.
 *
 * EVERY BREAKDOWN HERE IS PER COURSE, because that is the page's unit. The
 * money side (revenue, invoices, sales orders) comes from the accounting rows
 * and carries a course written by the sync; the spend side is matched onto a
 * course from the ad text, which is a weaker link — so the spend panel says so
 * rather than letting the two look equally solid.
 */
function courseMetrics(
  courses: CourseAgg[],
  linked: { spend: number; leads: number; salesOrders: number; invoices: number; revenue: number },
  lang: "ar" | "en",
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const byCourse = (
    pick: (course: CourseAgg) => number,
    format: (n: number) => string,
    tone: "mint" | "rose" | "sky" | "violet" | "amber" | "cyan",
  ) =>
    topRows(
      courses.map((course) => ({
        key: course.key,
        label: course.name,
        value: pick(course),
        display: format(pick(course)),
        meta: course.mainCategory || undefined,
        tone,
      })),
    );

  const attributionCaveat = A
    ? "الإنفاق يُنسب إلى الدورة من نص الإعلان، لا من عمود دورة في مصدر الإعلانات. الإيراد والليدز ينسبان من عمود الدورة نفسه، ولذلك فالجانبان ليسا بنفس درجة الثقة."
    : "Spend is matched to a course from the ad's own text, not from a course column in the ads feed. Revenue and leads carry a course written by the sync, so the two sides are not equally reliable.";

  return {
    revenue: {
      id: "courses.revenue",
      title: A ? "المحصل من الدورات" : "Course revenue",
      value: fmtUSD(linked.revenue),
      tone: "mint",
      icon: <GraduationCap size={16} />,
      definition: A
        ? "الإيراد المحصّل من الفواتير المدفوعة التي تحمل دورة معروفة داخل الفترة."
        : "Revenue collected from paid invoices that carry a known course inside the period.",
      formula: A
        ? `${fmtUSD(linked.revenue)} من ${fmtNum(linked.invoices)} فاتورة عبر ${fmtNum(courses.length)} دورة.`
        : `${fmtUSD(linked.revenue)} from ${fmtNum(linked.invoices)} invoices across ${fmtNum(courses.length)} courses.`,
      supporting: [
        { key: "invoices", label: A ? "الفواتير" : "Invoices", value: fmtNum(linked.invoices) },
        { key: "leads", label: A ? "الليدز" : "Leads", value: fmtNum(linked.leads) },
        { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSD(linked.spend) },
        {
          key: "roas",
          label: A ? "العائد" : "Return",
          value: linked.spend > 0 ? fmtRoas(linked.revenue / linked.spend) : "—",
        },
      ],
      breakdowns: [
        {
          id: "courses",
          title: A ? "أعلى الدورات إيرادًا" : "Top courses by revenue",
          rows: byCourse((course) => course.revenue, fmtUSD, "mint"),
          emptyLabel: A ? "لا توجد دورة بإيراد" : "No course carries revenue",
        },
        {
          id: "avg",
          title: A ? "أعلى متوسط فاتورة" : "Highest average invoice",
          rows: byCourse((course) => course.avgOrder ?? 0, fmtUSD, "amber"),
          emptyLabel: A ? "لا توجد فواتير" : "No invoices",
        },
      ],
      report: { to: "/accounting", label: A ? "فتح تقرير الحسابات" : "Open the Accounting report" },
    },
    spend: {
      id: "courses.spend",
      title: A ? "إنفاق الدورات" : "Course ad spend",
      value: fmtUSD(linked.spend),
      tone: "rose",
      icon: <BadgeDollarSign size={16} />,
      definition: A
        ? "الإنفاق الإعلاني الذي أمكن نسبته إلى دورة بعينها في الفترة."
        : "Ad spend that could be matched to a specific course in the period.",
      caveat: attributionCaveat,
      formula: A
        ? `${fmtUSD(linked.spend)} مقابل ${fmtUSD(linked.revenue)} إيراد = ${linked.spend > 0 ? fmtRoas(linked.revenue / linked.spend) : "—"}.`
        : `${fmtUSD(linked.spend)} against ${fmtUSD(linked.revenue)} of revenue = ${linked.spend > 0 ? fmtRoas(linked.revenue / linked.spend) : "—"}.`,
      supporting: [
        { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSD(linked.revenue) },
        { key: "leads", label: A ? "الليدز" : "Leads", value: fmtNum(linked.leads) },
        {
          key: "cpl",
          label: "CPL",
          value: linked.leads > 0 ? fmtUSD(linked.spend / linked.leads) : "—",
        },
        { key: "courses", label: A ? "الدورات" : "Courses", value: fmtNum(courses.length) },
      ],
      breakdowns: [
        {
          id: "courses",
          title: A ? "أعلى الدورات إنفاقًا" : "Courses with the most spend",
          rows: byCourse((course) => course.spend, fmtUSD, "rose"),
          emptyLabel: A ? "لا توجد دورة بإنفاق" : "No course carries spend",
        },
        {
          id: "returns",
          title: A ? "أعلى الدورات عائدًا" : "Courses with the best return",
          rows: byCourse((course) => course.roas ?? 0, fmtRoas, "mint"),
          emptyLabel: A ? "لا توجد دورة مؤهلة" : "No eligible course",
        },
      ],
      report: { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" },
    },
    leads: {
      id: "courses.leads",
      title: A ? "ليدز الدورات" : "Course leads",
      value: fmtNum(linked.leads),
      tone: "sky",
      icon: <Users size={16} />,
      definition: A
        ? "العملاء المحتملون الذين تحمل صفوفهم دورة معروفة داخل الفترة."
        : "Leads whose rows carry a known course inside the period.",
      formula: A
        ? `${fmtNum(linked.leads)} ليد عبر ${fmtNum(courses.length)} دورة، بتكلفة ${linked.leads > 0 ? fmtUSD(linked.spend / linked.leads) : "—"} لكل ليد.`
        : `${fmtNum(linked.leads)} leads across ${fmtNum(courses.length)} courses, at ${linked.leads > 0 ? fmtUSD(linked.spend / linked.leads) : "—"} each.`,
      supporting: [
        { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSD(linked.spend) },
        {
          key: "cpl",
          label: "CPL",
          value: linked.leads > 0 ? fmtUSD(linked.spend / linked.leads) : "—",
        },
        { key: "invoices", label: A ? "الفواتير" : "Invoices", value: fmtNum(linked.invoices) },
        {
          key: "conversion",
          label: A ? "التحويل إلى فاتورة" : "Lead to invoice",
          value: linked.leads > 0 ? fmtPct((linked.invoices / linked.leads) * 100, 1) : "—",
        },
      ],
      breakdowns: [
        {
          id: "courses",
          title: A ? "أعلى الدورات في العملاء" : "Courses with the most leads",
          rows: byCourse((course) => course.crmLeads, fmtNum, "sky"),
          emptyLabel: A ? "لا توجد دورة بعملاء" : "No course carries leads",
        },
        {
          id: "conversion",
          title: A ? "أعلى الدورات تحويلًا" : "Best converting courses",
          rows: byCourse(
            (course) => course.conversionRate ?? 0,
            (n) => fmtPct(n, 1),
            "violet",
          ),
          emptyLabel: A ? "لا توجد دورة قابلة للقياس" : "No measurable course",
        },
      ],
      report: { to: "/leads", label: A ? "فتح تقرير العملاء" : "Open the leads report" },
    },
    salesOrders: {
      id: "courses.salesOrders",
      title: A ? "أوامر البيع المرتبطة" : "Linked sales orders",
      value: fmtNum(linked.salesOrders),
      tone: "violet",
      icon: <ShoppingCart size={16} />,
      definition: A
        ? "أوامر البيع المفوترة بالكامل والمرتبطة بدورة. مؤشر استرشادي بجانب الفواتير المدفوعة، وليس بديلًا عنها."
        : "Fully invoiced sales orders linked to a course. An advisory figure beside the paid invoices, never a replacement for them.",
      formula: A
        ? `${fmtNum(linked.salesOrders)} أمر بيع مقابل ${fmtNum(linked.invoices)} فاتورة مدفوعة.`
        : `${fmtNum(linked.salesOrders)} sales orders against ${fmtNum(linked.invoices)} paid invoices.`,
      supporting: [
        {
          key: "invoices",
          label: A ? "الفواتير المدفوعة" : "Paid invoices",
          value: fmtNum(linked.invoices),
        },
        { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSD(linked.revenue) },
        { key: "leads", label: A ? "الليدز" : "Leads", value: fmtNum(linked.leads) },
        { key: "courses", label: A ? "الدورات" : "Courses", value: fmtNum(courses.length) },
      ],
      breakdowns: [
        {
          id: "courses",
          title: A ? "حسب الدورة" : "By course",
          rows: byCourse((course) => course.salesOrders, fmtNum, "violet"),
          emptyLabel: A ? "لا توجد أوامر بيع" : "No sales orders",
        },
      ],
    },
    invoices: {
      id: "courses.invoices",
      title: A ? "الفواتير المرتبطة" : "Linked paid invoices",
      value: fmtNum(linked.invoices),
      tone: "cyan",
      icon: <ReceiptText size={16} />,
      definition: A
        ? "عدد الفواتير المدفوعة المميزة التي تحمل دورة معروفة. هذا هو تعريف البيع المعتمد على هذه الصفحة."
        : "Distinct paid invoices carrying a known course. This is the approved definition of a sale on this page.",
      formula: A
        ? `${fmtNum(linked.invoices)} فاتورة بقيمة ${fmtUSD(linked.revenue)}.`
        : `${fmtNum(linked.invoices)} invoices worth ${fmtUSD(linked.revenue)}.`,
      supporting: [
        { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSD(linked.revenue) },
        {
          key: "avg",
          label: A ? "متوسط الفاتورة" : "Average invoice",
          value: linked.invoices > 0 ? fmtUSD(linked.revenue / linked.invoices) : "—",
        },
        { key: "leads", label: A ? "الليدز" : "Leads", value: fmtNum(linked.leads) },
        {
          key: "rate",
          label: A ? "التحويل إلى فاتورة" : "Lead to invoice",
          value: linked.leads > 0 ? fmtPct((linked.invoices / linked.leads) * 100, 1) : "—",
        },
      ],
      breakdowns: [
        {
          id: "courses",
          title: A ? "حسب الدورة" : "By course",
          rows: byCourse((course) => course.invoices, fmtNum, "cyan"),
          emptyLabel: A ? "لا توجد فواتير" : "No invoices",
        },
      ],
      report: { to: "/accounting", label: A ? "فتح تقرير الحسابات" : "Open the Accounting report" },
    },
  };
}

function Courses() {
  const reportingPeriod = useReportingPeriod();
  const { lang } = useI18n();
  const filters = useFilters();
  const organicScope = filters.channel === "organic";
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const { data, isLoading, error, refetch } = useApi<CoursesResponse>("/api/courses");
  const leadAlerts = useApi<CourseLeadAlertReport>("/api/course-lead-alerts");

  const courses = useMemo(() => data?.courses ?? [], [data?.courses]);
  const selectedCourse = courses.find((course) => course.key === selectedKey) ?? courses[0] ?? null;
  useRegisterNexusEntity(
    selectedCourse ? { type: "course", id: selectedCourse.key, name: selectedCourse.name } : null,
  );
  const detailPath = selectedCourse
    ? `/api/courses?detail=${encodeURIComponent(selectedCourse.name)}`
    : "/api/courses";
  const detailQuery = useApi<CoursesResponse>(detailPath);
  const visibleCourses = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(lang === "ar" ? "ar" : "en");
    if (!query) return courses;
    return courses.filter((course) =>
      `${course.name} ${course.mainCategory}`
        .toLocaleLowerCase(lang === "ar" ? "ar" : "en")
        .includes(query),
    );
  }, [courses, lang, search]);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const linked = courses.reduce(
    (total, course) => {
      total.spend += course.spend;
      total.leads += course.crmLeads;
      total.salesOrders += course.salesOrders;
      total.invoices += course.invoices;
      total.revenue += course.revenue;
      return total;
    },
    { spend: 0, leads: 0, salesOrders: 0, invoices: 0, revenue: 0 },
  );
  // One description per figure, built from the course rows already on screen.
  const courseTotals = courseMetrics(courses, linked, lang);

  return (
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<GraduationCap size={20} />}
        title={lang === "ar" ? "مركز أداء الكورسات" : "Course performance center"}
        subtitle={
          organicScope
            ? lang === "ar"
              ? "كل دورة من مصادر Odoo غير المدفوعة، وتحتها حملات الأورجانيك المسجلة ومقارنتها شهرًا بشهر."
              : "Each course from non-paid Odoo sources, with its recorded Organic campaigns and month-to-month comparison."
            : lang === "ar"
              ? "اختار الكورس، شوف أفضل الكرياتيفات الشغّالة فورًا، وبعدها أداء الحملات والمبيعات في مكان واحد."
              : "Choose a course, see its best live creatives first, then review campaign and sales performance in one place."
        }
        period={reportingPeriod}
      />

      <FilterSummary />

      {isLoading || !data ? (
        <>
          <div className="card-grid grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-[118px]" />
            ))}
          </div>
          <Skeleton className="h-[520px]" />
        </>
      ) : (
        <>
          <KpiRow>
            <MetricDetailTrigger detail={courseTotals.revenue} card={{ index: 0, hero: true }} />
            <MetricDetailTrigger detail={courseTotals.spend} card={{ index: 1 }} />
            <MetricDetailTrigger detail={courseTotals.leads} card={{ index: 2 }} />
            <MetricDetailTrigger detail={courseTotals.salesOrders} card={{ index: 3 }} />
            <MetricDetailTrigger detail={courseTotals.invoices} card={{ index: 4 }} />
          </KpiRow>

          {/* The attribution chain is what makes a course figure trustworthy or
              not, so it stays on the page — but as a data-health statement
              with its mechanics folded away, not as a five-line paragraph
              between the figures and the table they explain. */}
          <DataHealthSummary
            issues={[
              organicScope
                ? {
                    tone: "info",
                    message:
                      lang === "ar"
                        ? "هذه القراءة تشمل المصادر غير المدفوعة فقط."
                        : "This reading covers non-paid sources only.",
                    impact:
                      lang === "ar"
                        ? "الإنفاق يظل صفراً لأن هذه ليست إعلانات مدفوعة."
                        : "Spend stays at zero because this is not paid advertising.",
                    technical:
                      lang === "ar"
                        ? "النطاق مقصور على مصادر Odoo غير المدفوعة؛ كل صف دورة، وفتحه يعرض حملات الأورجانيك المسجلة ومصادرها وليدزها ومبيعاتها."
                        : "Scoped to non-paid Odoo sources; each row is a course, and opening it lists its recorded Organic campaigns, sources, leads and sales.",
                  }
                : {
                    tone: "info",
                    message:
                      lang === "ar"
                        ? "إنفاق كل دورة مستنتَج من أسماء الحملات، وليس مسجّلاً على الدورة."
                        : "Each course's ad spend is inferred from campaign names, not recorded against the course.",
                    impact:
                      lang === "ar"
                        ? "كل بطاقة حملة تذكر مصدر الربط الذي اعتُمد عليها."
                        : "Every campaign card states the attribution source it relied on.",
                    technical:
                      lang === "ar"
                        ? "اسم الحملة هو الأساس، ثم الدورة المرتبطة بأداء الحملة. اسم الكرياتيف والإعلان والمجموعة يُستخدم كاكتشاف احتياطي إذا لم تكن الحملة مصنفة. الليدز من CRM والإيراد من الفواتير المدفوعة."
                        : "Campaign name is authoritative, followed by the campaign's joined course. Creative, ad and ad-set names are discovery fallbacks only when the campaign is unclassified. Leads come from CRM and revenue from paid invoices.",
                  },
            ]}
          />

          <CoursePortfolioNavigator
            courses={visibleCourses}
            totalCourses={courses.length}
            selectedKey={selectedCourse?.key ?? ""}
            search={search}
            onSearchChange={setSearch}
            onSelect={setSelectedKey}
          />

          {selectedCourse && (
            <CourseDetailPanel
              course={selectedCourse}
              drill={detailQuery.data?.drill ?? null}
              loading={detailQuery.isLoading}
              error={detailQuery.error as Error | null}
              organicScope={organicScope}
            />
          )}

          {leadAlerts.isLoading || !leadAlerts.data ? (
            <Skeleton className="h-[250px]" />
          ) : leadAlerts.error ? (
            <Notice tone="danger" icon={<TriangleAlert size={17} />}>
              {lang === "ar"
                ? `تعذّر تحميل مراقبة الليدز اليومية: ${(leadAlerts.error as Error).message}`
                : `Daily lead monitor failed: ${(leadAlerts.error as Error).message}`}
            </Notice>
          ) : (
            <CourseLeadMonitor report={leadAlerts.data} />
          )}
        </>
      )}

      {/* Contribution and average selling price: the pair that used to sit on
          the executive summary, now in the report about courses. */}
      <MoreDetails
        label={lang === "ar" ? "مساهمة الكورسات في الإيراد" : "Course contribution to revenue"}
        hint={
          lang === "ar"
            ? "أعلى الكورسات إيرادًا في الفترة، ونصيب كل كورس ومتوسط سعر بيعه"
            : "The period's top courses, each one's share and its average selling price"
        }
      >
        <OverviewCourseContribution />
      </MoreDetails>
    </div>
  );
}

type CourseRank = "revenue" | "spend" | "won" | "leads" | "roas";

const COURSE_RANKS: Record<
  CourseRank,
  { ar: string; en: string; value: (course: CourseAgg) => number }
> = {
  revenue: { ar: "الإيراد", en: "Revenue", value: (course) => course.revenue },
  spend: { ar: "الإنفاق", en: "Spend", value: (course) => course.spend },
  won: { ar: "الصفقات", en: "Won", value: (course) => course.won },
  leads: { ar: "الليدز", en: "Leads", value: (course) => course.crmLeads },
  roas: { ar: "العائد", en: "ROAS", value: (course) => course.roas ?? -1 },
};

function CoursePortfolioNavigator({
  courses,
  totalCourses,
  selectedKey,
  search,
  onSearchChange,
  onSelect,
}: {
  courses: CourseAgg[];
  totalCourses: number;
  selectedKey: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (key: string) => void;
}) {
  const { lang } = useI18n();
  const [rank, setRank] = useState<CourseRank>("revenue");
  const [expanded, setExpanded] = useState(false);
  const ranked = useMemo(
    () =>
      [...courses].sort(
        (a, b) =>
          COURSE_RANKS[rank].value(b) - COURSE_RANKS[rank].value(a) ||
          b.revenue - a.revenue ||
          a.name.localeCompare(b.name),
      ),
    [courses, rank],
  );
  const initial = ranked.slice(0, 9);
  const selected = ranked.find((course) => course.key === selectedKey) ?? null;
  const visible =
    search.trim() || expanded
      ? ranked
      : selected && !initial.some((course) => course.key === selected.key)
        ? [selected, ...initial.slice(0, 8)]
        : initial;
  const peak = Math.max(
    1,
    ...ranked.map((course) => Math.max(0, COURSE_RANKS[rank].value(course))),
  );

  const selectCourse = (key: string) => {
    onSelect(key);
    requestAnimationFrame(() =>
      document
        .getElementById("course-detail")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
      <div
        className="relative overflow-hidden border-b border-border px-4 py-5 sm:px-6"
        style={{
          background:
            "linear-gradient(115deg, color-mix(in oklab, var(--brand) 13%, var(--surface)), var(--surface) 46%, color-mix(in oklab, var(--warning) 7%, var(--surface)))",
        }}
      >
        <div className="absolute -start-12 -top-16 h-44 w-44 rounded-full border-[28px] border-brand/5" />
        <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/20">
                <LayoutGrid size={20} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
                  {lang === "ar" ? "Course command center" : "Course command center"}
                </p>
                <h2 className="text-lg font-bold text-text sm:text-xl">
                  {lang === "ar" ? "اختار الكورس وخُد القرار" : "Choose a course and decide"}
                </h2>
              </div>
            </div>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-text-muted">
              {lang === "ar"
                ? "كل كورس في بطاقة واحدة. افتحه لتشوف فورًا أفضل الإعلانات والكرياتيفات الشغّالة، ثم أداء الحملات والتاريخ."
                : "One card per course. Open it to see live winning creatives first, followed by campaign performance and history."}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface/90 px-3 shadow-sm xl:w-64">
              <Search size={15} className="shrink-0 text-brand" />
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={lang === "ar" ? "ابحث: CFM، PMP، BIM…" : "Search CFM, PMP, BIM…"}
                className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-subtle"
              />
              <span className="num text-[10px] text-text-subtle">{fmtNum(totalCourses)}</span>
            </label>
            <div className="flex overflow-x-auto rounded-xl border border-border bg-surface/90 p-1 shadow-sm">
              {(Object.keys(COURSE_RANKS) as CourseRank[]).map((key) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setRank(key)}
                  aria-pressed={rank === key}
                  className={`min-h-8 shrink-0 rounded-lg px-2.5 text-[10px] font-bold transition-colors ${
                    rank === key
                      ? "bg-brand text-white"
                      : "text-text-muted hover:bg-surface-2 hover:text-text"
                  }`}
                >
                  {COURSE_RANKS[key][lang]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {visible.length ? (
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 sm:p-5">
          {visible.map((course) => {
            const selected = selectedKey === course.key;
            const rankPosition = ranked.findIndex((row) => row.key === course.key) + 1;
            const rankValue = COURSE_RANKS[rank].value(course);
            const progress = Math.max(3, Math.min(100, (Math.max(0, rankValue) / peak) * 100));
            return (
              <button
                type="button"
                key={course.key}
                onClick={() => selectCourse(course.key)}
                aria-pressed={selected}
                className={`group relative overflow-hidden rounded-2xl border p-4 text-start transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                  selected
                    ? "border-brand bg-brand-soft/35 shadow-sm ring-1 ring-brand/15"
                    : "border-border bg-surface hover:border-brand/30"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      className={`num grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[11px] font-bold ${
                        rankPosition === 1
                          ? "bg-amber-400 text-amber-950"
                          : "bg-surface-2 text-text-muted"
                      }`}
                    >
                      {rankPosition}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-bold text-text" title={course.name}>
                        {course.name}
                      </h3>
                      <p
                        className="truncate text-[10px] text-text-muted"
                        title={course.mainCategory}
                      >
                        {course.mainCategory || (lang === "ar" ? "غير مصنف" : "Uncategorised")}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold ${
                      course.spend > 0
                        ? "bg-emerald-500/10 text-emerald-700"
                        : "bg-surface-2 text-text-subtle"
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {course.spend > 0
                      ? lang === "ar"
                        ? "عليه حملات"
                        : "Campaigns"
                      : lang === "ar"
                        ? "بدون صرف"
                        : "No spend"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                  <CourseCardMetric
                    label={lang === "ar" ? "المحصل" : "Revenue"}
                    value={fmtUSD(course.revenue)}
                    strong
                  />
                  <CourseCardMetric
                    label={lang === "ar" ? "الإنفاق" : "Spend"}
                    value={fmtUSD(course.spend)}
                  />
                  <CourseCardMetric
                    label={lang === "ar" ? "Won" : "Won"}
                    value={fmtNum(course.won)}
                  />
                  <CourseCardMetric label="ROAS" value={fmtRoas(course.roas)} />
                </div>

                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-brand transition-[width] duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                  <span className="font-semibold text-text-muted">
                    {COURSE_RANKS[rank][lang]}: {formatCourseRankValue(course, rank)}
                  </span>
                  <span className="inline-flex items-center gap-1 font-bold text-brand">
                    <Sparkles size={10} />
                    {selected
                      ? lang === "ar"
                        ? "مفتوح الآن"
                        : "Open now"
                      : lang === "ar"
                        ? "أفضل الكرياتيفات"
                        : "Best creatives"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="p-5">
          <EmptyState
            label={lang === "ar" ? "مفيش كورس مطابق للبحث" : "No matching course"}
            compact
          />
        </div>
      )}

      {!search.trim() && ranked.length > 9 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-border bg-surface-2/35 px-4 text-xs font-bold text-brand hover:bg-brand-soft/30"
        >
          <BookOpenCheck size={15} />
          {expanded
            ? lang === "ar"
              ? "اعرض أهم 9 كورسات فقط"
              : "Show the top 9 only"
            : lang === "ar"
              ? `اعرض كل الكورسات (${fmtNum(ranked.length)})`
              : `Show all courses (${fmtNum(ranked.length)})`}
        </button>
      )}
    </section>
  );
}

function CourseCardMetric({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] text-text-muted">{label}</div>
      <div
        className={`num mt-0.5 truncate text-sm text-text ${strong ? "font-bold" : "font-semibold"}`}
      >
        {value}
      </div>
    </div>
  );
}

function formatCourseRankValue(course: CourseAgg, rank: CourseRank) {
  if (rank === "revenue") return fmtUSD(course.revenue);
  if (rank === "spend") return fmtUSD(course.spend);
  if (rank === "won") return fmtNum(course.won);
  if (rank === "leads") return fmtNum(course.crmLeads);
  return fmtRoas(course.roas);
}

function CourseLeadMonitor({ report }: { report: CourseLeadAlertReport }) {
  const { lang } = useI18n();
  const [view, setView] = useState<"campaigns" | "alerts" | "all">("campaigns");

  /** Tell Nexus which view is open — the route does not change with the tab. */
  useRegisterNexusView("courses", { tab: view });
  const rows =
    view === "alerts"
      ? report.rows.filter((row) => row.status !== "stable")
      : view === "campaigns"
        ? report.rows.filter((row) => row.hasCurrentCampaignSpend)
        : report.rows;
  const hasAlerts = report.summary.alertCount > 0;

  return (
    <section
      id="daily-lead-monitor"
      className="card scroll-mt-28 overflow-hidden"
      style={{
        borderColor: hasAlerts
          ? report.summary.criticalCount
            ? "color-mix(in oklab, var(--danger) 42%, var(--border))"
            : "color-mix(in oklab, var(--warning) 42%, var(--border))"
          : undefined,
      }}
    >
      <div className="border-b border-border p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
              style={{
                background: hasAlerts ? "var(--warning-soft)" : "var(--success-soft)",
                color: hasAlerts ? "var(--warning)" : "var(--success)",
              }}
            >
              <BellRing size={20} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-text sm:text-lg">
                  {lang === "ar" ? "مراقبة الليدز اليومية لكل دورة" : "Daily leads by course"}
                </h2>
                <Pill
                  tone={
                    !report.freshness.ok
                      ? "neutral"
                      : report.summary.criticalCount
                        ? "danger"
                        : report.summary.warningCount
                          ? "warning"
                          : "success"
                  }
                >
                  {!report.freshness.ok
                    ? lang === "ar"
                      ? "المراقبة متوقفة"
                      : "Monitoring paused"
                    : hasAlerts
                      ? lang === "ar"
                        ? `${fmtNum(report.summary.alertCount)} إنذار`
                        : `${fmtNum(report.summary.alertCount)} alerts`
                      : lang === "ar"
                        ? "الوضع طبيعي"
                        : "Normal"}
                </Pill>
                <Pill tone="neutral">
                  {lang === "ar"
                    ? `${fmtNum(report.summary.courseCount)} دورة بصرف فعلي`
                    : `${fmtNum(report.summary.courseCount)} spending courses`}
                </Pill>
                <Pill tone="neutral">
                  {lang === "ar"
                    ? `الأساس: ${fmtDate(report.comparisonPeriod.from, lang)} — ${fmtDate(report.comparisonPeriod.to, lang)} · ${fmtNum(report.comparisonPeriod.days)} يوم`
                    : `Basis: ${fmtDate(report.comparisonPeriod.from, lang)} — ${fmtDate(report.comparisonPeriod.to, lang)} · ${fmtNum(report.comparisonPeriod.days)} days`}
                </Pill>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-text-muted">
                {lang === "ar"
                  ? `ليدز اليوم تخص آخر يوم مكتمل ${fmtDate(report.anchorDate, lang)}. المتوسط المتوقع = إجمالي ليدز الدورة في الفترة المختارة ÷ ${fmtNum(report.comparisonPeriod.days)} يوم، وهو نفس أساس أرقام الدورات في الصفحة. نعرض افتراضيًا الدورات التي ظهر لها صرف حملات في يوم القياس.`
                  : `Day leads are for the latest complete day, ${fmtDate(report.anchorDate, lang)}. Expected leads = the course's total leads in the selected period ÷ ${fmtNum(report.comparisonPeriod.days)} calendar days, matching the course totals on this page. The default view shows courses with campaign spend on the measured day.`}
              </p>
            </div>
          </div>
          <div
            className="inline-flex w-fit rounded-lg border border-border bg-surface-2 p-0.5"
            role="group"
            aria-label={lang === "ar" ? "عرض مراقبة الليدز" : "Lead monitor view"}
          >
            <button
              type="button"
              onClick={() => setView("campaigns")}
              aria-pressed={view === "campaigns"}
              className={`min-h-8 rounded-md px-3 text-[11px] font-semibold transition-colors ${
                view === "campaigns" ? "bg-surface text-brand shadow-sm" : "text-text-muted"
              }`}
            >
              {lang === "ar" ? "عليها صرف حملات" : "Campaign spend"}
            </button>
            <button
              type="button"
              onClick={() => setView("alerts")}
              aria-pressed={view === "alerts"}
              className={`min-h-8 rounded-md px-3 text-[11px] font-semibold transition-colors ${
                view === "alerts" ? "bg-surface text-brand shadow-sm" : "text-text-muted"
              }`}
            >
              {lang === "ar" ? "الإنذارات فقط" : "Alerts only"}
            </button>
            <button
              type="button"
              onClick={() => setView("all")}
              aria-pressed={view === "all"}
              className={`min-h-8 rounded-md px-3 text-[11px] font-semibold transition-colors ${
                view === "all" ? "bg-surface text-brand shadow-sm" : "text-text-muted"
              }`}
            >
              {lang === "ar" ? "كل الدورات" : "All courses"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MonitorStat
            icon={<TriangleAlert size={15} />}
            label={lang === "ar" ? "دورات محتاجة مراجعة" : "Courses to review"}
            value={report.summary.alertCount}
            tone={hasAlerts ? "danger" : "success"}
          />
          <MonitorStat
            icon={<TrendingDown size={15} />}
            label={lang === "ar" ? "هبوط في الليدز" : "Lead drops"}
            value={report.summary.leadDropCount}
            tone={report.summary.leadDropCount ? "warning" : "neutral"}
          />
          <MonitorStat
            icon={<CircleDollarSign size={15} />}
            label={lang === "ar" ? "ارتفاع في CPL" : "CPL spikes"}
            value={report.summary.cplSpikeCount}
            tone={report.summary.cplSpikeCount ? "warning" : "neutral"}
          />
          <MonitorStat
            icon={<BellRing size={15} />}
            label={lang === "ar" ? "صرف بدون ليدز" : "Spend without leads"}
            value={report.summary.spendWithoutLeadsCount}
            tone={report.summary.spendWithoutLeadsCount ? "danger" : "neutral"}
          />
        </div>
      </div>

      {!report.freshness.ok && (
        <div className="border-b border-border bg-warning-soft px-4 py-3 text-xs leading-5 text-warning sm:px-5">
          {lang === "ar"
            ? report.freshness.message
            : `Alerts are paused because the latest common complete day is ${report.freshness.ageDays} days old.`}
        </div>
      )}

      {rows.length ? (
        <>
          <div className="space-y-2 p-3 md:hidden">
            {rows.map((row) => (
              <CourseLeadMobileCard key={row.key} row={row} paused={!report.freshness.ok} />
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1120px] text-start text-xs">
              <thead className="bg-surface-2/75 text-[10.5px] font-semibold text-text-muted">
                <tr>
                  <th className="px-4 py-3 text-start">{lang === "ar" ? "الدورة" : "Course"}</th>
                  <th className="px-3 py-3 text-center">
                    {lang === "ar" ? "صرف اليوم" : "Day spend"}
                  </th>
                  <th className="px-3 py-3 text-center">
                    {lang === "ar" ? "ليدز اليوم" : "Day leads"}
                  </th>
                  <th className="px-3 py-3 text-center">
                    {lang === "ar" ? "متوسط الفترة" : "Period average"}
                  </th>
                  <th className="px-3 py-3 text-center">{lang === "ar" ? "التغيّر" : "Change"}</th>
                  <th className="px-3 py-3 text-center">CPL</th>
                  <th className="px-3 py-3 text-center">
                    {lang === "ar" ? "CPL الفترة" : "Period CPL"}
                  </th>
                  <th className="px-3 py-3 text-center">
                    {lang === "ar" ? "ليدز الفترة" : "Period leads"}
                  </th>
                  <th className="px-3 py-3 text-center">
                    {lang === "ar" ? "آخر 14 يوم" : "Last 14 days"}
                  </th>
                  <th className="px-4 py-3 text-start">{lang === "ar" ? "الحالة" : "Status"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.key} className="hover:bg-surface-2/35">
                    <td className="px-4 py-3 font-semibold text-text">{row.course}</td>
                    <td className="num px-3 py-3 text-center font-medium text-text">
                      {fmtUSD(row.current.spend)}
                    </td>
                    <td className="num px-3 py-3 text-center font-semibold text-text">
                      {fmtNum(row.current.leads)}
                    </td>
                    <td className="num px-3 py-3 text-center text-text-muted">
                      {row.baseline.leadsPerDay.toFixed(1)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <DeltaBadge value={row.leadDeltaPct ?? undefined} />
                    </td>
                    <td className="num px-3 py-3 text-center font-medium text-text">
                      {fmtUSD(row.current.cpl)}
                    </td>
                    <td className="num px-3 py-3 text-center text-text-muted">
                      {fmtUSD(row.baseline.cpl)}
                    </td>
                    <td className="num px-3 py-3 text-center text-text-muted">
                      {fmtNum(row.baseline.totalLeads)}
                    </td>
                    <td className="px-3 py-3">
                      <MiniLeadTrend row={row} />
                    </td>
                    <td className="px-4 py-3">
                      <CourseSignalStatus row={row} paused={!report.freshness.ok} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="p-5">
          <EmptyState
            compact
            label={
              view === "alerts"
                ? lang === "ar"
                  ? "لا توجد إنذارات حالية"
                  : "No current alerts"
                : view === "campaigns"
                  ? lang === "ar"
                    ? "لا توجد دورات عليها صرف حملات في آخر يوم مكتمل"
                    : "No courses had campaign spend on the latest complete day"
                  : lang === "ar"
                    ? "لا توجد بيانات دورات في نافذة المتابعة"
                    : "No course data in the monitoring window"
            }
          />
        </div>
      )}
    </section>
  );
}

function MonitorStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  const colors = {
    neutral: { background: "var(--surface-2)", color: "var(--text-muted)" },
    success: { background: "var(--success-soft)", color: "var(--success)" },
    warning: { background: "var(--warning-soft)", color: "var(--warning)" },
    danger: { background: "var(--danger-soft)", color: "var(--danger)" },
  }[tone];
  return (
    <div className="rounded-xl border border-border px-3 py-2.5" style={colors}>
      <div className="flex items-center justify-between gap-2 text-[10.5px] font-medium">
        <span>{label}</span>
        {icon}
      </div>
      <div className="num mt-1 text-lg font-semibold">{fmtNum(value)}</div>
    </div>
  );
}

function CourseLeadMobileCard({ row, paused }: { row: CourseLeadSignal; paused: boolean }) {
  const { lang } = useI18n();
  return (
    <article className="rounded-xl border border-border bg-surface-2/35 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text">{row.course}</h3>
          <p className="mt-0.5 text-[10.5px] text-text-muted">
            {lang === "ar" ? "مقارنة بمتوسط الفترة المختارة" : "Compared with period average"}
          </p>
        </div>
        <CourseSignalStatus row={row} paused={paused} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MobileMetric
          label={lang === "ar" ? "صرف الحملات اليوم" : "Campaign spend today"}
          value={fmtUSD(row.current.spend)}
        />
        <MobileMetric
          label={lang === "ar" ? "ليدز اليوم / متوسط الفترة" : "Day / period average"}
          value={`${fmtNum(row.current.leads)} / ${row.baseline.leadsPerDay.toFixed(1)}`}
        />
        <div>
          <dt className="text-[11px] text-text-muted">{lang === "ar" ? "التغيّر" : "Change"}</dt>
          <dd className="mt-0.5">
            <DeltaBadge value={row.leadDeltaPct ?? undefined} />
          </dd>
        </div>
        <MobileMetric label="CPL" value={fmtUSD(row.current.cpl)} />
        <MobileMetric
          label={lang === "ar" ? "CPL الفترة" : "Period CPL"}
          value={fmtUSD(row.baseline.cpl)}
        />
        <MobileMetric
          label={lang === "ar" ? "إجمالي ليدز الفترة" : "Period leads"}
          value={fmtNum(row.baseline.totalLeads)}
        />
      </div>
      <div className="mt-3">
        <MiniLeadTrend row={row} />
      </div>
    </article>
  );
}

function MiniLeadTrend({ row }: { row: CourseLeadSignal }) {
  const { lang } = useI18n();
  const points = row.trend.slice(-14);
  const peak = Math.max(1, ...points.map((point) => point.leads));
  return (
    <div
      className="flex h-8 min-w-[126px] items-end gap-0.5"
      role="img"
      aria-label={
        lang === "ar" ? `ليدز ${row.course} آخر 14 يوم` : `${row.course} leads, last 14 days`
      }
    >
      {points.map((point, index) => (
        <span
          key={point.date}
          className="min-w-1 flex-1 rounded-t-sm"
          title={`${point.date}: ${point.leads}`}
          style={{
            height: `${Math.max(point.leads > 0 ? 12 : 4, (point.leads / peak) * 100)}%`,
            background:
              index === points.length - 1
                ? row.status === "critical"
                  ? "var(--danger)"
                  : row.status === "warning"
                    ? "var(--warning)"
                    : "var(--brand)"
                : "color-mix(in oklab, var(--brand) 38%, var(--border))",
          }}
        />
      ))}
    </div>
  );
}

function CourseSignalStatus({ row, paused = false }: { row: CourseLeadSignal; paused?: boolean }) {
  const { lang } = useI18n();
  if (paused) {
    return (
      <Pill tone="neutral">{lang === "ar" ? "متوقفة لحين التحديث" : "Awaiting fresh data"}</Pill>
    );
  }
  if (!row.hasCurrentCampaignSpend) {
    return <Pill tone="neutral">{lang === "ar" ? "لا يوجد صرف حالي" : "No current spend"}</Pill>;
  }
  if (row.baseline.periodDays < 3) {
    return <Pill tone="neutral">{lang === "ar" ? "عينة غير كافية" : "Limited history"}</Pill>;
  }
  if (row.status === "stable") {
    return <Pill tone="success">{lang === "ar" ? "طبيعي" : "Stable"}</Pill>;
  }
  const labels = row.issues.map((issue) => {
    if (issue === "lead_drop") return lang === "ar" ? "ليدز أقل" : "Lead drop";
    if (issue === "cpl_spike") return lang === "ar" ? "CPL أعلى" : "CPL spike";
    return lang === "ar" ? "صرف بلا ليدز" : "Spend, no leads";
  });
  return (
    <div className="flex max-w-[190px] flex-wrap gap-1">
      {labels.map((label) => (
        <Pill key={label} tone={row.status === "critical" ? "danger" : "warning"}>
          {label}
        </Pill>
      ))}
    </div>
  );
}

function CourseDetailPanel({
  course,
  drill,
  loading,
  error,
  organicScope,
}: {
  course: CourseAgg;
  drill: CourseDrill | null;
  loading: boolean;
  error: Error | null;
  organicScope: boolean;
}) {
  const { lang } = useI18n();
  const months = drill?.monthly ?? [];
  const monthKey = months.map((row) => row.month).join("|");
  const [monthA, setMonthA] = useState("");
  const [monthB, setMonthB] = useState("");

  useEffect(() => {
    const latest = months[months.length - 1]?.month ?? "";
    const previous = months[months.length - 2]?.month ?? latest;
    setMonthA(previous);
    setMonthB(latest);
    // Reset only when the selected course's month population changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.key, monthKey]);

  if (error)
    return (
      <Notice tone="danger" icon={<Info size={17} />}>
        {error.message}
      </Notice>
    );

  if (loading || !drill || drill.course !== course.name) {
    return (
      <section id="course-detail" className="space-y-3">
        <Skeleton className="h-[120px]" />
        <div className="card-grid lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-[260px]" />
          ))}
        </div>
      </section>
    );
  }

  const sourceRows = (
    Object.entries(drill.attribution.spendBySource) as [AttributionSource, number][]
  )
    .filter(([, spend]) => spend > 0)
    .sort((a, b) => b[1] - a[1]);
  const compareA = months.find((row) => row.month === monthA) ?? null;
  const compareB = months.find((row) => row.month === monthB) ?? null;

  return (
    <section id="course-detail" className="space-y-5 scroll-mt-28">
      <div className="card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <GraduationCap size={21} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                {lang === "ar" ? "تفاصيل الدورة المختارة" : "Selected course detail"}
              </p>
              <h2 className="mt-0.5 truncate text-xl font-semibold text-text">{course.name}</h2>
              <p className="mt-1 text-xs text-text-muted">
                {organicScope
                  ? lang === "ar"
                    ? `${drill.previousCampaignCount} حملة أورجانيك مسجلة على Odoo للدورة في الفترة.`
                    : `${drill.previousCampaignCount} Organic campaigns are recorded in Odoo for this course in the period.`
                  : lang === "ar"
                    ? `${drill.activeCampaigns.length} حملة جاهزة للتشغيل حاليًا، و${drill.previousCampaignCount} حملة سابقة في الفترة.`
                    : `${drill.activeCampaigns.length} campaigns are eligible to run now, with ${drill.previousCampaignCount} previous campaigns in the period.`}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <HeaderStat
              label={lang === "ar" ? "إنفاق الفترة" : "Period spend"}
              value={fmtUSD(course.spend)}
            />
            <HeaderStat
              label={lang === "ar" ? "ليدز الفترة" : "Period leads"}
              value={fmtNum(course.crmLeads)}
            />
            <HeaderStat label="Lost" value={fmtNum(course.lost)} />
            <HeaderStat label="Won" value={fmtNum(course.won)} />
            <HeaderStat
              label={lang === "ar" ? "محصل الفترة" : "Period revenue"}
              value={fmtUSD(course.revenue)}
            />
            <HeaderStat label={lang === "ar" ? "ROAS" : "ROAS"} value={fmtRoas(course.roas)} />
          </div>
        </div>

        {!organicScope && (
          <div className="p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <Target size={16} className="text-brand" />
              <h3 className="text-sm font-semibold text-text">
                {lang === "ar"
                  ? "فلوس الإعلانات اتربطت بالدورة منين؟"
                  : "Where did the course spend attribution come from?"}
              </h3>
            </div>
            {sourceRows.length ? (
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {sourceRows.map(([source, spend]) => (
                  <div key={source} className="rounded-xl border border-border bg-surface-2/60 p-3">
                    <div className="text-[11px] text-text-muted">{sourceLabel(source, lang)}</div>
                    <div className="num mt-1 text-base font-semibold text-text">
                      {fmtUSD(spend)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                {lang === "ar"
                  ? "مفيش إنفاق مربوط بالدورة في الفترة المختارة."
                  : "No attributed spend in the selected period."}
              </p>
            )}
          </div>
        )}
      </div>

      {!organicScope && <CourseCreativeGallery courseName={course.name} />}

      {!organicScope && (
        <div>
          <SectionHeading
            icon={<Activity size={18} />}
            title={
              lang === "ar" ? "الحملات الجاهزة للتشغيل دلوقتي" : "Campaigns eligible to run now"
            }
            hint={
              lang === "ar"
                ? "الحملة لازم تكون مفعّلة، جدولها مفتوح، وجواها إعلان شغّال. الصرف ظاهر للمعلومة فقط ومش هو اللي بيقرر الحالة."
                : "A campaign must be enabled, currently scheduled, and contain a live ad. Spend is context only and never decides status."
            }
            count={drill.activeCampaigns.length}
          />
          {drill.activeCampaigns.length ? (
            <div className="card-grid lg:grid-cols-2 xl:grid-cols-3">
              {drill.activeCampaigns.map((campaign) => (
                <CampaignCard key={campaign.key} campaign={campaign} active />
              ))}
            </div>
          ) : (
            <div className="card">
              <EmptyState
                label={
                  lang === "ar"
                    ? "مفيش حملة للدورة جاهزة للتشغيل حاليًا"
                    : "No course campaign is currently eligible to run"
                }
                compact
              />
            </div>
          )}
        </div>
      )}

      <div>
        <SectionHeading
          icon={organicScope ? <Leaf size={18} /> : <History size={18} />}
          title={
            organicScope
              ? lang === "ar"
                ? "حملات الأورجانيك المسجلة للدورة"
                : "Recorded Organic campaigns for the course"
              : lang === "ar"
                ? "الحملات السابقة للدورة"
                : "Previous course campaigns"
          }
          hint={
            organicScope
              ? lang === "ar"
                ? "الأسماء والمصادر جاية من Campaign وSource في Odoo؛ لا يتم خلطها بحملات منصات الإعلانات الشغالة."
                : "Names and sources come from Odoo Campaign and Source; active paid-media campaigns are kept out of this list."
              : lang === "ar"
                ? "حملات ظهرت وصرفت في الفترة المختارة، لكنها مش جاهزة للتشغيل حاليًا."
                : "Campaigns with spend in the selected period that aren't eligible to run now."
          }
          count={drill.previousCampaignCount}
        />
        {drill.previousCampaigns.length ? (
          <div className="card-grid lg:grid-cols-2 xl:grid-cols-3">
            {drill.previousCampaigns.map((campaign) => (
              <CampaignCard
                key={campaign.key}
                campaign={campaign}
                active={false}
                organic={organicScope}
              />
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState
              label={
                organicScope
                  ? lang === "ar"
                    ? "مفيش أسماء حملات أورجانيك مسجلة للدورة في الفترة"
                    : "No Organic campaign names are recorded for this course in the period"
                  : lang === "ar"
                    ? "مفيش حملات سابقة في الفترة"
                    : "No previous campaigns in this period"
              }
              compact
            />
          </div>
        )}
      </div>

      <div className="card p-4 sm:p-5">
        <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-brand" />
              <h3 className="text-base font-semibold text-text">
                {lang === "ar"
                  ? `مقارنة شهرين لنفس دورة ${course.name}`
                  : `Two-month comparison for ${course.name}`}
              </h3>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {lang === "ar"
                ? "اختار أي شهرين، وكل الأرقام تفضل خاصة بنفس الدورة."
                : "Choose any two months; every metric stays scoped to this course."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MonthSelect
              label={lang === "ar" ? "الشهر الأول" : "First month"}
              value={monthA}
              months={months}
              onChange={setMonthA}
            />
            <MonthSelect
              label={lang === "ar" ? "الشهر الثاني" : "Second month"}
              value={monthB}
              months={months}
              onChange={setMonthB}
            />
          </div>
        </div>

        {compareA && compareB ? (
          <div className="mt-4 card-grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <MonthMetricCard
              label={lang === "ar" ? "الإنفاق" : "Spend"}
              first={compareA.spend}
              second={compareB.spend}
              firstLabel={formatMonth(monthA, lang)}
              secondLabel={formatMonth(monthB, lang)}
              format={fmtUSD}
              invert
            />
            <MonthMetricCard
              label={lang === "ar" ? "ليدز CRM" : "CRM leads"}
              first={compareA.leads}
              second={compareB.leads}
              firstLabel={formatMonth(monthA, lang)}
              secondLabel={formatMonth(monthB, lang)}
              format={fmtNum}
            />
            <MonthMetricCard
              label="Lost"
              first={compareA.lost}
              second={compareB.lost}
              firstLabel={formatMonth(monthA, lang)}
              secondLabel={formatMonth(monthB, lang)}
              format={fmtNum}
              invert
            />
            <MonthMetricCard
              label="Won"
              first={compareA.won}
              second={compareB.won}
              firstLabel={formatMonth(monthA, lang)}
              secondLabel={formatMonth(monthB, lang)}
              format={fmtNum}
            />
            <MonthMetricCard
              label={lang === "ar" ? "أوامر البيع" : "Sales orders"}
              first={compareA.salesOrders}
              second={compareB.salesOrders}
              firstLabel={formatMonth(monthA, lang)}
              secondLabel={formatMonth(monthB, lang)}
              format={fmtNum}
            />
            <MonthMetricCard
              label={lang === "ar" ? "الفواتير" : "Paid invoices"}
              first={compareA.invoices}
              second={compareB.invoices}
              firstLabel={formatMonth(monthA, lang)}
              secondLabel={formatMonth(monthB, lang)}
              format={fmtNum}
            />
            <MonthMetricCard
              label={lang === "ar" ? "المحصل" : "Revenue"}
              first={compareA.revenue}
              second={compareB.revenue}
              firstLabel={formatMonth(monthA, lang)}
              secondLabel={formatMonth(monthB, lang)}
              format={fmtUSD}
            />
            <MonthMetricCard
              label="ROAS"
              first={compareA.roas}
              second={compareB.roas}
              firstLabel={formatMonth(monthA, lang)}
              secondLabel={formatMonth(monthB, lang)}
              format={fmtRoas}
            />
          </div>
        ) : (
          <EmptyState
            label={
              lang === "ar"
                ? "مفيش شهرين متاحين للمقارنة في الفترة"
                : "Two months are not available for comparison"
            }
            compact
          />
        )}
      </div>
    </section>
  );
}

function CampaignCard({
  campaign,
  active,
  organic = false,
}: {
  campaign: CourseCampaign;
  active: boolean;
  organic?: boolean;
}) {
  const { lang } = useI18n();
  const sourceText = campaign.attributionSources
    .map((source) => sourceLabel(source, lang))
    .join("، ");
  return (
    <article className="card flex min-h-[260px] flex-col overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {organic ? (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: "var(--success-soft)", color: "var(--success)" }}
              >
                <Leaf size={11} />
                {lang === "ar" ? "أورجانيك · Odoo" : "Organic · Odoo"}
              </span>
            ) : (
              campaign.platforms.map((platform) => (
                <span
                  key={platform}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: `color-mix(in oklab, ${PLATFORM_COLOR[platform]} 14%, transparent)`,
                    color: PLATFORM_COLOR[platform],
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: PLATFORM_COLOR[platform] }}
                  />
                  {PLATFORM_LABEL[platform][lang]}
                </span>
              ))
            )}
          </div>
          <h4
            className="line-clamp-2 text-sm font-semibold leading-5 text-text"
            title={campaign.name}
          >
            {campaign.name}
          </h4>
        </div>
        <Pill tone={active || organic ? "success" : "neutral"}>
          {organic
            ? lang === "ar"
              ? "من Odoo"
              : "From Odoo"
            : active
              ? lang === "ar"
                ? "شغالة"
                : "Active"
              : lang === "ar"
                ? "سابقة"
                : "Previous"}
        </Pill>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-text-muted">
        {organic ? (
          <>
            <Leaf size={14} className="shrink-0" style={{ color: "var(--success)" }} />
            <span>{lang === "ar" ? "مصادر Odoo:" : "Odoo sources:"}</span>
            <strong
              className="truncate font-semibold text-text"
              title={campaign.sources.join("، ")}
            >
              {campaign.sources.join("، ") || "—"}
            </strong>
          </>
        ) : (
          <>
            <Target size={14} className="shrink-0 text-brand" />
            <span>{lang === "ar" ? "هدفها:" : "Objective:"}</span>
            <strong className="font-semibold text-text">
              {objectiveLabel(campaign.objective, lang)}
            </strong>
          </>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        {!organic && (
          <>
            <MobileMetric
              label={
                active
                  ? lang === "ar"
                    ? "صرف آخر 24 ساعة (للمعلومة)"
                    : "Last 24h spend (context)"
                  : lang === "ar"
                    ? "آخر يوم صرف"
                    : "Last spend day"
              }
              value={
                active ? fmtUSD(campaign.statusSpend24h) : fmtDate(campaign.spendDateMax, lang)
              }
            />
            <MobileMetric
              label={lang === "ar" ? "إنفاق الفترة" : "Period spend"}
              value={fmtUSD(campaign.spend)}
            />
          </>
        )}
        <MobileMetric
          label={lang === "ar" ? "ليدز CRM في الفترة" : "Period CRM leads"}
          value={fmtNum(campaign.crmLeads)}
        />
        <MobileMetric label="Lost" value={fmtNum(campaign.lost)} />
        <MobileMetric label="Won" value={fmtNum(campaign.won)} />
        <MobileMetric
          label={lang === "ar" ? "أوامر / فواتير" : "Orders / invoices"}
          value={`${fmtNum(campaign.salesOrders)} / ${fmtNum(campaign.invoices)}`}
        />
        <MobileMetric
          label={lang === "ar" ? "المحصل" : "Revenue"}
          value={fmtUSD(campaign.revenue)}
        />
        {!organic && <MobileMetric label="ROAS" value={fmtRoas(campaign.roas)} />}
      </dl>

      <div className="mt-auto border-t border-border pt-3 text-[11px] leading-5 text-text-muted">
        {organic ? (
          <div>
            {lang === "ar" ? "نوع التجميع: " : "Grouping basis: "}
            <span className="font-medium text-text">
              {lang === "ar" ? "اسم Campaign داخل Odoo" : "Campaign name in Odoo"}
            </span>
          </div>
        ) : (
          <>
            {campaign.accounts.length > 0 && (
              <div className="truncate" title={campaign.accounts.join("، ")}>
                {lang === "ar" ? "الحساب: " : "Account: "}
                <span className="font-medium text-text">{campaign.accounts.join("، ")}</span>
              </div>
            )}
            <div>
              {lang === "ar" ? "ربط الدورة: " : "Course match: "}
              <span className="font-medium text-text">{sourceText || "—"}</span>
              {campaign.attributionConfidence < 0.999 && (
                <span>
                  {" "}
                  · {lang === "ar" ? "ثقة" : "confidence"}{" "}
                  {fmtPct(campaign.attributionConfidence * 100, 0)}
                </span>
              )}
            </div>
            <div>
              {lang === "ar" ? "فترة الإنفاق: " : "Spend window: "}
              <span className="num">
                {fmtDate(campaign.spendDateMin, lang)} — {fmtDate(campaign.spendDateMax, lang)}
              </span>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function SectionHeading({
  icon,
  title,
  hint,
  count,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  count: number;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-brand">{icon}</span>
        <div>
          <h3 className="text-base font-semibold text-text">{title}</h3>
          <p className="mt-0.5 max-w-3xl text-xs leading-5 text-text-muted">{hint}</p>
        </div>
      </div>
      <Pill tone={count ? "brand" : "neutral"}>{fmtNum(count)}</Pill>
    </div>
  );
}

function MonthSelect({
  label,
  value,
  months,
  onChange,
}: {
  label: string;
  value: string;
  months: CourseMonth[];
  onChange: (value: string) => void;
}) {
  const { lang } = useI18n();
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-medium text-text-muted">{label}</span>
      <span className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-surface px-2.5">
        <CalendarDays size={14} className="shrink-0 text-text-subtle" />
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 bg-transparent py-2 text-xs font-medium text-text outline-none"
        >
          {months.map((row) => (
            <option key={row.month} value={row.month}>
              {formatMonth(row.month, lang)}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

function MonthMetricCard({
  label,
  first,
  second,
  firstLabel,
  secondLabel,
  format,
  invert = false,
}: {
  label: string;
  first: number | null;
  second: number | null;
  firstLabel: string;
  secondLabel: string;
  format: (value: number | null) => string;
  invert?: boolean;
}) {
  const delta =
    first !== null && second !== null && first > 0 ? ((second - first) / first) * 100 : undefined;
  return (
    <div className="rounded-xl border border-border bg-surface-2/45 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium text-text-muted">{label}</span>
        <DeltaBadge value={delta} invert={invert} />
      </div>
      <div className="mt-2 text-[10px] text-text-subtle">{secondLabel}</div>
      <div className="num text-base font-semibold text-text">{format(second)}</div>
      <div className="mt-2 border-t border-border pt-2 text-[10px] text-text-subtle">
        {firstLabel}: <span className="num font-medium text-text-muted">{format(first)}</span>
      </div>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[100px] rounded-xl border border-border bg-surface-2/60 px-3 py-2.5">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className="num mt-1 text-sm font-semibold text-text">{value}</div>
    </div>
  );
}

function MobileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-text-muted">{label}</dt>
      <dd className="num mt-0.5 text-sm font-semibold text-text">{value}</dd>
    </div>
  );
}

function objectiveLabel(objective: CampaignObjective, lang: "ar" | "en") {
  if (objective === "leads") return lang === "ar" ? "جمع ليدز" : "Lead generation";
  if (objective === "website_conversion")
    return lang === "ar" ? "تحويلات الموقع" : "Website conversions";
  if (objective === "traffic") return lang === "ar" ? "زيارات وترافيك" : "Traffic";
  return lang === "ar" ? "الهدف غير متاح" : "Objective unavailable";
}

function sourceLabel(source: AttributionSource, lang: "ar" | "en") {
  const labels: Record<AttributionSource, { ar: string; en: string }> = {
    source_mapping: { ar: "تصنيف المصدر التاريخي", en: "Historical source mapping" },
    campaign_name: { ar: "اسم الحملة", en: "Campaign name" },
    crm_leads: { ar: "الدورة الغالبة في ليدز الحملة", en: "Dominant CRM lead course" },
  };
  return labels[source][lang];
}

function formatMonth(month: string, lang: "ar" | "en") {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
