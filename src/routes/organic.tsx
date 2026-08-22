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
import {
  Card,
  ErrorState,
  KpiCard,
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { setAcquisitionFilter, useFilters } from "@/lib/filter-store";
import { fmtCompact, fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { hasReportableLost } from "@/lib/lost-authority";
import type { CourseAgg, DataHealth, Maybe, TeamAgg, Totals } from "@/lib/types";
import { useApi } from "@/lib/use-api";

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

function InsightCard({
  icon,
  eyebrow,
  title,
  value,
  note,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  value: ReactNode;
  note: ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden" hoverable>
      <div className="mb-4 flex items-start justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-subtle">
          {eyebrow}
        </span>
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{ background: "var(--success-soft)", color: "var(--success)" }}
        >
          {icon}
        </span>
      </div>
      <div className="truncate text-base font-semibold text-text" title={title}>
        {title || "—"}
      </div>
      <div className="num mt-1 text-2xl font-semibold tracking-tight text-text">{value}</div>
      <div className="mt-2 text-xs leading-relaxed text-text-muted">{note}</div>
    </Card>
  );
}

function Organic() {
  const { lang } = useI18n();
  const filters = useFilters();

  useEffect(() => {
    if (filters.channel !== "organic" || filters.platform) setAcquisitionFilter("organic");
  }, [filters.channel, filters.platform]);

  const { data, isLoading, error, refetch } = useApi<OrganicResponse>("/api/organic");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  const lostAvailable = data ? hasReportableLost(data.health.lostAuthority) : false;

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
    <div className="space-y-5 sm:space-y-7">
      <div>
        <PageHeader
          title={lang === "ar" ? "أورجانيك" : "Organic"}
          subtitle={
            lang === "ar"
              ? "كل مصادر Odoo غير المدفوعة: من أين تأتي الفرص، وما الذي يتحول إلى بيع فعلي."
              : "Every non-paid Odoo source: where opportunities originate and what turns into paid sales."
          }
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

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard
              index={0}
              label={lang === "ar" ? "الفواتير المدفوعة" : "Paid invoices"}
              value={fmtNum(data.totals.orders)}
              sub={lang === "ar" ? "حركة محاسبية منفصلة" : "distinct accounting moves"}
              icon={<ReceiptText size={18} />}
            />
            <KpiCard
              index={1}
              label={lang === "ar" ? "متوسط الفاتورة" : "Average invoice"}
              value={fmtUSD(data.totals.avgOrder)}
              sub={lang === "ar" ? "الإيراد ÷ الفواتير" : "revenue ÷ invoices"}
              icon={<HandCoins size={18} />}
            />
            <KpiCard
              index={2}
              label={lang === "ar" ? "الإيراد لكل ليد" : "Revenue per lead"}
              value={fmtUSD(data.totals.revenuePerLead)}
              sub={lang === "ar" ? "قيمة الليد الأورجانيك" : "organic lead value"}
              icon={<BadgeDollarSign size={18} />}
            />
            <KpiCard
              index={3}
              label="Lost"
              value={lostAvailable ? fmtNum(data.totals.lost) : "—"}
              sub={
                lostAvailable
                  ? fmtPct(data.totals.lostRate)
                  : lang === "ar"
                    ? "المصدر غير متاح حاليًا"
                    : "source currently unavailable"
              }
              icon={<Target size={18} />}
            />
          </div>

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
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <InsightCard
                eyebrow={lang === "ar" ? "أكبر حجم" : "Most volume"}
                icon={<MessageCircleMore size={17} />}
                title={insight?.topLeadSource?.name || "—"}
                value={fmtNum(insight?.topLeadSource?.leads)}
                note={
                  lang === "ar"
                    ? `${fmtPct(insight?.topLeadSource?.leadShare, 1)} من ${lostAvailable ? "كل الليدز" : "الليدز المتاحة"}`
                    : `${fmtPct(insight?.topLeadSource?.leadShare, 1)} of ${lostAvailable ? "all leads" : "available leads"}`
                }
              />
              <InsightCard
                eyebrow={lang === "ar" ? "أعلى إيراد" : "Top revenue source"}
                icon={<HandCoins size={17} />}
                title={insight?.topRevenueSource?.name || "—"}
                value={fmtUSD(insight?.topRevenueSource?.revenue)}
                note={
                  lang === "ar"
                    ? `${fmtNum(insight?.topRevenueSource?.invoices)} فاتورة مدفوعة`
                    : `${fmtNum(insight?.topRevenueSource?.invoices)} paid invoices`
                }
              />
              <InsightCard
                eyebrow={lang === "ar" ? "أفضل دورة مبيعًا" : "Best-selling course"}
                icon={<Trophy size={17} />}
                title={insight?.topRevenueCourse?.name || "—"}
                value={fmtUSD(insight?.topRevenueCourse?.revenue)}
                note={
                  lang === "ar"
                    ? `${fmtNum(insight?.topRevenueCourse?.invoices)} فاتورة · ${fmtNum(insight?.topRevenueCourse?.crmLeads)} ليد`
                    : `${fmtNum(insight?.topRevenueCourse?.invoices)} invoices · ${fmtNum(insight?.topRevenueCourse?.crmLeads)} leads`
                }
              />
              <InsightCard
                eyebrow={lang === "ar" ? "أقوى تحويل" : "Best conversion"}
                icon={<BookOpenCheck size={17} />}
                title={lostAvailable ? insight?.bestConversionCourse?.name || "—" : "—"}
                value={lostAvailable ? fmtPct(insight?.bestConversionCourse?.conversionRate) : "—"}
                note={
                  !lostAvailable
                    ? lang === "ar"
                      ? "يظهر بعد رجوع مصدر Archived Lost"
                      : "available when Archived Lost recovers"
                    : lang === "ar"
                      ? `بين الدورات التي لديها 20 ليد على الأقل`
                      : "among courses with at least 20 leads"
                }
              />
              <InsightCard
                eyebrow={lang === "ar" ? "أفضل موظف بالإيراد" : "Top salesperson"}
                icon={<UserRoundCheck size={17} />}
                title={insight?.topSalesperson?.name || "—"}
                value={fmtUSD(insight?.topSalesperson?.revenue)}
                note={insight?.topSalesperson?.parent || "—"}
              />
              <InsightCard
                eyebrow={lang === "ar" ? "أفضل فريق" : "Top team"}
                icon={<UsersRound size={17} />}
                title={insight?.topTeam?.name || "—"}
                value={fmtUSD(insight?.topTeam?.revenue)}
                note={
                  lang === "ar"
                    ? `${fmtNum(insight?.topTeam?.won)} Won من ${fmtNum(insight?.topTeam?.crmLeads)} ليد`
                    : `${fmtNum(insight?.topTeam?.won)} Won from ${fmtNum(insight?.topTeam?.crmLeads)} leads`
                }
              />
            </div>
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
            <div className="mb-3 grid gap-3 xl:grid-cols-2">
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
            <div className="mb-3 grid gap-3 xl:grid-cols-[0.8fr_1.2fr]">
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
