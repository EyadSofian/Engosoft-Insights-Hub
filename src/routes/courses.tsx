import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BadgeDollarSign,
  GraduationCap,
  Info,
  ReceiptText,
  Search,
  ShoppingCart,
  Users,
} from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import { FilterSummary } from "@/components/ads/FilterSummary";
import {
  EmptyState,
  ErrorState,
  KpiCard,
  Notice,
  PageHeader,
  Pill,
  Skeleton,
} from "@/components/ui-bits";
import { fmtNum, fmtPct, fmtRoas, fmtUSD, useI18n } from "@/lib/i18n";
import type { CourseAgg, Totals } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export const Route = createFileRoute("/courses")({ component: Courses });

interface CoursesResponse {
  courses: CourseAgg[];
  totals: Totals;
}

function Courses() {
  const { lang } = useI18n();
  const [search, setSearch] = useState("");
  const { data, isLoading, error, refetch } = useApi<CoursesResponse>("/api/courses");

  const courses = useMemo(() => data?.courses ?? [], [data?.courses]);
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
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="max-w-[240px]">
          <div className="truncate font-semibold text-text" title={row.name}>
            {row.name || "—"}
          </div>
          {row.mainCategory && (
            <div className="mt-0.5 truncate text-[11px] text-text-muted" title={row.mainCategory}>
              {row.mainCategory}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "spend",
      header: lang === "ar" ? "مصروف عليها" : "Ad spend",
      label: lang === "ar" ? "مصروف عليها" : "Ad spend",
      align: "right",
      sortValue: (row) => row.spend,
      render: (row) => <span className="num font-medium">{fmtUSD(row.spend)}</span>,
    },
    {
      key: "crmLeads",
      header: lang === "ar" ? "الليدز" : "CRM leads",
      label: lang === "ar" ? "الليدز" : "CRM leads",
      align: "right",
      sortValue: (row) => row.crmLeads,
      render: (row) => <span className="num">{fmtNum(row.crmLeads)}</span>,
    },
    {
      key: "salesOrders",
      header: lang === "ar" ? "أوامر البيع" : "Sales orders",
      label: lang === "ar" ? "أوامر البيع" : "Sales orders",
      align: "right",
      sortValue: (row) => row.salesOrders,
      render: (row) => <span className="num font-medium">{fmtNum(row.salesOrders)}</span>,
    },
    {
      key: "invoices",
      header: lang === "ar" ? "الفواتير" : "Paid invoices",
      label: lang === "ar" ? "الفواتير" : "Paid invoices",
      align: "right",
      sortValue: (row) => row.invoices,
      render: (row) => <span className="num font-medium">{fmtNum(row.invoices)}</span>,
    },
    {
      key: "revenue",
      header: lang === "ar" ? "المحصل" : "Collected revenue",
      label: lang === "ar" ? "المحصل" : "Collected revenue",
      align: "right",
      sortValue: (row) => row.revenue,
      render: (row) => <span className="num font-semibold">{fmtUSD(row.revenue)}</span>,
    },
    {
      key: "roas",
      header: "ROAS",
      label: "ROAS",
      align: "right",
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
      align: "right",
      hideByDefault: true,
      sortValue: (row) => row.platformLeads ?? -1,
      render: (row) => <span className="num">{fmtNum(row.platformLeads)}</span>,
    },
    {
      key: "won",
      header: lang === "ar" ? "الصفقات المكسبة" : "Won deals",
      label: lang === "ar" ? "الصفقات المكسبة" : "Won deals",
      align: "right",
      hideByDefault: true,
      sortValue: (row) => row.won,
      render: (row) => <span className="num">{fmtNum(row.won)}</span>,
    },
    {
      key: "conversionRate",
      header: lang === "ar" ? "نسبة الإغلاق" : "Close rate",
      label: lang === "ar" ? "نسبة الإغلاق" : "Close rate",
      align: "right",
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
            ? "كل دورة في صف واحد: اتصرف عليها كام، دخل لها كام ليد، وطلّعت كام أمر بيع وفاتورة."
            : "One row per course: ad spend, incoming leads, sales orders and paid invoices."
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
              ? "الإنفاق مربوط بالدورة الغالبة في ليدز كل حملة، والليدز من CRM، وأوامر البيع من Full Invoiced Orders، والفواتير والإيراد من الفواتير المدفوعة. المستند الذي يحتوي أكثر من دورة يظهر مرة داخل كل دورة تخصه."
              : "Spend follows the dominant course inferred from each campaign's leads. Leads come from CRM, sales orders from Full Invoiced Orders, and invoices/revenue from Paid Invoices. A document containing multiple courses is linked once to each relevant course."}
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
                {visibleCourses.map((course) => (
                  <article key={course.key} className="card overflow-hidden p-4">
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
                  </article>
                ))}
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
              initialSort={{ key: "spend", dir: -1 }}
              pageSize={30}
              maxHeight={680}
              columnChooser
              csvFilename="engosoft-courses"
              csvRow={(row) => ({
                [lang === "ar" ? "الدورة" : "Course"]: row.name,
                [lang === "ar" ? "مصروف عليها" : "Ad spend"]: row.spend,
                [lang === "ar" ? "الليدز" : "CRM leads"]: row.crmLeads,
                [lang === "ar" ? "أوامر البيع" : "Sales orders"]: row.salesOrders,
                [lang === "ar" ? "الفواتير" : "Paid invoices"]: row.invoices,
                [lang === "ar" ? "المحصل" : "Collected revenue"]: row.revenue,
                ROAS: row.roas ?? "",
              })}
            />
          </div>
        </>
      )}
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
