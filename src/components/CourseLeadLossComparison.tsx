import { ArrowDownRight, ArrowUpRight, BookOpenCheck, Minus, Users } from "lucide-react";
import { fmtDate, fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import type { CourseLeadLossReport, CourseLeadLossRow } from "@/lib/course-lead-loss";

const rangeLabel = (range: CourseLeadLossReport["currentRange"] | null, lang: "ar" | "en") =>
  range?.from && range?.to
    ? `${fmtDate(range.from, lang)} – ${fmtDate(range.to, lang)}`
    : lang === "ar"
      ? "الفترة غير محددة"
      : "Range unavailable";

function Delta({ row }: { row: Pick<CourseLeadLossRow, "leadDelta" | "leadDeltaRate"> }) {
  const positive = row.leadDelta > 0;
  const negative = row.leadDelta < 0;
  const Icon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus;
  return (
    <span
      className={`num inline-flex items-center justify-end gap-1 font-semibold ${
        positive ? "text-success" : negative ? "text-danger" : "text-text-muted"
      }`}
    >
      <Icon size={13} />
      {row.leadDelta > 0 ? "+" : ""}
      {fmtNum(row.leadDelta)}
      <span className="text-[10px] font-normal opacity-75">({fmtPct(row.leadDeltaRate, 1)})</span>
    </span>
  );
}

export function CourseLeadLossComparison({ report }: { report: CourseLeadLossReport }) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const previous = report.previousRange;

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
      <div className="border-b border-border bg-gradient-to-l from-brand-soft/70 via-surface to-danger-soft/35 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/20">
                <BookOpenCheck size={20} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
                  {A ? "Course cohort" : "Course cohort"}
                </p>
                <h2 className="text-lg font-bold text-text sm:text-xl">
                  {A ? "الليدز والخسائر حسب الكورس" : "Leads and losses by course"}
                </h2>
              </div>
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-6 text-text-muted">
              {A
                ? "Leads = كل سجلات CRM المنشأة في الفترة. Lost = الجزء الذي انتهى Lost من نفس كوهورت الإنشاء، وليس ما أُغلق خلال الفترة."
                : "Leads are all CRM records created in the range. Lost is the subset of that same creation cohort that ended Lost, not everything closed during the range."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex">
            <div className="rounded-2xl border border-brand/15 bg-surface/85 px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted">
                <Users size={12} />
                {A ? "Leads الفترة" : "Period leads"}
              </div>
              <div className="num mt-1 text-xl font-bold text-brand">
                {fmtNum(report.totals.leads)}
              </div>
            </div>
            <div className="rounded-2xl border border-danger/15 bg-surface/85 px-4 py-3">
              <div className="text-[10px] font-semibold text-text-muted">
                {A ? "Lost من نفس الليدز" : "Lost from those leads"}
              </div>
              <div className="num mt-1 text-xl font-bold text-danger">
                {fmtNum(report.totals.lost)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="scroll-hint-x overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/55 text-[10px] uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 text-start sm:px-6">{A ? "الكورس" : "Course"}</th>
              <th className="px-3 py-3 text-end">
                <span className="block">{A ? "Leads دخلت" : "Leads entered"}</span>
                <span className="num mt-0.5 block font-normal normal-case tracking-normal text-text-subtle">
                  {rangeLabel(report.currentRange, lang)}
                </span>
              </th>
              <th className="px-3 py-3 text-end">
                <span className="block">Lost</span>
                <span className="mt-0.5 block font-normal normal-case tracking-normal text-text-subtle">
                  {A ? "من نفس كوهورت الإنشاء" : "Same creation cohort"}
                </span>
              </th>
              <th className="px-3 py-3 text-end">{A ? "نسبة Lost" : "Lost rate"}</th>
              <th className="px-3 py-3 text-end">
                <span className="block">{A ? "Leads الشهر السابق" : "Previous leads"}</span>
                <span className="num mt-0.5 block font-normal normal-case tracking-normal text-text-subtle">
                  {rangeLabel(previous, lang)}
                </span>
              </th>
              <th className="px-4 py-3 text-end sm:px-6">{A ? "الفرق" : "Change"}</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr
                key={row.key}
                className="border-b border-border/75 transition-colors hover:bg-brand-soft/20"
              >
                <td className="px-4 py-3.5 sm:px-6">
                  <div className="font-semibold text-text">{row.label}</div>
                  {row.course !== row.label && (
                    <div className="mt-0.5 text-[10px] text-text-subtle">Odoo: {row.course}</div>
                  )}
                </td>
                <td className="num px-3 py-3.5 text-end text-base font-semibold text-text">
                  {fmtNum(row.leads)}
                </td>
                <td className="px-3 py-3.5 text-end">
                  <div className="num text-base font-semibold text-danger">{fmtNum(row.lost)}</div>
                  <div className="mt-0.5 whitespace-nowrap text-[10px] text-text-subtle">
                    {fmtNum(row.lostLeads)} Lead · {fmtNum(row.lostOpportunities)} Opportunity
                  </div>
                </td>
                <td className="num px-3 py-3.5 text-end font-medium text-text">
                  {fmtPct(row.lostRate, 1)}
                </td>
                <td className="num px-3 py-3.5 text-end text-text-muted">
                  {fmtNum(row.previousLeads)}
                </td>
                <td className="px-4 py-3.5 text-end sm:px-6">
                  <Delta row={row} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-2/65 font-bold text-text">
              <td className="px-4 py-4 sm:px-6">{A ? "الإجمالي" : "Total"}</td>
              <td className="num px-3 py-4 text-end text-base">{fmtNum(report.totals.leads)}</td>
              <td className="px-3 py-4 text-end">
                <div className="num text-base text-danger">{fmtNum(report.totals.lost)}</div>
                <div className="mt-0.5 whitespace-nowrap text-[10px] font-normal text-text-subtle">
                  {fmtNum(report.totals.lostLeads)} Lead · {fmtNum(report.totals.lostOpportunities)}{" "}
                  Opportunity
                </div>
              </td>
              <td className="num px-3 py-4 text-end">{fmtPct(report.totals.lostRate, 1)}</td>
              <td className="num px-3 py-4 text-end">{fmtNum(report.totals.previousLeads)}</td>
              <td className="px-4 py-4 text-end sm:px-6">
                <Delta row={report.totals} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="border-t border-border bg-surface-2/35 px-4 py-3 text-[11px] leading-5 text-text-muted sm:px-6">
        {A
          ? "ملاحظة المطابقة: FMP يُوحَّد مع CFM / Facility Management حسب taxonomy الـCRM المعتمدة، والسجلات بلا كورس تظهر كسطر Unclassified بدل اختفائها من الإجمالي."
          : "Reconciliation note: FMP is consolidated into CFM / Facility Management by the approved CRM taxonomy, and records without a course appear as Unclassified instead of disappearing from the total."}
      </div>
    </section>
  );
}
