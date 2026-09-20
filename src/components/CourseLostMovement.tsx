import { ArrowUpLeft, BookOpen, CalendarClock, UserRound, UsersRound } from "lucide-react";
import { fmtDate, fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import type { CourseLostMovementReport, CourseLostMovementRow } from "@/lib/course-lead-loss";

export function CourseLostMovement({
  report,
  onSelect,
}: {
  report: CourseLostMovementReport;
  onSelect: (row: CourseLostMovementRow) => void;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const peak = Math.max(...report.rows.map((row) => row.lost), 1);
  const range = `${fmtDate(report.range.from, lang)} – ${fmtDate(report.range.to, lang)}`;

  return (
    <section className="overflow-hidden rounded-3xl border border-danger/20 bg-surface shadow-sm">
      <header className="border-b border-border bg-gradient-to-l from-danger-soft/70 via-surface to-surface px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-danger text-white shadow-lg shadow-danger/20">
              <BookOpen size={20} />
            </span>
            <div>
              <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-danger/20 bg-surface/80 px-2.5 py-1 text-[10px] font-bold text-danger">
                <CalendarClock size={12} />
                {A ? "حسب تاريخ الإغلاق" : "By close date"}
              </div>
              <h2 className="text-lg font-bold text-text sm:text-xl">
                {A ? "Lost حسب الكورس" : "Lost by course"}
              </h2>
              <p className="mt-1 text-xs leading-6 text-text-muted">
                {A
                  ? `كل الحالات التي اتقفلت Lost خلال ${range}. اضغط على أي كورس لعرض السجلات وفتحها في Odoo.`
                  : `Every record closed Lost during ${range}. Select a course to inspect its records and open them in Odoo.`}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 lg:min-w-[390px]">
            {[
              [A ? "إجمالي Lost" : "Total Lost", report.totals.lost, "text-danger"],
              [A ? "Lost Leads" : "Lost Leads", report.totals.lostLeads, "text-text"],
              [
                A ? "Lost Opportunities" : "Lost Opportunities",
                report.totals.lostOpportunities,
                "text-text",
              ],
            ].map(([label, value, tone]) => (
              <div
                key={String(label)}
                className="rounded-2xl border border-border bg-surface/90 p-3"
              >
                <p className="text-[9px] font-semibold leading-4 text-text-muted">{label}</p>
                <p className={`num mt-1 text-lg font-bold ${tone}`}>{fmtNum(Number(value))}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="grid gap-2 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
        {report.rows.map((row, index) => (
          <button
            key={row.key}
            type="button"
            onClick={() => onSelect(row)}
            className="group rounded-2xl border border-border bg-surface p-4 text-start transition hover:-translate-y-0.5 hover:border-danger/40 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="num text-[10px] font-bold text-text-subtle">#{index + 1}</span>
                  <h3 className="truncate font-bold text-text" title={row.label}>
                    {row.label}
                  </h3>
                </div>
                {row.course !== row.label && (
                  <p className="mt-0.5 text-[10px] text-text-subtle">Odoo: {row.course}</p>
                )}
              </div>
              <div className="text-end">
                <p className="num text-2xl font-bold text-danger">{fmtNum(row.lost)}</p>
                <p className="num text-[10px] font-semibold text-danger/75">
                  {fmtPct(row.share, 1)}
                </p>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-danger-soft">
              <span
                className="block h-full rounded-full bg-danger transition-all duration-500 group-hover:brightness-95"
                style={{ width: `${Math.max(2, (row.lost / peak) * 100)}%` }}
              />
            </div>
            <div className="mt-3 flex items-center gap-3 text-[10px] text-text-muted">
              <span className="inline-flex items-center gap-1">
                <UserRound size={12} /> {fmtNum(row.lostLeads)} {A ? "ليد" : "Leads"}
              </span>
              <span className="inline-flex items-center gap-1">
                <UsersRound size={12} /> {fmtNum(row.lostOpportunities)} {A ? "فرصة" : "Opps"}
              </span>
              <span className="ms-auto inline-flex items-center gap-1 font-semibold text-danger">
                {A ? "عرض السجلات" : "View records"} <ArrowUpLeft size={12} />
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
