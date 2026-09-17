import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpenCheck,
  CalendarRange,
  Minus,
  Users,
} from "lucide-react";
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
      className={`num inline-flex items-center gap-1 font-semibold ${
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
      <div className="border-b border-border bg-gradient-to-l from-brand-soft/60 via-surface to-danger-soft/25 px-4 py-5 sm:px-6 lg:px-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/20">
                <BookOpenCheck size={20} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
                  {A ? "تحليل الكوهورت" : "Course cohort"}
                </p>
                <h2 className="text-lg font-bold text-text sm:text-xl">
                  {A ? "الليدز والخسائر حسب الكورس" : "Leads and losses by course"}
                </h2>
              </div>
            </div>
            <p className="mt-2 max-w-2xl text-xs leading-6 text-text-muted">
              {A
                ? "كل صف يبدأ بالليدز المنشأة خلال الفترة، ثم يوضح كم سجلًا من نفس المجموعة أصبح Lost ونسبته."
                : "Leads are all CRM records created in the range. Lost is the subset of that same creation cohort that ended Lost, not everything closed during the range."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:min-w-[470px]">
            <div className="rounded-2xl border border-brand/15 bg-surface/90 px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted">
                <Users size={12} />
                {A ? "ليدز الفترة" : "Period leads"}
              </div>
              <div className="num mt-1 text-xl font-bold text-brand">
                {fmtNum(report.totals.leads)}
              </div>
            </div>
            <div className="rounded-2xl border border-danger/15 bg-surface/90 px-4 py-3">
              <div className="text-[10px] font-semibold text-text-muted">
                {A ? "خسائر نفس الكوهورت" : "Lost from those leads"}
              </div>
              <div className="num mt-1 text-xl font-bold text-danger">
                {fmtNum(report.totals.lost)}
              </div>
            </div>
            <div className="col-span-2 rounded-2xl border border-border bg-surface/90 px-4 py-3 sm:col-span-1">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted">
                <CalendarRange size={12} />
                {A ? "نسبة الخسارة" : "Lost rate"}
              </div>
              <div className="num mt-1 text-xl font-bold text-text">
                {fmtPct(report.totals.lostRate, 1)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] table-fixed text-sm">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[18%]" />
            <col className="w-[28%]" />
            <col className="w-[24%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-surface-2/55 text-[10px] uppercase tracking-wide text-text-muted">
              <th className="px-5 py-3.5 text-start lg:px-7">{A ? "الكورس" : "Course"}</th>
              <th className="px-4 py-3.5 text-start">
                <span className="block">{A ? "ليدز الفترة" : "Period leads"}</span>
                <span className="num mt-0.5 block font-normal normal-case tracking-normal text-text-subtle">
                  {rangeLabel(report.currentRange, lang)}
                </span>
              </th>
              <th className="px-4 py-3.5 text-start">
                <span className="block">
                  {A ? "الخسائر من نفس الليدز" : "Lost from those leads"}
                </span>
                <span className="mt-0.5 block font-normal normal-case tracking-normal text-text-subtle">
                  {A ? "العدد والنسبة وتوزيع النوع" : "Count, rate and type split"}
                </span>
              </th>
              <th className="px-5 py-3.5 text-start lg:px-7">
                <span className="block">
                  {A ? "مقارنة بالفترة السابقة" : "Previous-period comparison"}
                </span>
                <span className="num mt-0.5 block font-normal normal-case tracking-normal text-text-subtle">
                  {rangeLabel(previous, lang)}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr
                key={row.key}
                className="border-b border-border/75 transition-colors hover:bg-brand-soft/20"
              >
                <td className="px-5 py-4 lg:px-7">
                  <div className="font-semibold text-text">{row.label}</div>
                  {row.course !== row.label && (
                    <div className="mt-0.5 text-[10px] text-text-subtle">Odoo: {row.course}</div>
                  )}
                </td>
                <td className="num px-4 py-4 text-start text-lg font-bold text-text">
                  {fmtNum(row.leads)}
                </td>
                <td className="px-4 py-4 text-start">
                  <div className="flex items-baseline gap-2">
                    <span className="num text-lg font-bold text-danger">{fmtNum(row.lost)}</span>
                    <span className="num text-xs font-semibold text-danger/80">
                      {fmtPct(row.lostRate, 1)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-danger-soft">
                    <div
                      className="h-full rounded-full bg-danger"
                      style={{
                        width: `${Math.min(100, Math.max(0, row.lostRate ?? 0))}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 whitespace-nowrap text-[10px] text-text-subtle">
                    {fmtNum(row.lostLeads)} {A ? "ليد" : "Lead"} · {fmtNum(row.lostOpportunities)}{" "}
                    {A ? "فرصة" : "Opportunity"}
                  </div>
                </td>
                <td className="px-5 py-4 text-start lg:px-7">
                  <div className="num font-semibold text-text-muted">
                    {fmtNum(row.previousLeads)}
                  </div>
                  <div className="mt-1">
                    <Delta row={row} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-2/65 font-bold text-text">
              <td className="px-5 py-4 lg:px-7">{A ? "الإجمالي" : "Total"}</td>
              <td className="num px-4 py-4 text-start text-lg">{fmtNum(report.totals.leads)}</td>
              <td className="px-4 py-4 text-start">
                <div className="flex items-baseline gap-2">
                  <span className="num text-lg text-danger">{fmtNum(report.totals.lost)}</span>
                  <span className="num text-xs text-danger/80">
                    {fmtPct(report.totals.lostRate, 1)}
                  </span>
                </div>
                <div className="mt-1 text-[10px] font-normal text-text-subtle">
                  {fmtNum(report.totals.lostLeads)} {A ? "ليد" : "Lead"} ·{" "}
                  {fmtNum(report.totals.lostOpportunities)} {A ? "فرصة" : "Opportunity"}
                </div>
              </td>
              <td className="px-5 py-4 text-start lg:px-7">
                <div className="num">{fmtNum(report.totals.previousLeads)}</div>
                <div className="mt-1">
                  <Delta row={report.totals} />
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="divide-y divide-border md:hidden">
        {report.rows.map((row) => (
          <article key={row.key} className="px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-text">{row.label}</h3>
                {row.course !== row.label && (
                  <p className="mt-0.5 text-[10px] text-text-subtle">Odoo: {row.course}</p>
                )}
              </div>
              <Delta row={row} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-brand-soft/55 p-2.5">
                <p className="text-[9px] font-semibold text-text-muted">
                  {A ? "ليدز الفترة" : "Leads"}
                </p>
                <p className="num mt-1 text-base font-bold text-brand">{fmtNum(row.leads)}</p>
              </div>
              <div className="rounded-xl bg-danger-soft/60 p-2.5">
                <p className="text-[9px] font-semibold text-text-muted">{A ? "الخسائر" : "Lost"}</p>
                <p className="num mt-1 text-base font-bold text-danger">{fmtNum(row.lost)}</p>
              </div>
              <div className="rounded-xl bg-surface-2 p-2.5">
                <p className="text-[9px] font-semibold text-text-muted">{A ? "النسبة" : "Rate"}</p>
                <p className="num mt-1 text-base font-bold text-text">{fmtPct(row.lostRate, 1)}</p>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-text-subtle">
              {A ? "الفترة السابقة" : "Previous"}: {fmtNum(row.previousLeads)} ·{" "}
              {fmtNum(row.lostLeads)} {A ? "ليد Lost" : "lost leads"} ·{" "}
              {fmtNum(row.lostOpportunities)} {A ? "فرصة Lost" : "lost opportunities"}
            </p>
          </article>
        ))}
      </div>

      <div className="border-t border-border bg-surface-2/35 px-4 py-3 text-[11px] leading-5 text-text-muted sm:px-6">
        {A
          ? "ملاحظة المطابقة: FMP يُوحَّد مع CFM / Facility Management حسب taxonomy الـCRM المعتمدة، والسجلات بلا كورس تظهر كسطر Unclassified بدل اختفائها من الإجمالي."
          : "Reconciliation note: FMP is consolidated into CFM / Facility Management by the approved CRM taxonomy, and records without a course appear as Unclassified instead of disappearing from the total."}
      </div>
    </section>
  );
}
