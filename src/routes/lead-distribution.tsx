import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Trophy, UsersRound, Info } from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard-bits";
import { Card, ErrorState, Notice, Pill, SectionTitle, Skeleton } from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import {
  nextDistributionMonth,
  type LeadRankingResult,
  type LeadRankingRow,
} from "@/lib/lead-ranking";

export const Route = createFileRoute("/lead-distribution")({ component: LeadDistribution });

export function LeadDistribution() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [month, setMonth] = useState(() => nextDistributionMonth());
  useRegisterNexusView("lead_distribution", { parameters: { month } });
  const [specialization, setSpecialization] = useState("");
  const [course, setCourse] = useState("");
  const query = useQuery<
    LeadRankingResult & { health: { crm: string; lost: string; accounting: string } }
  >({
    queryKey: ["lead-ranking", month],
    queryFn: async () => {
      const response = await fetch(`/api/lead-ranking?month=${encodeURIComponent(month)}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error ??
            (response.status === 401
              ? ar
                ? "انتهت جلسة الدخول. أعد تسجيل الدخول."
                : "Please sign in again."
              : `Request failed: ${response.status}`),
        );
      }
      return response.json();
    },
    staleTime: 30_000,
  });
  const data = query.data;
  const specialties = [...new Set(data?.groups.map((group) => group.specialization) ?? [])];
  const selectedSpec = specialties.includes(specialization)
    ? specialization
    : (specialties[0] ?? "");
  const courseGroups =
    data?.groups.filter(
      (group) => group.specialization === selectedSpec && group.course !== null,
    ) ?? [];
  const selectedCourse = courseGroups.some((group) => group.key === course) ? course : "";
  const group = data?.groups.find(
    (item) =>
      item.specialization === selectedSpec &&
      (selectedCourse ? item.key === selectedCourse : item.course === null),
  );
  const rows = group?.rows ?? [];
  const winner = rows.find((row) => row.rank === 1);
  const jointWinners = rows.filter((row) => row.rank === 1).length;
  const inputClass =
    "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand";
  const cols: Col<LeadRankingRow>[] = [
    {
      key: "rank",
      header: ar ? "الترتيب" : "Rank",
      render: (row) =>
        row.rank === null ? (
          "—"
        ) : (
          <Pill tone={row.rank === 1 ? "success" : "neutral"}>#{row.rank}</Pill>
        ),
      sortValue: (row) => row.rank ?? Number.MAX_SAFE_INTEGER,
      width: "85px",
    },
    {
      key: "name",
      header: ar ? "الموظف" : "Employee",
      render: (row) => (
        <span>
          <span className="block font-medium">{row.name}</span>
          <span className="block text-xs text-text-muted">{row.teams.join(" · ")}</span>
        </span>
      ),
      sortValue: (row) => row.name,
      sticky: true,
      always: true,
    },
    {
      key: "score",
      header: ar ? "الدرجة / 100" : "Score / 100",
      render: (row) =>
        row.score === null ? (
          <span className="text-text-muted">{ar ? "بيانات غير كافية" : "Insufficient data"}</span>
        ) : (
          <div className="min-w-24">
            <span className="num font-semibold">{row.score.toFixed(2)}</span>
            <div className="mt-1 h-1.5 rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-brand" style={{ width: `${row.score}%` }} />
            </div>
          </div>
        ),
      sortValue: (row) => row.score ?? -1,
      align: "right",
    },
    {
      key: "revenue",
      header: ar ? "المبيعات المحصّلة" : "Collected revenue",
      render: (row) => fmtUSDFull(row.revenue),
      sortValue: (row) => row.revenue,
      align: "right",
    },
    {
      key: "invoices",
      header: ar ? "الفواتير" : "Invoices",
      render: (row) => fmtNum(row.invoices),
      sortValue: (row) => row.invoices,
      align: "right",
    },
    {
      key: "leads",
      header: ar ? "الليدز المسندة" : "Assigned leads",
      render: (row) => fmtNum(row.leads),
      sortValue: (row) => row.leads,
      align: "right",
    },
    {
      key: "won",
      header: ar ? "ليدز أصبحت عملاء" : "Won leads",
      render: (row) => fmtNum(row.won),
      sortValue: (row) => row.won,
      align: "right",
    },
    {
      key: "conversion",
      header: ar ? "نسبة التحويل" : "Conversion rate",
      render: (row) => (
        <span>
          {fmtPct(row.conversionRate, 2)}
          <span className="block text-[11px] text-text-muted">
            {row.undatedWon > 0
              ? ar
                ? `${row.undatedWon} Won بلا تاريخ`
                : `${row.undatedWon} undated wins`
              : row.leads > 0 && row.leads < 20
                ? ar
                  ? "عينة صغيرة"
                  : "Small sample"
                : `${row.won} / ${row.leads}`}
          </span>
        </span>
      ),
      sortValue: (row) => row.conversionRate ?? -1,
      align: "right",
    },
    {
      key: "points",
      header: ar ? "نقاط: مبيعات / فواتير / تحويل" : "Points: revenue / invoices / conversion",
      render: (row) => (
        <span className="num" dir="ltr">
          {row.components.revenue.toFixed(2)} / {row.components.invoices.toFixed(2)} /{" "}
          {row.components.conversion.toFixed(2)}
        </span>
      ),
      sortValue: (row) => row.score ?? -1,
      align: "right",
    },
  ];
  return (
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<UsersRound size={20} />}
        title={ar ? "توزيع الليدز · ترتيب الموظفين" : "Lead distribution · employee ranking"}
        subtitle={
          ar
            ? "أداء كل موظف داخل التخصص والكورس خلال الستة أشهر السابقة لشهر التوزيع."
            : "Employee performance within each specialty and course across the six months before distribution."
        }
      />
      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-2">
            <span className="text-xs font-semibold text-text-muted">
              {ar ? "شهر التوزيع" : "Distribution month"}
            </span>
            <input
              type="month"
              min="2000-01"
              max="2100-12"
              value={month}
              className={inputClass}
              onChange={(event) => {
                if (event.target.value) setMonth(event.target.value);
              }}
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold text-text-muted">
              {ar ? "التخصص" : "Specialization"}
            </span>
            <select
              className={inputClass}
              value={selectedSpec}
              onChange={(event) => {
                setSpecialization(event.target.value);
                setCourse("");
              }}
            >
              <option value="" disabled>
                {ar ? "اختر تخصصًا" : "Choose a specialty"}
              </option>
              {specialties.map((spec) => (
                <option key={spec} value={spec}>
                  {spec}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold text-text-muted">
              {ar ? "الكورس" : "Course"}
            </span>
            <select
              className={inputClass}
              value={selectedCourse}
              onChange={(event) => setCourse(event.target.value)}
            >
              <option value="">{ar ? "كل كورسات التخصص" : "Whole specialization"}</option>
              {courseGroups.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.course}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-4 flex items-center gap-2 text-xs text-text-muted">
          <CalendarRange size={15} />
          {data ? (
            <span>
              {ar ? "فترة التحليل:" : "Analysis window:"}{" "}
              <span dir="ltr">
                {data.window.from} → {data.window.to}
              </span>
            </span>
          ) : ar ? (
            "ستة أشهر تقويمية كاملة قبل شهر التوزيع."
          ) : (
            "Six complete calendar months before distribution."
          )}
        </p>
        <p className="mt-2 text-xs text-text-muted">
          {ar
            ? "هذه الصفحة تعتمد على شهر التوزيع أعلاه، مستقلًا عن فلاتر التاريخ والموظفين والإعلانات العامة."
            : "This page uses its distribution month independently of global date, employee and ad filters."}
        </p>
      </Card>
      {query.error ? (
        <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />
      ) : query.isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="card-grid md:grid-cols-3">
            <Card>
              <SectionTitle>
                {jointWinners > 1
                  ? ar
                    ? "أحد أصحاب المركز الأول"
                    : "Joint first place"
                  : ar
                    ? "الأول في النطاق المختار"
                    : "Top employee in this scope"}
              </SectionTitle>
              <div className="flex items-center gap-3">
                <Trophy className="text-brand" size={24} />
                <div>
                  <p className="text-xl font-semibold">{winner?.name ?? "—"}</p>
                  <p className="text-xs text-text-muted mt-1">
                    {winner
                      ? `${winner.score!.toFixed(2)} / 100 · ${selectedSpec}`
                      : ar
                        ? "لا يتوفر ترتيب مكتمل المعايير"
                        : "No complete ranking available"}
                  </p>
                </div>
              </div>
            </Card>
            <Card>
              <SectionTitle>{ar ? "الموظفون في النطاق" : "Employees in this scope"}</SectionTitle>
              <p className="num text-3xl font-semibold">{fmtNum(rows.length)}</p>
              <p className="text-xs text-text-muted mt-2">
                {fmtNum(rows.filter((row) => row.rank !== null).length)}{" "}
                {ar ? "موظف له ترتيب محسوب" : "employees with a calculated rank"}
              </p>
            </Card>
            <Card>
              <SectionTitle>{ar ? "أوزان الترتيب" : "Ranking weights"}</SectionTitle>
              <div className="flex gap-6">
                {[
                  [ar ? "المبيعات" : "Revenue", data.weights.revenue],
                  [ar ? "الفواتير" : "Invoices", data.weights.invoices],
                  [ar ? "التحويل" : "Conversion", data.weights.conversion],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="num text-2xl font-semibold">{value}%</p>
                    <p className="text-xs text-text-muted mt-1">{label}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          {data.coverage &&
            (data.coverage.monthsWithoutLeads.length > 0 ||
              data.coverage.monthsWithoutInvoices.length > 0) && (
              <Notice tone="warning">
                {ar
                  ? "لا توجد سجلات في بعض أشهر التحليل؛ تحقق من تغطية المصدر قبل اعتماد التوزيع."
                  : "Some analysis months have no records; verify source coverage before approving allocation."}{" "}
                {ar ? "أشهر بلا ليدز:" : "Months without leads:"}{" "}
                {data.coverage.monthsWithoutLeads.join(", ") || "—"} ·{" "}
                {ar ? "أشهر بلا فواتير:" : "Months without invoices:"}{" "}
                {data.coverage.monthsWithoutInvoices.join(", ") || "—"}
              </Notice>
            )}
          <details className="card p-3.5 sm:p-5">
            <summary className="cursor-pointer text-sm font-semibold">
              {ar ? "طريقة الحساب ومصادر البيانات" : "Calculation and data sources"}
            </summary>
            <div className="mt-4 space-y-3">
              <Notice tone="info" icon={<Info size={16} />}>
                {ar
                  ? "الدرجة = 50 × مبيعات الموظف ÷ أعلى مبيعات + 25 × فواتيره ÷ أعلى عدد فواتير + 25 × نسبة تحويله ÷ أعلى نسبة تحويل، داخل نفس النطاق. المبيعات هي صافي USD Paid حسب تاريخ التحصيل، والمرتجعات تخفضها. الفواتير المدفوعة تُعد مرة واحدة لكل موظف داخل التخصص أو الكورس؛ المرتجعات ليست فواتير بيع. نسبة التحويل = Won بتاريخ قبل شهر التوزيع ÷ كل الليدز المنشأة في فترة التحليل، بما فيها Lost."
                  : "Score = 50 × revenue / highest revenue + 25 × invoices / highest invoice count + 25 × conversion / highest conversion, within this scope. Revenue is net USD Paid by payment date; refunds reduce it. Paid invoices count once per employee within a specialty or course, excluding credit notes. Conversion = cohort leads won before distribution / all leads created in the analysis window, including Lost."}
              </Notice>
              <Notice tone="warning">
                {ar
                  ? "الإسناد والتخصص يعكسان السجلات المتاحة حاليًا؛ لا يوجد سجل كامل لنقل الليد بين الموظفين أو تغير حالته تاريخيًا. Won بعد نهاية الفترة لا يدخل الحساب، وWon بلا تاريخ أو غياب Lost يمنعان حساب ترتيب مكتمل. ربط الكورس يعتمد على تطابق اسمه بين CRM والفاتورة؛ الليد بلا كورس مطابق يبقى في إجمالي التخصص. الترتيب يعرض أساس القرار؛ تنفيذ الإسناد الفعلي لليدز مرحلة لاحقة."
                  : "Ownership and specialty reflect currently available records; complete historical reassignment and status changes are unavailable. Wins after the cutoff are excluded; undated wins or unavailable Lost prevent a complete score. Course-level leads require an exact CRM/invoice course-name match; unmatched leads remain in specialty totals. This ranking supports allocation decisions; actual lead assignment is a later phase."}
              </Notice>
              <p className="text-xs text-text-muted">
                CRM: {data.health.crm} · Lost: {data.health.lost} · Accounting:{" "}
                {data.health.accounting}
              </p>
            </div>
          </details>
          {data.diagnostics.unmatchedCourseLeads > 0 && selectedCourse && (
            <Notice tone="warning">
              {ar
                ? `يوجد ${fmtNum(data.diagnostics.unmatchedCourseLeads)} ليد في فترة التحليل بلا كورس مطابق في بيانات الفواتير. هذه الليدز تدخل إجمالي التخصص فقط؛ نسبة تحويل الكورس تخص الليدز المرتبطة باسمه بدقة.`
                : `${fmtNum(data.diagnostics.unmatchedCourseLeads)} leads in the analysis window have no matching invoice course. They remain in specialty totals; course conversion covers only leads linked to its exact name.`}
            </Notice>
          )}
          {(data.diagnostics.unclassifiedLeads > 0 ||
            data.diagnostics.unassignedLeads > 0 ||
            data.diagnostics.unclassifiedRevenue !== 0 ||
            data.diagnostics.unassignedRevenue !== 0 ||
            data.diagnostics.missingInvoiceIds > 0 ||
            data.diagnostics.missingLeadIds > 0 ||
            data.health.lost === "unavailable") && (
            <Notice tone="warning">
              {ar ? "تغطية البيانات:" : "Data coverage:"}{" "}
              {ar ? "ليدز بلا موظف" : "Unassigned leads"}: {data.diagnostics.unassignedLeads} ·{" "}
              {ar ? "ليدز بلا تخصص" : "Unclassified leads"}: {data.diagnostics.unclassifiedLeads} ·{" "}
              {ar ? "مبيعات بلا موظف" : "Unassigned revenue"}:{" "}
              {fmtUSDFull(data.diagnostics.unassignedRevenue)} ·{" "}
              {ar ? "مبيعات بلا تخصص" : "Unclassified revenue"}:{" "}
              {fmtUSDFull(data.diagnostics.unclassifiedRevenue)} ·{" "}
              {ar ? "بنود بلا رقم فاتورة" : "Lines without invoice IDs"}:{" "}
              {data.diagnostics.missingInvoiceIds} · {ar ? "ليدز بلا رقم" : "Leads without IDs"}:{" "}
              {data.diagnostics.missingLeadIds} · Lost: {data.health.lost}
            </Notice>
          )}
          <Card>
            <SectionTitle
              hint={
                group?.course ??
                (ar
                  ? "إجمالي التخصص؛ عدد الفواتير لا يساوي مجموع أعدادها على الكورسات."
                  : "Specialty totals; invoice counts cannot be summed across courses.")
              }
            >
              {ar ? "ترتيب الموظفين" : "Employee ranking"} · {selectedSpec || "—"}
            </SectionTitle>
            {rows.length === 0 ? (
              <p className="py-10 text-center text-text-muted">
                {ar
                  ? "لا توجد بيانات لهذا الشهر. اختر شهرًا تتوفر له بيانات الستة أشهر السابقة."
                  : "No data for this month. Choose a month with available prior history."}
              </p>
            ) : (
              <DataTable
                key={group?.key}
                rows={rows}
                cols={cols}
                searchable={(row) => `${row.name} ${row.teams.join(" ")}`}
                pageSize={25}
                initialSort={{ key: "rank", dir: 1 }}
                csvFilename={`engosoft-lead-ranking-${month}-${selectedSpec}`}
                csvRow={(row) => ({
                  distribution_month: month,
                  history_from: data.window.from,
                  history_to: data.window.to,
                  specialization: selectedSpec,
                  course: group?.course ?? "",
                  employee: row.name,
                  rank: row.rank ?? "",
                  score: row.score ?? "",
                  net_paid_usd: row.revenue,
                  distinct_paid_invoices: row.invoices,
                  assigned_leads: row.leads,
                  won_leads: row.won,
                  undated_won: row.undatedWon,
                  conversion_pct: row.conversionRate ?? "",
                  revenue_points: row.components.revenue,
                  invoice_points: row.components.invoices,
                  conversion_points: row.components.conversion,
                })}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
