import { useEffect, useId, useState } from "react";
import { CalendarDays, Download, ExternalLink, Search, TableProperties } from "lucide-react";
import { Card, ErrorState, Skeleton } from "@/components/ui-bits";
import { DetailPanel } from "@/components/DetailPanel";
import { fmtNum, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import { filterStore, useFilters } from "@/lib/filter-store";
import type { TeamCourseLeadPage, TeamCourseMatrix } from "@/lib/team-course-leads";

type Selection = { ownerKey: string; name: string; course: string; count: number };
const PAGE_SIZE = 50;
const cellCount = (row: TeamCourseMatrix["rows"][number], course: string) =>
  Object.hasOwn(row.counts, course) ? row.counts[course] : 0;

export function TeamCourseLeadMatrix({
  matrix,
  available,
}: {
  matrix: TeamCourseMatrix | null;
  available: boolean;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const filters = useFilters();
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(filters.from || "");
  const [dateTo, setDateTo] = useState(filters.to || "");
  const [dateError, setDateError] = useState(false);
  const [exportState, setExportState] = useState<"idle" | "working" | "error">("idle");
  const [selected, setSelected] = useState<Selection | null>(null);
  // A drill-down must never outlive the filter scope its number came from.
  useEffect(() => setSelected(null), [filters]);
  useEffect(() => {
    setDateFrom(filters.from || "");
    setDateTo(filters.to || "");
    setDateError(false);
  }, [filters.from, filters.to]);
  const unowned = ar ? "بدون مسؤول حالي" : "No current owner";
  const nameFor = (row: TeamCourseMatrix["rows"][number]) =>
    row.salesperson ? row.displayName : unowned;
  const query = search.trim().toLocaleLowerCase();
  const rows =
    matrix?.rows.filter((row) =>
      [nameFor(row), row.salesperson, ...row.teams].join(" ").toLocaleLowerCase().includes(query),
    ) ?? [];
  const exportTable = async (format: "csv" | "xlsx") => {
    if (!matrix || !available || !rows.length || exportState === "working") return;
    setExportState("working");
    try {
      const { downloadTeamCourseExport } = await import("@/lib/team-course-export");
      await downloadTeamCourseExport({ matrix, rows, filters, lang, search }, format);
      setExportState("idle");
    } catch {
      setExportState("error");
    }
  };
  return (
    <section id="team-course-leads" aria-labelledby="team-course-leads-title">
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-brand/5 p-4 sm:p-6">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2 text-brand">
              <TableProperties size={20} aria-hidden="true" />
              <h2 id="team-course-leads-title" className="text-lg font-bold">
                {ar ? "ليدز كل سيلز حسب الكورس" : "Salespeople × course leads"}
              </h2>
            </div>
            <p className="text-sm leading-6 text-text-muted">
              {ar
                ? "كل رقم هو عدد الليدز، مش نسبة. اضغط عليه لعرض كل السجلات، ثم افتح أي ليد في أودو."
                : "Each number is a lead count, not a percentage. Select it to see every record, then open any lead in Odoo."}
            </p>
          </div>
          {matrix && available && (
            <div className="flex gap-5 text-sm">
              <div>
                <span className="block text-xs text-text-muted">
                  {ar ? "سجلات CRM" : "CRM records"}
                </span>
                <b className="num text-xl text-brand">{fmtNum(matrix.total)}</b>
              </div>
              <div>
                <span className="block text-xs text-text-muted">{ar ? "الكورسات" : "Courses"}</span>
                <b className="num text-xl text-text">{fmtNum(matrix.courses.length)}</b>
              </div>
            </div>
          )}
        </div>
        <div className="border-b border-border bg-surface p-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const valid = (date: string) =>
                /^\d{4}-\d{2}-\d{2}$/.test(date) &&
                Number.isFinite(Date.parse(date)) &&
                new Date(date).toISOString().slice(0, 10) === date;
              if (!valid(dateFrom) || !valid(dateTo) || dateFrom > dateTo) {
                setDateError(true);
                return;
              }
              setDateError(false);
              filterStore.setDates(dateFrom, dateTo);
            }}
          >
            <div className="me-1 text-xs text-text-muted">
              <span className="mb-2 flex items-center gap-1.5 font-semibold text-text">
                <CalendarDays size={15} aria-hidden="true" />
                {ar ? "الفترة — مرتبطة بفلتر الصفحة" : "Period — linked to the page filter"}
              </span>
              <span dir="ltr">
                {filters.range === "all"
                  ? ar
                    ? "كل الفترات"
                    : "All time"
                  : `${filters.from || "…"} → ${filters.to || "…"}`}
              </span>
            </div>
            <label className="grid gap-1 text-xs font-semibold text-text-muted">
              {ar ? "من تاريخ" : "From date"}
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setDateError(false);
                }}
                className="h-10 rounded-xl border border-border bg-surface px-3 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-text-muted">
              {ar ? "إلى تاريخ" : "To date"}
              <input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setDateError(false);
                }}
                className="h-10 rounded-xl border border-border bg-surface px-3 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              />
            </label>
            <button
              type="submit"
              className="min-h-10 rounded-xl bg-brand px-4 text-xs font-bold text-white"
            >
              {ar ? "تطبيق الفترة" : "Apply dates"}
            </button>
            <button
              type="button"
              onClick={() => filterStore.setPreset("all")}
              className="min-h-10 rounded-xl border border-border px-3 text-xs font-semibold text-text-muted"
            >
              {ar ? "كل الفترات" : "All time"}
            </button>
          </form>
          {dateError && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {ar
                ? "اختار تاريخ بداية ونهاية صحيحين؛ النهاية لا تسبق البداية."
                : "Choose valid start and end dates; the end cannot precede the start."}
            </p>
          )}
        </div>
        {!available || !matrix ? (
          <p className="p-6 text-sm text-amber-800" role="status">
            {ar
              ? "بيانات الـLost غير متاحة حاليًا؛ لن نعرض أعدادًا ناقصة على أنها مكتملة."
              : "Lost coverage is unavailable; incomplete counts are not shown as complete."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <label htmlFor={searchId} className="relative block w-full sm:max-w-sm">
                <span className="sr-only">
                  {ar ? "ابحث باسم السيلز أو الفريق" : "Search salesperson or team"}
                </span>
                <Search
                  size={16}
                  className="pointer-events-none absolute start-3 top-3 text-text-muted"
                  aria-hidden="true"
                />
                <input
                  id={searchId}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={ar ? "ابحث باسم السيلز أو الفريق..." : "Search salesperson or team…"}
                  className="h-10 w-full rounded-xl border border-border bg-surface py-2 pe-3 ps-9 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                />
              </label>
              <span className="text-xs text-text-muted">
                {fmtNum(rows.length)}{" "}
                {ar
                  ? "صف · مرّر أفقيًا لباقي الكورسات"
                  : "rows · scroll horizontally for all courses"}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {(["csv", "xlsx"] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    disabled={!rows.length || exportState === "working"}
                    onClick={() => exportTable(format)}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-brand/20 bg-surface px-3 text-xs font-bold text-brand disabled:opacity-40"
                  >
                    <Download size={15} aria-hidden="true" />
                    {format === "csv"
                      ? ar
                        ? "تصدير CSV"
                        : "Export CSV"
                      : ar
                        ? "تصدير Excel"
                        : "Export Excel"}
                  </button>
                ))}
              </div>
            </div>
            <p className="border-b border-border px-4 py-2 text-xs text-text-muted">
              {exportState === "working"
                ? ar
                  ? "جاري تجهيز الملف…"
                  : "Preparing export…"
                : ar
                  ? "التصدير لنفس الفترة والصفوف الظاهرة بعد البحث؛ الأعداد وليست النِسَب."
                  : "Exports the same period and visible rows after search; counts, not percentages."}
            </p>
            {exportState === "error" && (
              <p role="alert" className="px-4 py-2 text-xs text-red-700">
                {ar ? "تعذّر التصدير؛ حاول مرة أخرى." : "Export failed; please try again."}
              </p>
            )}
            {!matrix.courses.length ? (
              <p className="p-8 text-center text-sm text-text-muted">
                {ar ? "لا توجد ليدز ضمن الفلاتر الحالية." : "No leads in the current filter scope."}
              </p>
            ) : (
              <div
                className="max-h-[660px] overflow-auto"
                role="region"
                aria-label={
                  ar ? "جدول ليدز السيلز والكورسات" : "Salesperson and course lead counts"
                }
                tabIndex={0}
              >
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <caption className="sr-only">
                    {ar
                      ? "أعداد سجلات CRM لكل مسؤول حالي ولكل كورس رئيسي؛ الأرقام تفتح السجلات."
                      : "CRM record counts by current owner and primary course. Select a count to open its records."}
                  </caption>
                  <thead className="sticky top-0 z-20">
                    <tr>
                      <th
                        scope="col"
                        className="sticky start-0 z-30 min-w-[180px] border-b border-e border-border bg-surface-2 px-4 py-4 text-start font-semibold text-text sm:min-w-[240px]"
                      >
                        {ar ? "السيلز / الفريق" : "Salesperson / team"}
                      </th>
                      <th
                        scope="col"
                        className="min-w-24 border-b border-border bg-surface-2 px-4 py-4 text-center font-semibold text-brand"
                      >
                        {ar ? "الإجمالي" : "Total"}
                      </th>
                      {matrix.courses.map((course) => (
                        <th
                          key={course.key}
                          scope="col"
                          className="min-w-28 border-b border-border bg-surface-2 px-4 py-4 text-center font-semibold text-text"
                        >
                          {course.key === "غير محدد" && !ar ? "Unspecified" : course.key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} className="group">
                        <th
                          scope="row"
                          className="sticky start-0 z-10 border-b border-e border-border bg-surface px-4 py-3 text-start group-hover:bg-surface-2"
                        >
                          <span
                            className="block max-w-[180px] break-words font-semibold text-text sm:max-w-72"
                            title={row.salesperson || unowned}
                          >
                            {nameFor(row)}
                          </span>
                          <span className="mt-1 block max-w-[180px] text-xs font-normal text-text-muted sm:max-w-72">
                            {row.teams.join(" · ") || "—"}
                          </span>
                        </th>
                        <td className="num border-b border-border bg-brand/5 px-4 py-3 text-center font-bold text-brand">
                          {fmtNum(row.total)}
                        </td>
                        {matrix.courses.map((course) => {
                          const count = cellCount(row, course.key);
                          return (
                            <td
                              key={course.key}
                              className="border-b border-border px-3 py-2 text-center group-hover:bg-brand/5"
                            >
                              {count ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelected({
                                      ownerKey: row.key,
                                      name: nameFor(row),
                                      course: course.key,
                                      count,
                                    })
                                  }
                                  aria-label={
                                    ar
                                      ? `عرض ${count} ليد · ${nameFor(row)} · ${course.key}`
                                      : `View ${count} leads · ${nameFor(row)} · ${course.key}`
                                  }
                                  className="num inline-flex min-h-10 min-w-12 items-center justify-center rounded-lg px-2 font-bold text-brand underline decoration-brand/40 underline-offset-4 transition-colors hover:bg-brand/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                                >
                                  {fmtNum(count)}
                                </button>
                              ) : (
                                <span className="num text-text-subtle">0</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-20">
                    <tr>
                      <th
                        scope="row"
                        className="sticky start-0 z-30 border-t border-e border-border bg-surface-2 px-4 py-4 text-start font-semibold"
                      >
                        {ar ? "إجمالي الصفوف المعروضة" : "Visible row totals"}
                      </th>
                      <td className="num border-t border-border bg-surface-2 px-4 py-4 text-center font-bold text-brand">
                        {fmtNum(rows.reduce((total, row) => total + row.total, 0))}
                      </td>
                      {matrix.courses.map((course) => (
                        <td
                          key={course.key}
                          className="num border-t border-border bg-surface-2 px-4 py-4 text-center font-bold"
                        >
                          {fmtNum(
                            rows.reduce((total, row) => total + cellCount(row, course.key), 0),
                          )}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
                {!rows.length && (
                  <p className="p-6 text-center text-sm text-text-muted">
                    {ar ? "لا يوجد سيلز مطابق للبحث." : "No matching salesperson."}
                  </p>
                )}
              </div>
            )}
            <p className="border-t border-border p-4 text-xs leading-6 text-text-muted">
              {ar
                ? "حسب تاريخ دخول الليد والفلاتر العلوية، والمسؤول الحالي والكورس الرئيسي في أودو. يشمل Lead وOpportunity بكل الحالات، ومنها Won وLost؛ والسجلات المعلّمة مكررة لا تُحذف تلقائيًا. غياب المسؤول لا يعني عدم الاتصال، والعدد ليس عملاء فريدين برقم الهاتف."
                : "Uses creation dates and top-bar filters, current Odoo owner and primary course. Includes Lead/Opportunity in every status, including Won and Lost; recorded duplicates are not silently removed. A missing owner does not mean no contact, and counts are not unique phone identities."}
            </p>
          </>
        )}
      </Card>
      {selected && (
        <LeadCellPanel
          key={`${selected.ownerKey}:${selected.course}`}
          selected={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function LeadCellPanel({ selected, onClose }: { selected: Selection; onClose: () => void }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams({
    ownerKey: selected.ownerKey,
    matrixCourse: selected.course,
    offset: String(offset),
    limit: String(PAGE_SIZE),
  });
  const { data, isLoading, error, refetch } = useApi<TeamCourseLeadPage>(
    `/api/team-course-leads?${params}`,
  );
  const statuses = ar
    ? { lead: "Lead", open: "فرصة نشطة", won: "Won", lost: "Lost" }
    : { lead: "Lead", open: "Open opportunity", won: "Won", lost: "Lost" };
  return (
    <DetailPanel
      open
      onClose={onClose}
      width="min(760px, 100vw)"
      title={`${selected.name} · ${selected.course}`}
      subtitle={
        ar
          ? "كل الليدز وراء الرقم المختار · افتح أي سجل في أودو"
          : "Every lead behind the selected count · open any record in Odoo"
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="num text-text-muted">
            {data
              ? `${data.rows.length ? offset + 1 : 0}–${offset + data.rows.length} / ${fmtNum(data.total)}`
              : fmtNum(selected.count)}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0 || isLoading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded-lg border border-border px-4 py-2 text-text disabled:opacity-40"
            >
              {ar ? "السابق" : "Previous"}
            </button>
            <button
              type="button"
              disabled={!data?.hasNext || isLoading || !!error}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded-lg border border-border px-4 py-2 text-text disabled:opacity-40"
            >
              {ar ? "التالي" : "Next"}
            </button>
          </div>
        </div>
      }
    >
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between rounded-xl border border-brand/20 bg-brand/5 p-4">
            <span className="text-sm font-semibold text-text">
              {ar ? "عدد السجلات في الخانة" : "Records in this cell"}
            </span>
            <b className="num text-2xl text-brand">{fmtNum(data.total)}</b>
          </div>
          {data.total !== selected.count && (
            <p role="status" className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              {ar
                ? `تحدثت البيانات: الجدول كان يعرض ${selected.count}، والعدد الحالي ${data.total}.`
                : `Data updated: the matrix showed ${selected.count}; the current count is ${data.total}.`}
            </p>
          )}
          <ol className="space-y-2">
            {data.rows.map((lead) => (
              <li key={lead.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-text">{lead.contact || `#${lead.id}`}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      <span dir="ltr">
                        #{lead.id} · {lead.createdAt.slice(0, 10)}
                      </span>{" "}
                      · {lead.recordType === "opportunity" ? "Opportunity" : "Lead"}
                    </p>
                  </div>
                  {lead.odooUrl ? (
                    <a
                      href={lead.odooUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-brand/20 px-3 py-2 text-xs font-bold text-brand hover:bg-brand/5"
                    >
                      {ar ? "فتح في أودو" : "Open in Odoo"}
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="text-xs text-text-muted">
                      {ar ? "رابط أودو غير متاح" : "Odoo link unavailable"}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-xs leading-6 text-text-muted">
                  <b className="font-semibold text-text">{statuses[lead.status]}</b> ·{" "}
                  {lead.stage || "—"} · {lead.source || "—"}
                </p>
              </li>
            ))}
          </ol>
          {!data.rows.length && (
            <p className="p-6 text-center text-sm text-text-muted">
              {ar ? "لا توجد سجلات في هذه الصفحة." : "No records on this page."}
            </p>
          )}
        </>
      )}
    </DetailPanel>
  );
}
