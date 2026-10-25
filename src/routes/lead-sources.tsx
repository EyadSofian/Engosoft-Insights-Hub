import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ExternalLink, Grid3X3, Info, Layers3, Search } from "lucide-react";
import { DashboardPageHeader, PageSections } from "@/components/dashboard-bits";
import { DetailPanel } from "@/components/DetailPanel";
import { Card, ErrorState, Skeleton } from "@/components/ui-bits";
import { useApi } from "@/lib/use-api";
import { fmtNum, useI18n } from "@/lib/i18n";
import {
  courseDisplayName,
  recordTypeDisplayName,
  stageDisplayName,
} from "@/lib/lead-distribution-labels";
import type { LeadSourceMatrixResponse } from "@/lib/lead-source-matrix.server";
import { UNSPECIFIED_SOURCE } from "@/lib/lead-source-matrix";

export const Route = createFileRoute("/lead-sources")({ component: LeadSourcesPage });

const focusOrder = ["Recommendation", "WhatsApp Broadcast", "Website", "Snapchat"];
type Selection = { source: string; course?: string };

function sourceLabel(source: string, arabic: boolean) {
  return source === UNSPECIFIED_SOURCE && arabic ? "مصدر غير محدد" : source;
}

function LeadSourcesPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [selected, setSelected] = useState<Selection | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const { data, isLoading, error, refetch } =
    useApi<LeadSourceMatrixResponse>("/api/lead-source-matrix");
  const detailParams = new URLSearchParams(
    selected
      ? {
          matrixSource: selected.source,
          ...(selected.course ? { matrixCourse: selected.course } : {}),
          page: String(page),
        }
      : {},
  );
  const detail = useApi<LeadSourceMatrixResponse>(`/api/lead-source-matrix?${detailParams}`, {
    enabled: Boolean(selected),
  });
  const open = (source: string, course?: string) => {
    setPage(1);
    setSelected({ source, course });
  };
  const rows =
    data?.rows.filter((row) => row.source.toLowerCase().includes(search.trim().toLowerCase())) ??
    [];
  const featured = focusOrder.map(
    (source) =>
      data?.rows.find((row) => row.source === source) ?? {
        source,
        count: 0,
        cells: {},
        featured: true,
      },
  );

  return (
    <PageSections>
      <DashboardPageHeader
        icon={<Grid3X3 size={22} />}
        title={ar ? "مصادر العملاء حسب الدورة" : "Lead sources by course"}
        subtitle={
          ar
            ? "مصفوفة مباشرة من أودو: كل عميل محتمل أو فرصة بيعية يُحسب مرة واحدة حسب المصدر والدورة وتاريخ الإنشاء."
            : "Live Odoo matrix: every lead or opportunity is counted once by source, course and creation date."
        }
        tone="sky"
        period={data ? `${data.period.from} → ${data.period.to}` : undefined}
      />

      {error ? (
        <ErrorState
          message={ar ? "تعذّر جلب توزيع المصادر من أودو." : String(error)}
          onRetry={() => refetch()}
        />
      ) : isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-[520px]" />
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="border-s-4 border-s-blue-600">
              <div className="text-xs font-semibold text-text-muted">
                {ar ? "العملاء المحتملون المحسوبون" : "Counted potential leads"}
              </div>
              <div className="num mt-2 text-3xl font-bold text-text">
                {fmtNum(data.eligibleTotal)}
              </div>
              <p className="mt-2 text-xs text-text-muted">
                {ar
                  ? "بدون Recommendation وWhatsApp Broadcast"
                  : "Excludes Recommendation and WhatsApp Broadcast"}
              </p>
            </Card>
            <Card className="border-s-4 border-s-rose-500">
              <div className="text-xs font-semibold text-text-muted">
                {ar ? "مصادر ظاهرة خارج العدّ" : "Visible but excluded sources"}
              </div>
              <div className="num mt-2 text-3xl font-bold text-text">
                {fmtNum(data.excludedTotal)}
              </div>
              <p className="mt-2 text-xs text-text-muted">
                {ar ? "يمكن فتح سجلاتها أدناه" : "Their records remain accessible below"}
              </p>
            </Card>
            <Card className="border-s-4 border-s-emerald-600">
              <div className="text-xs font-semibold text-text-muted">
                {ar ? "السجلات الخام بدون Snapchat" : "Raw records excluding Snapchat"}
              </div>
              <div className="num mt-2 text-3xl font-bold text-text">
                {fmtNum(data.withoutSnapchat)}
              </div>
              <p className="mt-2 text-xs text-text-muted">
                {ar ? "الإجمالي − صف Snapchat فقط" : "Total minus the Snapchat row only"}
              </p>
            </Card>
            <Card className="border-s-4 border-s-amber-500">
              <div className="text-xs font-semibold text-text-muted">
                {ar ? "بدون مصدر محدد" : "Unspecified source"}
              </div>
              <div className="num mt-2 text-3xl font-bold text-text">
                {fmtNum(data.unspecifiedSource)}
              </div>
              <p className="mt-2 text-xs text-text-muted">
                {ar
                  ? "تظهر كسطر مستقل حتى لا تختفي من الإجمالي"
                  : "Shown separately so they remain in the total"}
              </p>
            </Card>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {featured.map((row) => (
              <button
                key={row.source}
                type="button"
                onClick={() => open(row.source)}
                className="group rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-start shadow-sm transition hover:-translate-y-0.5 hover:border-rose-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
              >
                <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-[12px] font-bold text-rose-800">
                  {row.source}
                </span>
                <span className="num mt-3 block text-2xl font-bold text-rose-950">
                  {fmtNum(row.count)}
                </span>
                <span className="mt-1 block text-xs text-rose-700">
                  {ar ? "اضغط لعرض السجلات" : "View records"}
                </span>
              </button>
            ))}
          </div>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
              <div>
                <h2 className="font-bold text-text">
                  {ar ? "المصادر × الدورات" : "Sources × courses"}
                </h2>
                <p className="mt-1 text-xs text-text-muted">
                  {ar
                    ? "اضغط على أي رقم لعرض سجلات أودو المكوّنة له."
                    : "Select any count to inspect its Odoo records."}
                </p>
              </div>
              <label className="relative block w-full sm:w-64">
                <Search size={16} className="absolute inset-y-0 my-auto ms-3 text-text-muted" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={ar ? "بحث عن مصدر" : "Find a source"}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 ps-10 text-sm text-text outline-none focus:border-brand"
                />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
                <thead className="bg-surface-2 text-text-muted">
                  <tr>
                    <th
                      scope="col"
                      className="sticky start-0 z-20 min-w-40 border-b border-e border-border bg-surface-2 px-4 py-3 text-start text-xs font-bold"
                    >
                      {ar ? "المصدر" : "Source"}
                    </th>
                    {data.courses.map((course) => (
                      <th
                        key={course}
                        scope="col"
                        className={`min-w-20 border-b border-border px-3 py-3 text-center text-xs font-bold ${["CFM", "CMRP", "PMP", "BIM", "Interior", "Auto"].includes(course) ? "bg-emerald-50 text-emerald-800" : ""}`}
                      >
                        <bdi>{courseDisplayName(course, false)}</bdi>
                      </th>
                    ))}
                    <th
                      scope="col"
                      className="sticky end-0 z-20 min-w-24 border-b border-s border-border bg-blue-50 px-3 py-3 text-center text-xs font-bold text-blue-900"
                    >
                      {ar ? "إجمالي السجلات" : "Raw records"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.source}
                      className={row.featured ? "bg-rose-50/60" : "hover:bg-surface-2/60"}
                    >
                      <th
                        scope="row"
                        className={`sticky start-0 z-10 border-b border-e border-border px-4 py-3 text-start font-semibold ${row.featured ? "bg-rose-50 text-rose-800" : "bg-surface text-text"}`}
                      >
                        {sourceLabel(row.source, ar)}
                      </th>
                      {data.courses.map((course) => (
                        <td
                          key={course}
                          className="num border-b border-border px-3 py-3 text-center tabular-nums"
                        >
                          {row.cells[course] ? (
                            <button
                              type="button"
                              onClick={() => open(row.source, course)}
                              aria-label={`${row.source} · ${courseDisplayName(course, false)} · ${row.cells[course]}`}
                              className={`min-w-8 rounded-lg px-2 py-1 font-semibold transition hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-brand ${row.featured ? "text-rose-800" : "text-brand"}`}
                            >
                              {fmtNum(row.cells[course])}
                            </button>
                          ) : (
                            <span className="text-text-subtle">—</span>
                          )}
                        </td>
                      ))}
                      <td className="num sticky end-0 z-10 border-b border-s border-border bg-blue-50 px-3 py-3 text-center font-bold tabular-nums">
                        <button
                          type="button"
                          onClick={() => open(row.source)}
                          className="rounded-lg px-2 py-1 text-blue-800 hover:bg-blue-100"
                        >
                          {fmtNum(row.count)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-900 font-bold text-white">
                    <th
                      scope="row"
                      className="sticky start-0 z-10 bg-slate-900 px-4 py-3 text-start"
                    >
                      {ar ? "إجمالي السجلات الخام" : "Raw record total"}
                    </th>
                    {data.courses.map((course) => (
                      <td key={course} className="num px-3 py-3 text-center tabular-nums">
                        {fmtNum(data.courseTotals[course])}
                      </td>
                    ))}
                    <td className="num sticky end-0 z-10 bg-slate-900 px-3 py-3 text-center tabular-nums">
                      {fmtNum(data.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              {!rows.length && (
                <div className="px-5 py-10 text-center text-sm text-text-muted">
                  {ar ? "لا يوجد مصدر مطابق" : "No matching source"}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-start gap-2 border-t border-border bg-surface-2/40 px-4 py-3 text-xs leading-6 text-text-muted sm:px-5">
              <Info size={16} className="mt-1 shrink-0" />
              <span>
                {ar
                  ? `جدول المصادر يعرض كل ${fmtNum(data.total)} سجل خام للرجوع إليها، لكن إجمالي العملاء المحتملين في مؤشرات الأداء هو ${fmtNum(data.eligibleTotal)} فقط. Recommendation وWhatsApp Broadcast ظاهران هنا ولا يدخلان في عدّ العملاء أو تارجتهم. WhatsApp العادي يظل محسوبًا.`
                  : `The source table keeps all ${fmtNum(data.total)} raw records for inspection, but lead KPIs count only ${fmtNum(data.eligibleTotal)}. Recommendation and WhatsApp Broadcast stay visible here without entering lead totals or targets. Plain WhatsApp remains counted.`}
              </span>
            </div>
          </Card>
          {data.sixDayPlan && (
            <Card className="border-s-4 border-s-amber-500">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-text">
                    {ar ? "مرجع خطة أكتوبر: هدف 6 أيام" : "October plan reference: six-day target"}
                  </h2>
                  <p className="mt-1 text-xs leading-6 text-text-muted">
                    {ar
                      ? `محسوب من هدف الشهر ÷ ${data.sixDayPlan.workingDays} يوم عمل × 6، والخطة ${data.sixDayPlan.status === "draft" ? "مسودة" : "معتمدة"}. ليس مقارنة مباشرة مع الفترة المعروضة أعلاه.`
                      : `Monthly target ÷ ${data.sixDayPlan.workingDays} working days × 6. Plan status: ${data.sixDayPlan.status}. This is not a direct comparison with the selected period above.`}
                  </p>
                </div>
                <a
                  href="/media-plan"
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand hover:bg-brand/10"
                >
                  <ExternalLink size={13} />
                  {ar ? "فتح خطة الميديا" : "Open media plan"}
                </a>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
                {data.sixDayPlan.courses.map((course) => (
                  <div key={course.label} className="rounded-xl bg-amber-50 px-3 py-2">
                    <div className="text-xs font-semibold text-amber-900">{course.label}</div>
                    <div className="num mt-1 text-lg font-bold text-text">
                      {fmtNum(course.target)}
                    </div>
                  </div>
                ))}
                <div className="rounded-xl bg-slate-900 px-3 py-2 text-white">
                  <div className="text-xs font-semibold">{ar ? "الإجمالي" : "Total"}</div>
                  <div className="num mt-1 text-lg font-bold">{fmtNum(data.sixDayPlan.total)}</div>
                </div>
              </div>
            </Card>
          )}
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 text-xs leading-6 text-slate-700">
            <div className="inline-flex items-center gap-2 font-bold">
              <Layers3 size={15} />
              {ar ? "طريقة القراءة" : "How to read"}
            </div>
            <p className="mt-1">
              {ar
                ? "الصف = Source المحفوظ على سجل CRM في أودو؛ نوعا Recommended From Customer وRecommendation Sales مجتمعان تحت Recommendation، ويظهر الاسم الأصلي في تفاصيل الليد. العمود = الدورة من Course Categories. السجلات غير المحددة تظهر مستقلة. الأحمر للإبراز فقط."
                : "Rows use the CRM Source in Odoo. Recommended From Customer and Recommendation Sales roll up to Recommendation; the original name remains in each lead's details. Columns use Course Categories. Unassigned records stay visible. Red is only a visual highlight."}
            </p>
          </div>
        </>
      )}

      <DetailPanel
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={
          selected
            ? `${sourceLabel(selected.source, ar)}${selected.course ? ` · ${courseDisplayName(selected.course, false)}` : ""}`
            : ""
        }
        subtitle={
          selected
            ? `${fmtNum(detail.data?.detail?.total ?? 0)} ${ar ? "سجل" : "records"}`
            : undefined
        }
        width="min(670px, 100vw)"
      >
        {detail.isLoading ? (
          <Skeleton className="h-80" />
        ) : detail.error ? (
          <ErrorState
            message={ar ? "تعذّر فتح السجلات." : String(detail.error)}
            onRetry={() => detail.refetch()}
          />
        ) : (
          <div className="space-y-2">
            {detail.data?.detail?.rows.map((record) => (
              <div key={record.id} className="rounded-xl border border-border bg-surface-2/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-text">
                      {record.contact}{" "}
                      <span className="num text-xs font-normal text-text-muted">#{record.id}</span>
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      {recordTypeDisplayName(record.recordType, ar)} ·{" "}
                      {stageDisplayName(record.stage, ar)} · {record.createdAt.slice(0, 10)}
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      {ar ? "الدورة" : "Course"}: {courseDisplayName(record.course, false)} ·{" "}
                      {ar ? "المصدر" : "Source"}:{" "}
                      {sourceLabel(matrixSourceLabel(record.source), ar)}
                    </div>
                  </div>
                  <a
                    href={record.odooUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10"
                  >
                    <ExternalLink size={13} />
                    {ar ? "فتح في أودو" : "Open in Odoo"}
                  </a>
                </div>
              </div>
            ))}
            {detail.data?.detail && detail.data.detail.total > detail.data.detail.pageSize && (
              <div className="flex items-center justify-between gap-3 py-3 text-xs text-text-muted">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                  className="rounded-lg border border-border px-3 py-2 disabled:opacity-40"
                >
                  {ar ? "السابق" : "Previous"}
                </button>
                <span>
                  {fmtNum(page)} /{" "}
                  {fmtNum(Math.ceil(detail.data.detail.total / detail.data.detail.pageSize))}
                </span>
                <button
                  type="button"
                  disabled={page * detail.data.detail.pageSize >= detail.data.detail.total}
                  onClick={() => setPage(page + 1)}
                  className="rounded-lg border border-border px-3 py-2 disabled:opacity-40"
                >
                  {ar ? "التالي" : "Next"}
                </button>
              </div>
            )}
          </div>
        )}
      </DetailPanel>
    </PageSections>
  );
}

function matrixSourceLabel(source: string) {
  return source.trim() || UNSPECIFIED_SOURCE;
}
