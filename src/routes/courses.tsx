import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  BadgeDollarSign,
  BarChart3,
  CalendarDays,
  GraduationCap,
  History,
  Info,
  ReceiptText,
  Search,
  ShoppingCart,
  Target,
  Users,
} from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import { FilterSummary } from "@/components/ads/FilterSummary";
import {
  DeltaBadge,
  EmptyState,
  ErrorState,
  KpiCard,
  Notice,
  PageHeader,
  Pill,
  Skeleton,
} from "@/components/ui-bits";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/constants";
import { fmtDate, fmtNum, fmtPct, fmtRoas, fmtUSD, useI18n } from "@/lib/i18n";
import type { CampaignObjective, CourseAgg, Platform, Totals } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export const Route = createFileRoute("/courses")({ component: Courses });

type AttributionSource = "ad_name" | "adset_name" | "campaign_name" | "crm_leads";

interface CourseCampaign {
  key: string;
  name: string;
  platforms: Platform[];
  accounts: string[];
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

function Courses() {
  const { lang } = useI18n();
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const { data, isLoading, error, refetch } = useApi<CoursesResponse>("/api/courses");

  const courses = useMemo(() => data?.courses ?? [], [data?.courses]);
  const selectedCourse = courses.find((course) => course.key === selectedKey) ?? courses[0] ?? null;
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

  const columns: Col<CourseAgg>[] = [
    {
      key: "name",
      header: lang === "ar" ? "الدورة" : "Course",
      label: lang === "ar" ? "الدورة" : "Course",
      sticky: true,
      always: true,
      width: "220px",
      minWidth: "220px",
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="flex max-w-[240px] items-start gap-2">
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            style={{
              background: selectedCourse?.key === row.key ? "var(--brand)" : "var(--border)",
            }}
          />
          <div className="min-w-0">
            <div className="truncate font-semibold text-text" title={row.name}>
              {row.name || "—"}
            </div>
            {row.mainCategory && (
              <div className="mt-0.5 truncate text-[11px] text-text-muted" title={row.mainCategory}>
                {row.mainCategory}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "spend",
      header: lang === "ar" ? "مصروف عليها" : "Ad spend",
      label: lang === "ar" ? "مصروف عليها" : "Ad spend",
      align: "center",
      minWidth: "112px",
      sortValue: (row) => row.spend,
      render: (row) => <span className="num font-medium">{fmtUSD(row.spend)}</span>,
    },
    {
      key: "crmLeads",
      header: lang === "ar" ? "الليدز" : "CRM leads",
      label: lang === "ar" ? "الليدز" : "CRM leads",
      align: "center",
      minWidth: "92px",
      sortValue: (row) => row.crmLeads,
      render: (row) => <span className="num">{fmtNum(row.crmLeads)}</span>,
    },
    {
      key: "lost",
      header: lang === "ar" ? "Lost" : "Lost",
      label: lang === "ar" ? "الفرص المؤرشفة Lost" : "Archived Lost",
      align: "center",
      minWidth: "92px",
      sortValue: (row) => row.lost,
      render: (row) => <span className="num text-danger">{fmtNum(row.lost)}</span>,
    },
    {
      key: "won",
      header: lang === "ar" ? "Won" : "Won",
      label: lang === "ar" ? "الصفقات المكسبة" : "Won deals",
      align: "center",
      minWidth: "88px",
      sortValue: (row) => row.won,
      render: (row) => <span className="num text-success">{fmtNum(row.won)}</span>,
    },
    {
      key: "salesOrders",
      header: lang === "ar" ? "أوامر البيع" : "Sales orders",
      label: lang === "ar" ? "أوامر البيع" : "Sales orders",
      align: "center",
      minWidth: "112px",
      sortValue: (row) => row.salesOrders,
      render: (row) => <span className="num font-medium">{fmtNum(row.salesOrders)}</span>,
    },
    {
      key: "invoices",
      header: lang === "ar" ? "الفواتير" : "Paid invoices",
      label: lang === "ar" ? "الفواتير" : "Paid invoices",
      align: "center",
      minWidth: "100px",
      sortValue: (row) => row.invoices,
      render: (row) => <span className="num font-medium">{fmtNum(row.invoices)}</span>,
    },
    {
      key: "revenue",
      header: lang === "ar" ? "المحصل" : "Collected revenue",
      label: lang === "ar" ? "المحصل" : "Collected revenue",
      align: "center",
      minWidth: "122px",
      sortValue: (row) => row.revenue,
      render: (row) => <span className="num font-semibold">{fmtUSD(row.revenue)}</span>,
    },
    {
      key: "roas",
      header: "ROAS",
      label: "ROAS",
      align: "center",
      minWidth: "88px",
      sortValue: (row) => row.roas ?? -1,
      render: (row) =>
        row.spend > 0 && row.roas !== null ? (
          <Pill tone={row.roas >= 2 ? "success" : row.roas >= 1 ? "warning" : "danger"}>
            {fmtRoas(row.roas)}
          </Pill>
        ) : (
          <span className="text-text-subtle">—</span>
        ),
    },
    {
      key: "platformLeads",
      header: lang === "ar" ? "ليدز المنصات" : "Platform leads",
      label: lang === "ar" ? "ليدز المنصات" : "Platform leads",
      align: "center",
      minWidth: "112px",
      hideByDefault: true,
      sortValue: (row) => row.platformLeads ?? -1,
      render: (row) => <span className="num">{fmtNum(row.platformLeads)}</span>,
    },
    {
      key: "conversionRate",
      header: lang === "ar" ? "نسبة الإغلاق" : "Close rate",
      label: lang === "ar" ? "نسبة الإغلاق" : "Close rate",
      align: "center",
      minWidth: "104px",
      hideByDefault: true,
      sortValue: (row) => row.conversionRate ?? -1,
      render: (row) => <span className="num">{fmtPct(row.conversionRate)}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={lang === "ar" ? "الدورات" : "Courses"}
        subtitle={
          lang === "ar"
            ? "كل دورة في صف واحد، وتحتها الحملات الشغالة والقديمة ومقارنة شهر بشهر."
            : "One row per course, with current campaigns, campaign history and month-to-month comparison."
        }
      />

      <FilterSummary />

      {isLoading || !data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-[118px]" />
            ))}
          </div>
          <Skeleton className="h-[520px]" />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard
              index={0}
              hero
              icon={<BadgeDollarSign size={16} />}
              label={lang === "ar" ? "إنفاق الدورات" : "Course ad spend"}
              value={fmtUSD(linked.spend)}
            />
            <KpiCard
              index={1}
              icon={<Users size={16} />}
              label={lang === "ar" ? "ليدز الدورات" : "Course leads"}
              value={fmtNum(linked.leads)}
            />
            <KpiCard
              index={2}
              icon={<ShoppingCart size={16} />}
              label={lang === "ar" ? "أوامر البيع المرتبطة" : "Linked sales orders"}
              value={fmtNum(linked.salesOrders)}
            />
            <KpiCard
              index={3}
              icon={<ReceiptText size={16} />}
              label={lang === "ar" ? "الفواتير المرتبطة" : "Linked paid invoices"}
              value={fmtNum(linked.invoices)}
            />
            <KpiCard
              index={4}
              icon={<GraduationCap size={16} />}
              label={lang === "ar" ? "المحصل من الدورات" : "Course revenue"}
              value={fmtUSD(linked.revenue)}
            />
          </div>

          <Notice icon={<Info size={17} />}>
            {lang === "ar"
              ? "مصروف الدورة بيتربط من اسم الإعلان أولًا، ثم اسم مجموعة الإعلانات، ثم اسم الحملة، ولو الاسم مش واضح بنرجع للدورة الغالبة في ليدز الحملة. كل كارت تحت بيقولك مصدر الربط. الليدز من CRM، وأوامر البيع من Full Invoiced Orders، والفواتير والإيراد من الفواتير المدفوعة."
              : "Course spend is attributed from the ad name first, then ad-set name, campaign name, and finally the campaign's dominant CRM course. Every campaign card shows its attribution source. Leads come from CRM, sales orders from Full Invoiced Orders, and invoices/revenue from Paid Invoices."}
          </Notice>

          <div className="md:hidden">
            <div className="mb-3 flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-brand">
              <Search size={16} className="shrink-0 text-text-subtle" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={lang === "ar" ? "ابحث عن دورة" : "Search courses"}
                className="min-w-0 flex-1 bg-transparent py-2 text-sm text-text outline-none"
              />
            </div>

            {visibleCourses.length ? (
              <div className="space-y-3">
                {visibleCourses.map((course) => {
                  const selected = selectedCourse?.key === course.key;
                  return (
                    <button
                      type="button"
                      key={course.key}
                      onClick={() => setSelectedKey(course.key)}
                      className={`card w-full overflow-hidden p-4 text-start transition-colors ${
                        selected ? "border-brand bg-brand-soft/40" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                        <div className="min-w-0">
                          <h2
                            className="truncate text-sm font-semibold text-text"
                            title={course.name}
                          >
                            {course.name}
                          </h2>
                          {course.mainCategory && (
                            <p className="mt-0.5 truncate text-[11px] text-text-muted">
                              {course.mainCategory}
                            </p>
                          )}
                        </div>
                        <Pill tone={course.spend > 0 ? "brand" : "neutral"}>
                          {fmtUSD(course.spend)}
                        </Pill>
                      </div>

                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                        <MobileMetric
                          label={lang === "ar" ? "الليدز" : "Leads"}
                          value={fmtNum(course.crmLeads)}
                        />
                        <MobileMetric label="Lost" value={fmtNum(course.lost)} />
                        <MobileMetric label="Won" value={fmtNum(course.won)} />
                        <MobileMetric
                          label={lang === "ar" ? "أوامر البيع" : "Sales orders"}
                          value={fmtNum(course.salesOrders)}
                        />
                        <MobileMetric
                          label={lang === "ar" ? "الفواتير" : "Paid invoices"}
                          value={fmtNum(course.invoices)}
                        />
                        <MobileMetric
                          label={lang === "ar" ? "المحصل" : "Revenue"}
                          value={fmtUSD(course.revenue)}
                        />
                      </dl>
                      <p className="mt-3 text-[11px] font-medium text-brand">
                        {selected
                          ? lang === "ar"
                            ? "تفاصيل الدورة ظاهرة تحت"
                            : "Course detail shown below"
                          : lang === "ar"
                            ? "اضغط لعرض الحملات والمقارنة"
                            : "Tap for campaigns and comparison"}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="card">
                <EmptyState
                  label={lang === "ar" ? "مفيش دورة مطابقة للبحث" : "No matching course"}
                  compact
                />
              </div>
            )}
          </div>

          <div className="hidden md:block">
            <DataTable
              rows={courses}
              cols={columns}
              searchable={(row) => `${row.name} ${row.mainCategory}`}
              search={search}
              onSearchChange={setSearch}
              onRowClick={(row) => setSelectedKey(row.key)}
              initialSort={{ key: "spend", dir: -1 }}
              pageSize={30}
              maxHeight={680}
              columnChooser
              toolbar={
                <span className="text-xs text-text-muted">
                  {lang === "ar" ? "اضغط أي دورة للتفاصيل" : "Select a course for detail"}
                </span>
              }
              csvFilename="engosoft-courses"
              csvRow={(row) => ({
                [lang === "ar" ? "الدورة" : "Course"]: row.name,
                [lang === "ar" ? "مصروف عليها" : "Ad spend"]: row.spend,
                [lang === "ar" ? "الليدز" : "CRM leads"]: row.crmLeads,
                Lost: row.lost,
                Won: row.won,
                [lang === "ar" ? "أوامر البيع" : "Sales orders"]: row.salesOrders,
                [lang === "ar" ? "الفواتير" : "Paid invoices"]: row.invoices,
                [lang === "ar" ? "المحصل" : "Collected revenue"]: row.revenue,
                ROAS: row.roas ?? "",
              })}
            />
          </div>

          {selectedCourse && (
            <CourseDetailPanel
              course={selectedCourse}
              drill={detailQuery.data?.drill ?? null}
              loading={detailQuery.isLoading}
              error={detailQuery.error as Error | null}
            />
          )}
        </>
      )}
    </div>
  );
}

function CourseDetailPanel({
  course,
  drill,
  loading,
  error,
}: {
  course: CourseAgg;
  drill: CourseDrill | null;
  loading: boolean;
  error: Error | null;
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
        <div className="grid gap-3 lg:grid-cols-3">
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
                {lang === "ar"
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
                  <div className="num mt-1 text-base font-semibold text-text">{fmtUSD(spend)}</div>
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
      </div>

      <div>
        <SectionHeading
          icon={<Activity size={18} />}
          title={lang === "ar" ? "الحملات الجاهزة للتشغيل دلوقتي" : "Campaigns eligible to run now"}
          hint={
            lang === "ar"
              ? "الحملة لازم تكون مفعّلة، جدولها مفتوح، وجواها إعلان شغّال. الصرف ظاهر للمعلومة فقط ومش هو اللي بيقرر الحالة."
              : "A campaign must be enabled, currently scheduled, and contain a live ad. Spend is context only and never decides status."
          }
          count={drill.activeCampaigns.length}
        />
        {drill.activeCampaigns.length ? (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
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

      <div>
        <SectionHeading
          icon={<History size={18} />}
          title={lang === "ar" ? "الحملات السابقة للدورة" : "Previous course campaigns"}
          hint={
            lang === "ar"
              ? "حملات ظهرت وصرفت في الفترة المختارة، لكنها مش جاهزة للتشغيل حاليًا."
              : "Campaigns with spend in the selected period that aren't eligible to run now."
          }
          count={drill.previousCampaignCount}
        />
        {drill.previousCampaigns.length ? (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {drill.previousCampaigns.map((campaign) => (
              <CampaignCard key={campaign.key} campaign={campaign} active={false} />
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState
              label={
                lang === "ar"
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
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
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

function CampaignCard({ campaign, active }: { campaign: CourseCampaign; active: boolean }) {
  const { lang } = useI18n();
  const sourceText = campaign.attributionSources
    .map((source) => sourceLabel(source, lang))
    .join("، ");
  return (
    <article className="card flex min-h-[260px] flex-col overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {campaign.platforms.map((platform) => (
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
            ))}
          </div>
          <h4
            className="line-clamp-2 text-sm font-semibold leading-5 text-text"
            title={campaign.name}
          >
            {campaign.name}
          </h4>
        </div>
        <Pill tone={active ? "success" : "neutral"}>
          {active ? (lang === "ar" ? "شغالة" : "Active") : lang === "ar" ? "سابقة" : "Previous"}
        </Pill>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-text-muted">
        <Target size={14} className="shrink-0 text-brand" />
        <span>{lang === "ar" ? "هدفها:" : "Objective:"}</span>
        <strong className="font-semibold text-text">
          {objectiveLabel(campaign.objective, lang)}
        </strong>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
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
          value={active ? fmtUSD(campaign.statusSpend24h) : fmtDate(campaign.spendDateMax, lang)}
        />
        <MobileMetric
          label={lang === "ar" ? "إنفاق الفترة" : "Period spend"}
          value={fmtUSD(campaign.spend)}
        />
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
        <MobileMetric label="ROAS" value={fmtRoas(campaign.roas)} />
      </dl>

      <div className="mt-auto border-t border-border pt-3 text-[11px] leading-5 text-text-muted">
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
  if (objective === "traffic") return lang === "ar" ? "زيارات وترافيك" : "Traffic";
  return lang === "ar" ? "الهدف غير متاح" : "Objective unavailable";
}

function sourceLabel(source: AttributionSource, lang: "ar" | "en") {
  const labels: Record<AttributionSource, { ar: string; en: string }> = {
    ad_name: { ar: "اسم الإعلان", en: "Ad name" },
    adset_name: { ar: "اسم مجموعة الإعلانات", en: "Ad-set name" },
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
