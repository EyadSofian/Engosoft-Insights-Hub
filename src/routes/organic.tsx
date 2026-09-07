import { createFileRoute } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import {
  BadgeDollarSign,
  BookOpenCheck,
  Crown,
  HandCoins,
  Leaf,
  MessageCircleMore,
  ReceiptText,
  Sprout,
  Target,
  Trophy,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { FilterSummary } from "@/components/ads/FilterSummary";
import { HBarChart, MultiLineChart } from "@/components/charts";
import { DataTable, type Col } from "@/components/DataTable";
import { Card, ErrorState, Pill, SectionTitle, Skeleton } from "@/components/ui-bits";
import { InsightRow, KpiRow } from "@/components/dashboard-bits";
import { InsightDetailTrigger, MetricDetailTrigger } from "@/components/metric-detail";
import { topRows, type MetricDetail } from "@/lib/metric-detail";
import { DashboardPageHeader } from "@/components/dashboard-bits";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { setAcquisitionFilter, useFilters } from "@/lib/filter-store";
import { fmtCompact, fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { hasReportableLost } from "@/lib/lost-authority";
import type { CourseAgg, DataHealth, Maybe, TeamAgg, Totals } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

export const Route = createFileRoute("/organic")({ component: Organic });

interface OrganicBreakdown {
  key: string;
  name: string;
  leads: number;
  won: number;
  lost: number;
  open: number;
  conversionRate: Maybe;
  lostRate: Maybe;
  revenue: number;
  invoices: number;
  salesOrders: number;
  revenuePerLead: Maybe;
  leadShare: number;
  revenueShare: number;
}

interface OrganicCampaign {
  key: string;
  name: string;
  sources: string[];
  courses: string[];
  leads: number;
  won: number;
  lost: number;
  open: number;
  conversionRate: Maybe;
  revenue: number;
  invoices: number;
  salesOrders: number;
  revenuePerLead: Maybe;
}

interface OrganicMonth {
  month: string;
  leads: number;
  won: number;
  lost: number;
  conversionRate: Maybe;
  revenue: number;
  invoices: number;
  salesOrders: number;
}

interface OrganicResponse {
  totals: Totals;
  sources: OrganicBreakdown[];
  courses: CourseAgg[];
  campaigns: OrganicCampaign[];
  monthly: OrganicMonth[];
  teams: TeamAgg[];
  people: TeamAgg[];
  insights: {
    topLeadSource: OrganicBreakdown | null;
    topRevenueSource: OrganicBreakdown | null;
    topRevenueCourse: CourseAgg | null;
    bestConversionCourse: CourseAgg | null;
    topTeam: TeamAgg | null;
    topSalesperson: TeamAgg | null;
  };
  counts: {
    sources: number;
    courses: number;
    campaigns: number;
    teams: number;
    people: number;
  };
  health: DataHealth;
}

/**
 * The six findings, and the ranking each one came out of.
 *
 * A "key finding" is the app naming a winner. Naming one without showing the
 * table it was picked from asks the reader to trust a sort they cannot see, so
 * each of these carries that table — the top five of the very list the winner
 * leads — plus the counts behind its own headline figure.
 */
function organicInsights(
  data: OrganicResponse,
  lostAvailable: boolean,
  lang: "ar" | "en",
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const insight = data.insights;
  const report: MetricDetail["report"] = {
    to: "/leads",
    label: A ? "فتح تقرير العملاء المحتملين" : "Open the leads report",
  };

  const sourceRows = (pick: (row: OrganicBreakdown) => number, format: (n: number) => string) =>
    topRows(
      data.sources.map((row) => ({
        key: row.key,
        label: row.name,
        value: pick(row),
        display: format(pick(row)),
        meta: `${fmtNum(row.leads)} ${A ? "ليد" : "leads"}`,
        tone: "cyan" as const,
      })),
    );

  return {
    topLeadSource: {
      id: "organic.topLeadSource",
      title: A ? "أكبر مصدر حجمًا" : "Source with the most volume",
      value: insight.topLeadSource?.name ?? "—",
      tone: "violet",
      icon: <MessageCircleMore size={16} />,
      entity: insight.topLeadSource
        ? { type: "source", id: insight.topLeadSource.key, name: insight.topLeadSource.name }
        : null,
      definition: A
        ? "المصدر غير المدفوع الذي جاء منه أكبر عدد عملاء محتملين في الفترة. الترتيب بعدد الليدز وحده."
        : "The non-paid source that produced the most leads in the period. Ranked by lead count alone.",
      caveat: A
        ? "الحجم ليس جودة: راجع نسبة الإغلاق والإيراد في نفس الصف قبل نقل مجهود إليه."
        : "Volume is not quality: read the conversion and revenue on the same row before shifting effort onto it.",
      supporting: insight.topLeadSource
        ? [
            {
              key: "leads",
              label: A ? "الليدز" : "Leads",
              value: fmtNum(insight.topLeadSource.leads),
            },
            {
              key: "share",
              label: A ? "حصته من الليدز" : "Share of leads",
              value: fmtPct(insight.topLeadSource.leadShare, 1),
            },
            { key: "won", label: A ? "الصفقات" : "Won", value: fmtNum(insight.topLeadSource.won) },
            {
              key: "revenue",
              label: A ? "الإيراد" : "Revenue",
              value: fmtUSD(insight.topLeadSource.revenue),
            },
          ]
        : undefined,
      breakdowns: [
        {
          id: "sources",
          title: A ? "الليدز حسب المصدر" : "Leads by source",
          hint: A
            ? "هذا هو الترتيب الذي اختار المصدر أعلاه."
            : "The ranking that named the source above.",
          rows: sourceRows((row) => row.leads, fmtNum),
          emptyLabel: A ? "لا توجد مصادر في الفترة" : "No sources in this period",
        },
      ],
      report,
    },

    topRevenueSource: {
      id: "organic.topRevenueSource",
      title: A ? "أعلى مصدر إيرادًا" : "Top revenue source",
      value: insight.topRevenueSource?.name ?? "—",
      tone: "mint",
      icon: <HandCoins size={16} />,
      entity: insight.topRevenueSource
        ? { type: "source", id: insight.topRevenueSource.key, name: insight.topRevenueSource.name }
        : null,
      definition: A
        ? "المصدر غير المدفوع الذي جاء منه أكبر تحصيل في الفترة، محسوبًا من الفواتير المدفوعة."
        : "The non-paid source that collected the most in the period, counted from paid invoices.",
      supporting: insight.topRevenueSource
        ? [
            {
              key: "revenue",
              label: A ? "الإيراد" : "Revenue",
              value: fmtUSD(insight.topRevenueSource.revenue),
            },
            {
              key: "invoices",
              label: A ? "الفواتير المدفوعة" : "Paid invoices",
              value: fmtNum(insight.topRevenueSource.invoices),
            },
            {
              key: "share",
              label: A ? "حصته من الإيراد" : "Share of revenue",
              value: fmtPct(insight.topRevenueSource.revenueShare, 1),
            },
            {
              key: "perLead",
              label: A ? "إيراد لكل ليد" : "Revenue per lead",
              value: fmtUSDFull(insight.topRevenueSource.revenuePerLead),
            },
          ]
        : undefined,
      breakdowns: [
        {
          id: "sources",
          title: A ? "الإيراد حسب المصدر" : "Revenue by source",
          rows: sourceRows((row) => row.revenue, fmtUSD),
          emptyLabel: A ? "لا يوجد إيراد في الفترة" : "No revenue in this period",
        },
      ],
      report: {
        to: "/accounting",
        label: A ? "فتح التقرير المحاسبي" : "Open the accounting report",
      },
    },

    topRevenueCourse: {
      id: "organic.topRevenueCourse",
      title: A ? "أفضل دورة مبيعًا" : "Best-selling course",
      value: insight.topRevenueCourse?.name ?? "—",
      tone: "mint",
      icon: <Trophy size={16} />,
      entity: insight.topRevenueCourse
        ? { type: "course", id: insight.topRevenueCourse.key, name: insight.topRevenueCourse.name }
        : null,
      definition: A
        ? "الدورة التي حققت أكبر تحصيل من مصادر غير مدفوعة في الفترة."
        : "The course that collected the most from non-paid sources in the period.",
      supporting: insight.topRevenueCourse
        ? [
            {
              key: "revenue",
              label: A ? "الإيراد" : "Revenue",
              value: fmtUSD(insight.topRevenueCourse.revenue),
            },
            {
              key: "invoices",
              label: A ? "الفواتير" : "Invoices",
              value: fmtNum(insight.topRevenueCourse.invoices),
            },
            {
              key: "leads",
              label: A ? "الليدز" : "Leads",
              value: fmtNum(insight.topRevenueCourse.crmLeads),
            },
            {
              key: "avgOrder",
              label: A ? "متوسط الطلب" : "Average order",
              value: fmtUSDFull(insight.topRevenueCourse.avgOrder),
            },
          ]
        : undefined,
      breakdowns: [
        {
          id: "courses",
          title: A ? "الإيراد حسب الدورة" : "Revenue by course",
          rows: topRows(
            data.courses.map((row) => ({
              key: row.key,
              label: row.name,
              value: row.revenue,
              display: fmtUSD(row.revenue),
              meta: `${fmtNum(row.invoices)} ${A ? "فاتورة" : "invoices"}`,
              tone: "mint" as const,
            })),
          ),
          moreTo: "/courses",
          moreLabel: A ? "فتح تقرير الدورات" : "Open the courses report",
          emptyLabel: A ? "لا توجد دورات في الفترة" : "No courses in this period",
        },
      ],
      report: { to: "/courses", label: A ? "فتح تقرير الدورات" : "Open the courses report" },
    },

    bestConversionCourse: {
      id: "organic.bestConversionCourse",
      title: A ? "أقوى دورة تحويلًا" : "Best-converting course",
      value: lostAvailable ? (insight.bestConversionCourse?.name ?? "—") : "—",
      tone: "sky",
      icon: <BookOpenCheck size={16} />,
      entity: insight.bestConversionCourse
        ? {
            type: "course",
            id: insight.bestConversionCourse.key,
            name: insight.bestConversionCourse.name,
          }
        : null,
      definition: A
        ? "الدورة التي أغلقت أعلى نسبة من عملائها المحتملين، بين الدورات التي لديها 20 ليدًا على الأقل."
        : "The course that closed the highest share of its leads, among courses with at least 20 leads.",
      caveat: lostAvailable
        ? undefined
        : A
          ? "هذه القراءة تحتاج مصدر الفرص المؤرشفة، وهو غير متاح الآن — فلا يُعرض ترتيب لا تدعمه البيانات."
          : "This reading needs the archived-opportunity source, which is currently unavailable, so no ranking is shown that the data cannot support.",
      supporting:
        lostAvailable && insight.bestConversionCourse
          ? [
              {
                key: "rate",
                label: A ? "نسبة الإغلاق" : "Conversion",
                value: fmtPct(insight.bestConversionCourse.conversionRate),
              },
              {
                key: "won",
                label: A ? "البسط · Won" : "Numerator · won",
                value: fmtNum(insight.bestConversionCourse.won),
              },
              {
                key: "leads",
                label: A ? "المقام · الليدز" : "Denominator · leads",
                value: fmtNum(insight.bestConversionCourse.crmLeads),
              },
              {
                key: "revenue",
                label: A ? "الإيراد" : "Revenue",
                value: fmtUSD(insight.bestConversionCourse.revenue),
              },
            ]
          : undefined,
      breakdowns: lostAvailable
        ? [
            {
              id: "conversion",
              title: A ? "نسبة الإغلاق حسب الدورة" : "Conversion by course",
              hint: A
                ? "الدورات التي لديها 20 ليدًا فأكثر فقط."
                : "Only courses with 20 leads or more.",
              rows: topRows(
                data.courses
                  .filter((row) => row.crmLeads >= 20)
                  .map((row) => ({
                    key: row.key,
                    label: row.name,
                    value: row.conversionRate ?? 0,
                    display: fmtPct(row.conversionRate),
                    meta: `${fmtNum(row.won)}/${fmtNum(row.crmLeads)}`,
                    tone: "sky" as const,
                  })),
              ),
              emptyLabel: A
                ? "لا توجد دورة بلغت 20 ليدًا في الفترة"
                : "No course reached 20 leads in this period",
            },
          ]
        : undefined,
      report: { to: "/courses", label: A ? "فتح تقرير الدورات" : "Open the courses report" },
    },

    topSalesperson: {
      id: "organic.topSalesperson",
      title: A ? "أفضل موظف بالإيراد" : "Top salesperson by revenue",
      value: insight.topSalesperson?.displayName ?? insight.topSalesperson?.name ?? "—",
      tone: "violet",
      icon: <UserRoundCheck size={16} />,
      entity: insight.topSalesperson
        ? {
            type: "salesperson",
            id: insight.topSalesperson.key,
            name: insight.topSalesperson.name,
          }
        : null,
      definition: A
        ? "الموظف الذي حقق أكبر تحصيل من عملاء غير مدفوعين في الفترة."
        : "The salesperson who collected the most from non-paid leads in the period.",
      supporting: insight.topSalesperson
        ? [
            {
              key: "revenue",
              label: A ? "الإيراد" : "Revenue",
              value: fmtUSD(insight.topSalesperson.revenue),
            },
            { key: "won", label: A ? "الصفقات" : "Won", value: fmtNum(insight.topSalesperson.won) },
            {
              key: "leads",
              label: A ? "الليدز" : "Leads",
              value: fmtNum(insight.topSalesperson.crmLeads),
            },
            {
              key: "team",
              label: A ? "الفريق" : "Team",
              value: insight.topSalesperson.parent ?? "—",
            },
          ]
        : undefined,
      breakdowns: [
        {
          id: "people",
          title: A ? "الإيراد حسب الموظف" : "Revenue by salesperson",
          rows: topRows(
            data.people.map((row) => ({
              key: row.key,
              label: row.displayName ?? row.name,
              value: row.revenue,
              display: fmtUSD(row.revenue),
              meta: `${fmtNum(row.won)}/${fmtNum(row.crmLeads)}`,
              tone: "violet" as const,
            })),
          ),
          moreTo: "/teams",
          moreLabel: A ? "فتح تقرير الفرق" : "Open the teams report",
          emptyLabel: A ? "لا يوجد موظف بإيراد في الفترة" : "Nobody collected in this period",
        },
      ],
      report: { to: "/teams", label: A ? "فتح تقرير الفرق" : "Open the teams report" },
    },

    topTeam: {
      id: "organic.topTeam",
      title: A ? "أفضل فريق" : "Top team",
      value: insight.topTeam?.name ?? "—",
      tone: "sky",
      icon: <UsersRound size={16} />,
      entity: insight.topTeam
        ? { type: "team", id: insight.topTeam.key, name: insight.topTeam.name }
        : null,
      definition: A
        ? "الفريق الذي حقق أكبر تحصيل من عملاء غير مدفوعين في الفترة."
        : "The team that collected the most from non-paid leads in the period.",
      supporting: insight.topTeam
        ? [
            {
              key: "revenue",
              label: A ? "الإيراد" : "Revenue",
              value: fmtUSD(insight.topTeam.revenue),
            },
            { key: "won", label: A ? "الصفقات" : "Won", value: fmtNum(insight.topTeam.won) },
            {
              key: "leads",
              label: A ? "الليدز" : "Leads",
              value: fmtNum(insight.topTeam.crmLeads),
            },
            {
              key: "conversion",
              label: A ? "نسبة الإغلاق" : "Conversion",
              value: fmtPct(insight.topTeam.conversionRate),
            },
          ]
        : undefined,
      breakdowns: [
        {
          id: "teams",
          title: A ? "الإيراد حسب الفريق" : "Revenue by team",
          rows: topRows(
            data.teams.map((row) => ({
              key: row.key,
              label: row.name,
              value: row.revenue,
              display: fmtUSD(row.revenue),
              meta: `${fmtNum(row.won)}/${fmtNum(row.crmLeads)}`,
              tone: "sky" as const,
            })),
          ),
          moreTo: "/teams",
          moreLabel: A ? "فتح تقرير الفرق" : "Open the teams report",
          emptyLabel: A ? "لا يوجد فريق بإيراد في الفترة" : "No team collected in this period",
        },
      ],
      report: { to: "/teams", label: A ? "فتح تقرير الفرق" : "Open the teams report" },
    },
  };
}

/**
 * The four organic money figures, and what each is made of.
 *
 * Organic is the one surface where spend is not part of the story: nothing here
 * cost media money, so every explanation is about where the revenue came from
 * rather than what it cost to get.
 */
function organicMetrics(data: OrganicResponse, lang: "ar" | "en"): Record<string, MetricDetail> {
  const A = lang === "ar";
  const T = data.totals;
  const bySource = (pick: (row: OrganicBreakdown) => number, format: (n: number) => string) =>
    topRows(
      data.sources.map((row) => ({
        key: row.key,
        label: row.name,
        value: pick(row),
        display: format(pick(row)),
        meta: `${fmtNum(row.leads)} ${A ? "ليد" : "leads"}`,
        tone: "cyan" as const,
      })),
    );
  const byCourse = (pick: (row: CourseAgg) => number, format: (n: number) => string) =>
    topRows(
      data.courses.map((row) => ({
        key: row.key,
        label: row.name,
        value: pick(row),
        display: format(pick(row)),
        meta: `${fmtNum(row.crmLeads)} ${A ? "ليد" : "leads"}`,
        tone: "amber" as const,
      })),
    );

  return {
    invoices: {
      id: "organic.revenue",
      title: A ? "الفواتير المدفوعة" : "Paid invoices",
      value: fmtNum(T.orders),
      tone: "mint",
      icon: <ReceiptText size={16} />,
      definition: A
        ? "عدد الحركات المحاسبية المدفوعة المرتبطة بعملاء جاءوا من مصادر غير مدفوعة داخل الفترة."
        : "Distinct paid accounting moves tied to leads that arrived from non-paid sources inside the period.",
      formula: A
        ? `${fmtNum(T.orders)} فاتورة بقيمة ${fmtUSD(T.revenue)}، بمتوسط ${fmtUSD(T.avgOrder)} للفاتورة.`
        : `${fmtNum(T.orders)} invoices worth ${fmtUSD(T.revenue)}, averaging ${fmtUSD(T.avgOrder)} each.`,
      supporting: [
        { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSD(T.revenue) },
        { key: "avg", label: A ? "متوسط الفاتورة" : "Average invoice", value: fmtUSD(T.avgOrder) },
        { key: "leads", label: A ? "العملاء" : "Leads", value: fmtNum(T.totalLeads) },
        { key: "won", label: A ? "صفقات رابحة" : "Won", value: fmtNum(T.won) },
      ],
      breakdowns: [
        {
          id: "sources",
          title: A ? "أعلى المصادر إيرادًا" : "Sources with the most revenue",
          rows: bySource((row) => row.revenue, fmtUSD),
          emptyLabel: A ? "لا يوجد مصدر بإيراد" : "No source carries revenue",
        },
        {
          id: "courses",
          title: A ? "أعلى الدورات إيرادًا" : "Courses with the most revenue",
          rows: byCourse((row) => row.revenue, fmtUSD),
          emptyLabel: A ? "لا توجد دورة بإيراد" : "No course carries revenue",
        },
      ],
      report: { to: "/accounting", label: A ? "فتح تقرير الحسابات" : "Open the Accounting report" },
    },
    average: {
      id: "organic.average",
      title: A ? "متوسط الفاتورة" : "Average invoice",
      value: fmtUSD(T.avgOrder),
      tone: "amber",
      icon: <HandCoins size={16} />,
      definition: A
        ? "متوسط قيمة الفاتورة المدفوعة من العملاء الأورجانيك في الفترة."
        : "The average value of a paid invoice from organic leads in the period.",
      formula: `${fmtUSD(T.revenue)} ÷ ${fmtNum(T.orders)} = ${fmtUSD(T.avgOrder)}`,
      supporting: [
        {
          key: "revenue",
          label: A ? "البسط · الإيراد" : "Numerator · revenue",
          value: fmtUSD(T.revenue),
        },
        {
          key: "invoices",
          label: A ? "المقام · الفواتير" : "Denominator · invoices",
          value: fmtNum(T.orders),
        },
        {
          key: "perLead",
          label: A ? "الإيراد لكل ليد" : "Revenue per lead",
          value: fmtUSD(T.revenuePerLead),
        },
        { key: "won", label: A ? "صفقات رابحة" : "Won", value: fmtNum(T.won) },
      ],
      breakdowns: [
        {
          id: "courses",
          title: A ? "أعلى الدورات إيرادًا" : "Courses with the most revenue",
          rows: byCourse((row) => row.revenue, fmtUSD),
          emptyLabel: A ? "لا توجد دورة بإيراد" : "No course carries revenue",
        },
      ],
    },
    perLead: {
      id: "organic.perLead",
      title: A ? "الإيراد لكل ليد" : "Revenue per lead",
      value: fmtUSD(T.revenuePerLead),
      tone: "mint",
      icon: <BadgeDollarSign size={16} />,
      definition: A
        ? "قيمة الليد الأورجانيك: الإيراد المحصّل مقسومًا على كل العملاء الذين جاءوا من مصادر غير مدفوعة."
        : "What an organic lead is worth: collected revenue divided by every lead that arrived from a non-paid source.",
      formula: `${fmtUSD(T.revenue)} ÷ ${fmtNum(T.totalLeads)} = ${fmtUSD(T.revenuePerLead)}`,
      supporting: [
        { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSD(T.revenue) },
        { key: "leads", label: A ? "العملاء" : "Leads", value: fmtNum(T.totalLeads) },
        {
          key: "conversion",
          label: A ? "معدل التحويل" : "Conversion",
          value: fmtPct(T.conversionRate, 1),
        },
        { key: "avg", label: A ? "متوسط الفاتورة" : "Average invoice", value: fmtUSD(T.avgOrder) },
      ],
      breakdowns: [
        {
          id: "sources",
          title: A ? "قيمة الليد حسب المصدر" : "Lead value by source",
          rows: bySource((row) => row.revenuePerLead ?? 0, fmtUSD),
          emptyLabel: A ? "لا يوجد مصدر بعملاء" : "No source carries leads",
        },
      ],
    },
    lost: {
      id: "organic.lost",
      title: "Lost",
      value: fmtNum(T.lost),
      tone: "rose",
      icon: <Target size={16} />,
      definition: A
        ? "الصفقات الأورجانيك التي أُغلقت خاسرة، من مصدر الخسائر المعتمد وحده."
        : "Organic deals closed as lost, from the approved Lost source only.",
      formula: `${fmtNum(T.lost)} ÷ ${fmtNum(T.totalLeads)} = ${fmtPct(T.lostRate, 2)}`,
      supporting: [
        { key: "rate", label: A ? "نسبة الخسارة" : "Lost rate", value: fmtPct(T.lostRate, 2) },
        { key: "leads", label: A ? "المقام" : "Denominator", value: fmtNum(T.totalLeads) },
        { key: "won", label: A ? "رابحة" : "Won", value: fmtNum(T.won) },
        {
          key: "open",
          label: A ? "مفتوح" : "Open",
          value: fmtNum(Math.max(0, T.totalLeads - T.won - T.lost)),
        },
      ],
      breakdowns: [
        {
          id: "sources",
          title: A ? "الخسائر حسب المصدر" : "Losses by source",
          rows: bySource((row) => row.lost, fmtNum),
          emptyLabel: A ? "لا توجد خسائر في الفترة" : "No losses in this period",
        },
        {
          id: "courses",
          title: A ? "الخسائر حسب الدورة" : "Losses by course",
          rows: byCourse((row) => row.lost, fmtNum),
          emptyLabel: A ? "لا توجد خسائر في الفترة" : "No losses in this period",
        },
      ],
      report: { to: "/lost", label: A ? "فتح تحليل الخسائر" : "Open the Lost analysis" },
    },
  };
}

function Organic() {
  const reportingPeriod = useReportingPeriod();
  // Declares this page to ENGO Nexus, so "حلل الصفحة دي" and "التاب ده"
  // have something to resolve against. Ids and state only — no figures.
  useRegisterNexusView("organic");
  const { lang } = useI18n();
  const filters = useFilters();

  useEffect(() => {
    if (filters.channel !== "organic" || filters.platform) setAcquisitionFilter("organic");
  }, [filters.channel, filters.platform]);

  const { data, isLoading, error, refetch } = useApi<OrganicResponse>("/api/organic");
  // One description per figure, built once from the response on screen.
  const metrics = data ? organicMetrics(data, lang) : null;

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  const lostAvailable = data ? hasReportableLost(data.health.lostAuthority) : false;
  // The six findings, described from the same response the cards already read.
  const insights = data ? organicInsights(data, lostAvailable, lang) : null;

  const sourceColumns: Col<OrganicBreakdown>[] = [
    {
      key: "name",
      header: lang === "ar" ? "المصدر" : "Source",
      label: lang === "ar" ? "المصدر" : "Source",
      sticky: true,
      always: true,
      minWidth: "180px",
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
            style={{ background: "var(--success-soft)", color: "var(--success)" }}
          >
            <MessageCircleMore size={15} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold text-text" title={row.name}>
              {row.name}
            </div>
            <div className="num text-[11px] text-text-subtle">
              {fmtPct(row.leadShare, 1)} من الليدز
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "leads",
      header: lang === "ar" ? "الليدز" : "Leads",
      label: lang === "ar" ? "الليدز" : "Leads",
      align: "center",
      minWidth: "88px",
      sortValue: (row) => row.leads,
      render: (row) => <span className="num font-semibold">{fmtNum(row.leads)}</span>,
    },
    {
      key: "won",
      header: "Won",
      align: "center",
      minWidth: "80px",
      sortValue: (row) => row.won,
      render: (row) => <span className="num text-success">{fmtNum(row.won)}</span>,
    },
    {
      key: "lost",
      header: "Lost",
      align: "center",
      minWidth: "80px",
      sortValue: (row) => row.lost,
      render: (row) => (
        <span className="num text-danger">{lostAvailable ? fmtNum(row.lost) : "—"}</span>
      ),
    },
    {
      key: "open",
      header: lang === "ar" ? "مفتوح" : "Open",
      align: "center",
      minWidth: "82px",
      sortValue: (row) => row.open,
      render: (row) => (
        <span className="num text-text-muted">{lostAvailable ? fmtNum(row.open) : "—"}</span>
      ),
    },
    {
      key: "conversionRate",
      header: lang === "ar" ? "التحويل" : "Conversion",
      align: "center",
      minWidth: "105px",
      sortValue: (row) => row.conversionRate ?? -1,
      render: (row) => (
        <Pill tone="success">{lostAvailable ? fmtPct(row.conversionRate) : "—"}</Pill>
      ),
    },
    {
      key: "revenue",
      header: lang === "ar" ? "الإيراد" : "Revenue",
      align: "center",
      minWidth: "118px",
      sortValue: (row) => row.revenue,
      render: (row) => <span className="num font-semibold">{fmtUSDFull(row.revenue)}</span>,
    },
    {
      key: "invoices",
      header: lang === "ar" ? "الفواتير" : "Invoices",
      align: "center",
      minWidth: "92px",
      sortValue: (row) => row.invoices,
      render: (row) => <span className="num">{fmtNum(row.invoices)}</span>,
    },
    {
      key: "salesOrders",
      header: lang === "ar" ? "أوامر البيع" : "Sales orders",
      align: "center",
      minWidth: "105px",
      hideByDefault: true,
      sortValue: (row) => row.salesOrders,
      render: (row) => <span className="num">{fmtNum(row.salesOrders)}</span>,
    },
    {
      key: "revenuePerLead",
      header: lang === "ar" ? "إيراد / ليد" : "Revenue / lead",
      align: "center",
      minWidth: "112px",
      hideByDefault: true,
      sortValue: (row) => row.revenuePerLead ?? -1,
      render: (row) => <span className="num">{fmtUSD(row.revenuePerLead)}</span>,
    },
  ];

  const courseColumns: Col<CourseAgg>[] = [
    {
      key: "name",
      header: lang === "ar" ? "الدورة" : "Course",
      sticky: true,
      always: true,
      minWidth: "210px",
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-text" title={row.name}>
            {row.name}
          </div>
          <div className="truncate text-[11px] text-text-subtle">{row.mainCategory || "—"}</div>
        </div>
      ),
    },
    {
      key: "crmLeads",
      header: lang === "ar" ? "الليدز" : "Leads",
      align: "center",
      minWidth: "88px",
      sortValue: (row) => row.crmLeads,
      render: (row) => <span className="num font-semibold">{fmtNum(row.crmLeads)}</span>,
    },
    {
      key: "won",
      header: "Won",
      align: "center",
      minWidth: "80px",
      sortValue: (row) => row.won,
      render: (row) => <span className="num text-success">{fmtNum(row.won)}</span>,
    },
    {
      key: "lost",
      header: "Lost",
      align: "center",
      minWidth: "80px",
      sortValue: (row) => row.lost,
      render: (row) => (
        <span className="num text-danger">{lostAvailable ? fmtNum(row.lost) : "—"}</span>
      ),
    },
    {
      key: "conversionRate",
      header: lang === "ar" ? "التحويل" : "Conversion",
      align: "center",
      minWidth: "105px",
      sortValue: (row) => row.conversionRate ?? -1,
      render: (row) => (
        <Pill tone="success">{lostAvailable ? fmtPct(row.conversionRate) : "—"}</Pill>
      ),
    },
    {
      key: "revenue",
      header: lang === "ar" ? "الإيراد" : "Revenue",
      align: "center",
      minWidth: "118px",
      sortValue: (row) => row.revenue,
      render: (row) => <span className="num font-semibold">{fmtUSDFull(row.revenue)}</span>,
    },
    {
      key: "invoices",
      header: lang === "ar" ? "الفواتير" : "Invoices",
      align: "center",
      minWidth: "92px",
      sortValue: (row) => row.invoices,
      render: (row) => <span className="num">{fmtNum(row.invoices)}</span>,
    },
    {
      key: "salesOrders",
      header: lang === "ar" ? "أوامر البيع" : "Sales orders",
      align: "center",
      minWidth: "105px",
      hideByDefault: true,
      sortValue: (row) => row.salesOrders,
      render: (row) => <span className="num">{fmtNum(row.salesOrders)}</span>,
    },
    {
      key: "revenuePerLead",
      header: lang === "ar" ? "إيراد / ليد" : "Revenue / lead",
      align: "center",
      minWidth: "112px",
      hideByDefault: true,
      sortValue: (row) => row.revenuePerLead ?? -1,
      render: (row) => <span className="num">{fmtUSD(row.revenuePerLead)}</span>,
    },
  ];

  const campaignColumns: Col<OrganicCampaign>[] = [
    {
      key: "name",
      header: lang === "ar" ? "الحملة" : "Campaign",
      sticky: true,
      always: true,
      minWidth: "245px",
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="max-w-[300px]">
          <div className="truncate font-semibold text-text" title={row.name}>
            {row.name}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {row.sources.slice(0, 2).map((source) => (
              <Pill key={source}>{source}</Pill>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: "courses",
      header: lang === "ar" ? "الدورات" : "Courses",
      minWidth: "175px",
      sortValue: (row) => row.courses.join(" "),
      render: (row) => (
        <span className="line-clamp-2 text-xs text-text-muted" title={row.courses.join("، ")}>
          {row.courses.join("، ") || "—"}
        </span>
      ),
    },
    {
      key: "leads",
      header: lang === "ar" ? "الليدز" : "Leads",
      align: "center",
      minWidth: "88px",
      sortValue: (row) => row.leads,
      render: (row) => <span className="num font-semibold">{fmtNum(row.leads)}</span>,
    },
    {
      key: "won",
      header: "Won",
      align: "center",
      minWidth: "80px",
      sortValue: (row) => row.won,
      render: (row) => <span className="num text-success">{fmtNum(row.won)}</span>,
    },
    {
      key: "lost",
      header: "Lost",
      align: "center",
      minWidth: "80px",
      sortValue: (row) => row.lost,
      render: (row) => (
        <span className="num text-danger">{lostAvailable ? fmtNum(row.lost) : "—"}</span>
      ),
    },
    {
      key: "conversionRate",
      header: lang === "ar" ? "التحويل" : "Conversion",
      align: "center",
      minWidth: "105px",
      sortValue: (row) => row.conversionRate ?? -1,
      render: (row) => (
        <Pill tone="success">{lostAvailable ? fmtPct(row.conversionRate) : "—"}</Pill>
      ),
    },
    {
      key: "revenue",
      header: lang === "ar" ? "الإيراد" : "Revenue",
      align: "center",
      minWidth: "118px",
      sortValue: (row) => row.revenue,
      render: (row) => <span className="num font-semibold">{fmtUSDFull(row.revenue)}</span>,
    },
    {
      key: "invoices",
      header: lang === "ar" ? "الفواتير" : "Invoices",
      align: "center",
      minWidth: "92px",
      sortValue: (row) => row.invoices,
      render: (row) => <span className="num">{fmtNum(row.invoices)}</span>,
    },
    {
      key: "salesOrders",
      header: lang === "ar" ? "أوامر البيع" : "Sales orders",
      align: "center",
      minWidth: "105px",
      hideByDefault: true,
      sortValue: (row) => row.salesOrders,
      render: (row) => <span className="num">{fmtNum(row.salesOrders)}</span>,
    },
  ];

  const peopleColumns: Col<TeamAgg>[] = [
    {
      key: "name",
      header: lang === "ar" ? "الموظف" : "Salesperson",
      sticky: true,
      always: true,
      minWidth: "190px",
      sortValue: (row) => row.name,
      render: (row) => (
        <div>
          <div className="font-semibold text-text">{row.name}</div>
          <div className="text-[11px] text-text-subtle">{row.parent || "—"}</div>
        </div>
      ),
    },
    {
      key: "crmLeads",
      header: lang === "ar" ? "الليدز" : "Leads",
      align: "center",
      minWidth: "88px",
      sortValue: (row) => row.crmLeads,
      render: (row) => <span className="num">{fmtNum(row.crmLeads)}</span>,
    },
    {
      key: "won",
      header: "Won",
      align: "center",
      minWidth: "80px",
      sortValue: (row) => row.won,
      render: (row) => <span className="num text-success">{fmtNum(row.won)}</span>,
    },
    {
      key: "conversionRate",
      header: lang === "ar" ? "التحويل" : "Conversion",
      align: "center",
      minWidth: "105px",
      sortValue: (row) => row.conversionRate ?? -1,
      render: (row) => (
        <Pill tone="success">{lostAvailable ? fmtPct(row.conversionRate) : "—"}</Pill>
      ),
    },
    {
      key: "revenue",
      header: lang === "ar" ? "الإيراد" : "Revenue",
      align: "center",
      minWidth: "118px",
      sortValue: (row) => row.revenue,
      render: (row) => <span className="num font-semibold">{fmtUSDFull(row.revenue)}</span>,
    },
    {
      key: "orders",
      header: lang === "ar" ? "الفواتير" : "Invoices",
      align: "center",
      minWidth: "92px",
      sortValue: (row) => row.orders,
      render: (row) => <span className="num">{fmtNum(row.orders)}</span>,
    },
  ];

  const sources = data?.sources ?? [];
  const courses = data?.courses ?? [];
  const campaigns = data?.campaigns ?? [];
  const people = (data?.people ?? []).filter((person) => person.name !== "—");
  const monthly = (data?.monthly ?? []).map((month) => ({
    date: `${month.month}-01`,
    leads: month.leads,
    won: month.won,
    revenue: month.revenue,
  }));
  const insight = data?.insights;

  return (
    <div className="page-sections">
      <div>
        <DashboardPageHeader
          flush
          icon={<Leaf size={20} />}
          title={lang === "ar" ? "أورجانيك" : "Organic"}
          subtitle={
            lang === "ar"
              ? "كل مصادر Odoo غير المدفوعة: من أين تأتي الفرص، وما الذي يتحول إلى بيع فعلي."
              : "Every non-paid Odoo source: where opportunities originate and what turns into paid sales."
          }
          period={reportingPeriod}
        />
        <FilterSummary />
      </div>

      {isLoading || !data ? (
        <>
          <Skeleton className="h-52 rounded-2xl" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-28 rounded-2xl" />
            ))}
          </div>
        </>
      ) : (
        <>
          <Card
            className="relative overflow-hidden"
            style={{ borderColor: "color-mix(in oklab, var(--success) 32%, var(--border))" }}
          >
            <Leaf
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-14 -end-10 h-52 w-52 rotate-[-14deg] opacity-[0.045]"
              strokeWidth={1.2}
            />
            <div className="relative grid gap-6 xl:grid-cols-[1.05fr_1.45fr] xl:items-end">
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <span
                    className="grid h-11 w-11 place-items-center rounded-2xl"
                    style={{ background: "var(--success-soft)", color: "var(--success)" }}
                  >
                    <Sprout size={22} />
                  </span>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-success">
                      Organic pulse
                    </div>
                    <div className="text-xs text-text-muted">
                      {fmtNum(data.counts.sources)}{" "}
                      {lang === "ar" ? "مصدر غير مدفوع" : "non-paid sources"}
                    </div>
                  </div>
                </div>
                <p className="text-xs font-medium text-text-muted">
                  {lang === "ar" ? "أكبر مصدر لليدز" : "Largest lead source"}
                </p>
                <div className="mt-1 truncate text-2xl font-semibold text-text sm:text-3xl">
                  {insight?.topLeadSource?.name || "—"}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  <Pill tone="success">
                    {fmtNum(insight?.topLeadSource?.leads)} {lang === "ar" ? "ليد" : "leads"}
                  </Pill>
                  <span>
                    {fmtPct(insight?.topLeadSource?.leadShare, 1)}{" "}
                    {lang === "ar"
                      ? lostAvailable
                        ? "من الإجمالي"
                        : "من الليدز المتاحة"
                      : lostAvailable
                        ? "of total"
                        : "of available leads"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  {
                    label:
                      lang === "ar"
                        ? lostAvailable
                          ? "كل الليدز"
                          : "الليدز المتاحة"
                        : lostAvailable
                          ? "Total leads"
                          : "Available leads",
                    value: fmtNum(data.totals.totalLeads),
                  },
                  {
                    label: "Won",
                    value: fmtNum(data.totals.won),
                  },
                  {
                    label: lang === "ar" ? "نسبة التحويل" : "Conversion",
                    value: lostAvailable ? fmtPct(data.totals.conversionRate) : "—",
                  },
                  {
                    label: lang === "ar" ? "الإيراد المدفوع" : "Paid revenue",
                    value: fmtUSD(data.totals.revenue),
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-border p-3.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <div className="text-[10px] font-medium uppercase tracking-wide text-text-subtle">
                      {item.label}
                    </div>
                    <div className="num mt-2 text-xl font-semibold text-text">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <KpiRow>
            <MetricDetailTrigger
              detail={metrics!.invoices}
              card={{
                index: 0,
                sub: lang === "ar" ? "حركة محاسبية منفصلة" : "distinct accounting moves",
              }}
            />
            <MetricDetailTrigger
              detail={metrics!.average}
              card={{ index: 1, sub: lang === "ar" ? "الإيراد ÷ الفواتير" : "revenue ÷ invoices" }}
            />
            <MetricDetailTrigger
              detail={metrics!.perLead}
              card={{
                index: 2,
                sub: lang === "ar" ? "قيمة الليد الأورجانيك" : "organic lead value",
              }}
            />
            <MetricDetailTrigger
              detail={{
                ...metrics!.lost,
                value: lostAvailable ? fmtNum(data.totals.lost) : "—",
              }}
              card={{
                index: 3,
                sub: lostAvailable
                  ? fmtPct(data.totals.lostRate)
                  : lang === "ar"
                    ? "المصدر غير متاح حاليًا"
                    : "source currently unavailable",
              }}
            />
          </KpiRow>

          <section>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "الخلاصة التنفيذية للفترة والفلاتر الحالية."
                  : "Executive takeaways for the current period and filters."
              }
            >
              {lang === "ar" ? "أهم النتائج" : "Key findings"}
            </SectionTitle>
            <InsightRow className="sm:grid-cols-2 xl:grid-cols-3">
              <InsightDetailTrigger
                detail={insights!.topLeadSource}
                card={{
                  index: 0,
                  kind: "note",
                  eyebrow: lang === "ar" ? "أكبر حجم" : "Most volume",
                  title: insight?.topLeadSource?.name || "—",
                  value: fmtNum(insight?.topLeadSource?.leads),
                  detail:
                    lang === "ar"
                      ? `${fmtPct(insight?.topLeadSource?.leadShare, 1)} من ${lostAvailable ? "كل الليدز" : "الليدز المتاحة"}`
                      : `${fmtPct(insight?.topLeadSource?.leadShare, 1)} of ${lostAvailable ? "all leads" : "available leads"}`,
                  actionLabel: lang === "ar" ? "ما ترتيب المصادر؟" : "How do the sources rank?",
                }}
              />
              <InsightDetailTrigger
                detail={insights!.topRevenueSource}
                card={{
                  index: 1,
                  kind: "best",
                  eyebrow: lang === "ar" ? "أعلى إيراد" : "Top revenue source",
                  title: insight?.topRevenueSource?.name || "—",
                  value: fmtUSD(insight?.topRevenueSource?.revenue),
                  detail:
                    lang === "ar"
                      ? `${fmtNum(insight?.topRevenueSource?.invoices)} فاتورة مدفوعة`
                      : `${fmtNum(insight?.topRevenueSource?.invoices)} paid invoices`,
                  actionLabel: lang === "ar" ? "من أين جاء الإيراد؟" : "Where did it come from?",
                }}
              />
              <InsightDetailTrigger
                detail={insights!.topRevenueCourse}
                card={{
                  index: 2,
                  kind: "best",
                  eyebrow: lang === "ar" ? "أفضل دورة مبيعًا" : "Best-selling course",
                  title: insight?.topRevenueCourse?.name || "—",
                  value: fmtUSD(insight?.topRevenueCourse?.revenue),
                  detail:
                    lang === "ar"
                      ? `${fmtNum(insight?.topRevenueCourse?.invoices)} فاتورة · ${fmtNum(insight?.topRevenueCourse?.crmLeads)} ليد`
                      : `${fmtNum(insight?.topRevenueCourse?.invoices)} invoices · ${fmtNum(insight?.topRevenueCourse?.crmLeads)} leads`,
                  actionLabel: lang === "ar" ? "لماذا هذه الدورة؟" : "Why this course?",
                }}
              />
              <InsightDetailTrigger
                detail={insights!.bestConversionCourse}
                card={{
                  index: 3,
                  kind: "opportunity",
                  eyebrow: lang === "ar" ? "أقوى تحويل" : "Best conversion",
                  title: lostAvailable ? insight?.bestConversionCourse?.name || "—" : "—",
                  value: lostAvailable
                    ? fmtPct(insight?.bestConversionCourse?.conversionRate)
                    : "—",
                  detail: !lostAvailable
                    ? lang === "ar"
                      ? "يظهر بعد رجوع مصدر Archived Lost"
                      : "available when Archived Lost recovers"
                    : lang === "ar"
                      ? `بين الدورات التي لديها 20 ليد على الأقل`
                      : "among courses with at least 20 leads",
                  actionLabel: lang === "ar" ? "على أي أساس؟" : "On what basis?",
                }}
              />
              <InsightDetailTrigger
                detail={insights!.topSalesperson}
                card={{
                  index: 4,
                  kind: "note",
                  eyebrow: lang === "ar" ? "أفضل موظف بالإيراد" : "Top salesperson",
                  title:
                    insight?.topSalesperson?.displayName || insight?.topSalesperson?.name || "—",
                  value: fmtUSD(insight?.topSalesperson?.revenue),
                  detail: insight?.topSalesperson?.parent || "—",
                  actionLabel: lang === "ar" ? "ما ترتيب الموظفين؟" : "How do people rank?",
                }}
              />
              <InsightDetailTrigger
                detail={insights!.topTeam}
                card={{
                  index: 5,
                  kind: "opportunity",
                  eyebrow: lang === "ar" ? "أفضل فريق" : "Top team",
                  title: insight?.topTeam?.name || "—",
                  value: fmtUSD(insight?.topTeam?.revenue),
                  detail:
                    lang === "ar"
                      ? `${fmtNum(insight?.topTeam?.won)} Won من ${fmtNum(insight?.topTeam?.crmLeads)} ليد`
                      : `${fmtNum(insight?.topTeam?.won)} Won from ${fmtNum(insight?.topTeam?.crmLeads)} leads`,
                  actionLabel: lang === "ar" ? "ما ترتيب الفرق؟" : "How do teams rank?",
                }}
              />
            </InsightRow>
          </section>

          <section>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "مقارنة مباشرة بين WhatsApp وUChat وWebsite وباقي مصادر Odoo غير المدفوعة."
                  : "A direct comparison of WhatsApp, UChat, Website and every other non-paid Odoo source."
              }
            >
              {lang === "ar" ? "من أين يأتي الأورجانيك؟" : "Where does Organic come from?"}
            </SectionTitle>
            <div className="mb-3 card-grid xl:grid-cols-2">
              <Card>
                <SectionTitle
                  hint={lang === "ar" ? "مرتب حسب عدد الليدز" : "ranked by lead volume"}
                >
                  {lang === "ar" ? "أكبر مصادر الليدز" : "Largest lead sources"}
                </SectionTitle>
                <HBarChart
                  data={sources.slice(0, 8).map((row) => ({ label: row.name, value: row.leads }))}
                  height={Math.max(250, Math.min(350, sources.slice(0, 8).length * 40))}
                  color="var(--success)"
                  format={fmtNum}
                  name={lang === "ar" ? "الليدز" : "Leads"}
                  showValues
                />
              </Card>
              <Card>
                <SectionTitle hint={lang === "ar" ? "من الفواتير المدفوعة" : "from paid invoices"}>
                  {lang === "ar" ? "الإيراد حسب المصدر" : "Revenue by source"}
                </SectionTitle>
                <HBarChart
                  data={[...sources]
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, 8)
                    .map((row) => ({ label: row.name, value: row.revenue }))}
                  height={Math.max(250, Math.min(350, sources.slice(0, 8).length * 40))}
                  color="var(--chart-2)"
                  format={fmtUSD}
                  name={lang === "ar" ? "الإيراد" : "Revenue"}
                  showValues
                />
              </Card>
            </div>
            <DataTable
              rows={sources}
              cols={sourceColumns}
              searchable={(row) => row.name}
              initialSort={{ key: "leads", dir: -1 }}
              columnChooser
              csvFilename="organic-sources.csv"
              csvRow={(row) => ({
                source: row.name,
                leads: row.leads,
                won: row.won,
                lost: lostAvailable ? row.lost : "",
                open: lostAvailable ? row.open : "",
                conversion_rate: lostAvailable ? (row.conversionRate ?? "") : "",
                revenue_usd: row.revenue,
                invoices: row.invoices,
                sales_orders: row.salesOrders,
              })}
            />
          </section>

          <section>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "يعرض أي دورة تستقبل فرصًا أكثر وأيها يحولها إلى فواتير وإيراد."
                  : "See which courses attract demand and which convert it into invoices and revenue."
              }
            >
              {lang === "ar" ? "أداء الدورات من الأورجانيك" : "Organic course performance"}
            </SectionTitle>
            <div className="mb-3 card-grid xl:grid-cols-[0.8fr_1.2fr]">
              <Card>
                <SectionTitle hint={lang === "ar" ? "أعلى إيراد مدفوع" : "highest paid revenue"}>
                  {lang === "ar" ? "الدورات الأقوى" : "Top courses"}
                </SectionTitle>
                <HBarChart
                  data={courses.slice(0, 8).map((row) => ({ label: row.name, value: row.revenue }))}
                  height={Math.max(260, Math.min(360, courses.slice(0, 8).length * 42))}
                  color="var(--chart-2)"
                  format={fmtUSD}
                  name={lang === "ar" ? "الإيراد" : "Revenue"}
                  showValues
                />
              </Card>
              <Card>
                <SectionTitle
                  hint={
                    lang === "ar"
                      ? "حجم الليدز مقابل الإيراد عبر الوقت"
                      : "lead volume versus revenue over time"
                  }
                >
                  {lang === "ar" ? "الترند الشهري" : "Monthly trend"}
                </SectionTitle>
                <MultiLineChart
                  data={monthly}
                  height={340}
                  series={[
                    {
                      key: "leads",
                      name: lang === "ar" ? "الليدز" : "Leads",
                      color: "var(--success)",
                    },
                    {
                      key: "won",
                      name: "Won",
                      color: "var(--chart-3)",
                    },
                    {
                      key: "revenue",
                      name: lang === "ar" ? "الإيراد ($)" : "Revenue ($)",
                      color: "var(--chart-2)",
                      axis: "right",
                    },
                  ]}
                  format={fmtCompact}
                />
              </Card>
            </div>
            <DataTable
              rows={courses}
              cols={courseColumns}
              searchable={(row) => `${row.name} ${row.mainCategory}`}
              initialSort={{ key: "revenue", dir: -1 }}
              columnChooser
              csvFilename="organic-courses.csv"
              csvRow={(row) => ({
                course: row.name,
                category: row.mainCategory,
                leads: row.crmLeads,
                won: row.won,
                lost: lostAvailable ? row.lost : "",
                conversion_rate: lostAvailable ? (row.conversionRate ?? "") : "",
                revenue_usd: row.revenue,
                invoices: row.invoices,
                sales_orders: row.salesOrders,
              })}
            />
          </section>

          <section>
            <SectionTitle
              action={<Pill tone="success">{fmtNum(campaigns.length)}</Pill>}
              hint={
                lang === "ar"
                  ? "أسماء الحملات الموجودة على فرص Odoo الأورجانيك، حتى لو لم يكن لها Spend إعلاني."
                  : "Campaign names carried by Organic Odoo opportunities, even without paid-media spend."
              }
            >
              {lang === "ar" ? "حملات الأورجانيك" : "Organic campaigns"}
            </SectionTitle>
            <DataTable
              rows={campaigns}
              cols={campaignColumns}
              searchable={(row) => `${row.name} ${row.sources.join(" ")} ${row.courses.join(" ")}`}
              initialSort={{ key: "revenue", dir: -1 }}
              columnChooser
              csvFilename="organic-campaigns.csv"
              csvRow={(row) => ({
                campaign: row.name,
                sources: row.sources.join(" | "),
                courses: row.courses.join(" | "),
                leads: row.leads,
                won: row.won,
                lost: lostAvailable ? row.lost : "",
                conversion_rate: lostAvailable ? (row.conversionRate ?? "") : "",
                revenue_usd: row.revenue,
                invoices: row.invoices,
              })}
            />
          </section>

          <section>
            <SectionTitle
              action={<Crown size={18} className="text-warning" />}
              hint={
                lang === "ar"
                  ? "من استلم ليدز الأورجانيك ومن حولها إلى إيراد."
                  : "Who handled Organic opportunities and converted them into revenue."
              }
            >
              {lang === "ar" ? "أداء موظفي المبيعات" : "Salesperson performance"}
            </SectionTitle>
            <DataTable
              rows={people}
              cols={peopleColumns}
              searchable={(row) => `${row.name} ${row.parent || ""}`}
              initialSort={{ key: "revenue", dir: -1 }}
              pageSize={20}
              csvFilename="organic-salespeople.csv"
              csvRow={(row) => ({
                salesperson: row.name,
                team: row.parent || "",
                leads: row.crmLeads,
                won: row.won,
                lost: lostAvailable ? row.lost : "",
                conversion_rate: lostAvailable ? (row.conversionRate ?? "") : "",
                revenue_usd: row.revenue,
                invoices: row.orders,
              })}
            />
          </section>
        </>
      )}
    </div>
  );
}
