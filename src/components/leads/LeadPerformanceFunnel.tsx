import { ArrowDown, BadgeCheck, PhoneCall, Users } from "lucide-react";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import { performanceStages, type PerformanceGroup } from "@/lib/lead-performance";

const display = (value: number | null) => (value === null ? "—" : fmtNum(value));
const percent = (value: number | null) => (value === null ? "—" : fmtPct(value, 1));

/** Only entry and exact paid linkage form a verified cohort conversion. */
export function LeadPerformanceFunnel({
  group,
  paidReady,
}: {
  group: PerformanceGroup;
  paidReady: boolean;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const stages = performanceStages(group, paidReady);
  const entry = stages[0]!;
  const call = stages[1]!;
  const opportunity = stages[2]!;
  const paid = stages[3]!;
  const paidBarWidth = Math.max(0, Math.min(100, paid.shareOfEntries ?? 0));

  return (
    <div className="lead-funnel-layout grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
      <article
        className="lead-funnel-main relative overflow-hidden rounded-[26px] border p-5 sm:p-6"
        data-testid="lead-conversion-funnel"
      >
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold tracking-[0.12em] text-white/80">
              {ar ? "مسار التحويل المؤكد" : "Verified conversion path"}
            </p>
            <h3 className="mt-1 text-lg font-bold text-white sm:text-xl">
              {ar ? "من دخول CRM إلى تسجيل مدفوع" : "From CRM entry to paid enrollment"}
            </h3>
          </div>
          <span className="rounded-full border border-white/25 bg-white/15 px-3 py-1 text-[12px] font-semibold text-white">
            {ar ? "نفس مجموعة شهر الدخول" : "Same entry-month cohort"}
          </span>
        </div>

        <div className="relative mt-6 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
          <div className="rounded-2xl border border-white/25 bg-white/14 p-4 backdrop-blur-xl">
            <span className="flex items-center gap-2 text-[12px] font-semibold text-white/85">
              <Users size={15} aria-hidden="true" />
              {ar ? "دخلت CRM" : "Entered CRM"}
            </span>
            <strong className="num mt-2 block text-4xl font-bold leading-none text-white">
              {display(entry.count)}
            </strong>
            <p className="mt-2 text-[12px] leading-relaxed text-white/75">
              {ar ? "سجلات أُنشئت في الشهر المختار" : "Records created in the selected month"}
            </p>
          </div>

          <div
            className="hidden items-center justify-center px-1 text-white/75 sm:flex"
            aria-hidden="true"
          >
            <ArrowDown className="-rotate-90 rtl:rotate-90" size={22} />
          </div>

          <div className="rounded-2xl border border-white/25 bg-white/14 p-4 backdrop-blur-xl">
            <span className="flex items-center gap-2 text-[12px] font-semibold text-white/85">
              <BadgeCheck size={15} aria-hidden="true" />
              {ar ? "تسجيل مدفوع مرتبط مباشرة" : "Exactly linked paid enrollment"}
            </span>
            <strong className="num mt-2 block text-4xl font-bold leading-none text-white">
              {display(paid.count)}
            </strong>
            <p className="mt-2 text-[12px] leading-relaxed text-white/75">
              {paidReady
                ? ar
                  ? "فواتير مدفوعة بصافي موجب مرتبطة بأمر بيع الليد"
                  : "Positive net paid invoices linked to the lead's sale order"
                : ar
                  ? "ربط أوامر البيع غير متاح الآن"
                  : "Exact sale-order linkage is unavailable"}
            </p>
          </div>
        </div>

        <div className="relative mt-5 rounded-2xl border border-white/20 bg-white/12 px-4 py-3 backdrop-blur-xl">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[12px] font-semibold text-white/85">
              {ar ? "تحويل مدفوع مثبت من إجمالي الدخول" : "Verified paid share of all entries"}
            </span>
            <strong className="num text-2xl font-bold text-white">
              {percent(paid.shareOfEntries)}
            </strong>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20" aria-hidden="true">
            <div
              className="h-full rounded-full bg-[#79e8bc] transition-[width] duration-500"
              style={{ width: `${paidBarWidth}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-white/78">
            {ar
              ? "النسبة حد أدنى من الربط المباشر؛ Won في CRM لا يُحسب تسجيلًا مدفوعًا."
              : "A lower bound from exact linkage; CRM Won alone is not a paid enrollment."}
          </p>
        </div>
      </article>

      <aside className="lead-funnel-evidence rounded-[26px] border p-5 sm:p-6">
        <p className="text-[12px] font-bold tracking-[0.12em] text-brand">
          {ar ? "دلائل مساعدة" : "Supporting evidence"}
        </p>
        <h3 className="mt-1 text-base font-bold text-text">
          {ar ? "تُقرأ بجانب المسار، لا كمراحل داخله" : "Read alongside the path, not as its steps"}
        </h3>

        <div className="mt-4 space-y-2.5">
          <div className="lead-funnel-signal rounded-2xl border p-3.5" data-tone="violet">
            <div className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-2 text-[12px] font-semibold text-text-muted">
                <PhoneCall size={15} className="text-violet-strong" aria-hidden="true" />
                {ar ? "لها محاولة PBX موثقة" : "Documented PBX attempt"}
              </span>
              <strong className="num text-xl font-bold text-text">{display(call.count)}</strong>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
              {percent(call.stepRate)}{" "}
              {ar ? "من الليدز القابلة لمطابقة الهاتف" : "of phone-matchable leads"}
              {call.count === null
                ? ar
                  ? " · التغطية غير مكتملة"
                  : " · coverage is incomplete"
                : null}
            </p>
          </div>

          <div className="lead-funnel-signal rounded-2xl border p-3.5" data-tone="amber">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[12px] font-semibold text-text-muted">
                {ar ? "مصنّفة Opportunity الآن" : "Currently an Opportunity"}
              </span>
              <strong className="num text-xl font-bold text-text">
                {display(opportunity.count)}
              </strong>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
              {percent(opportunity.shareOfEntries)} {ar ? "من إجمالي الدخول" : "of all entries"}
              {ar
                ? " · حالة حالية، ليست انتقالًا تاريخيًا مسجلًا"
                : " · current-status proxy, not a logged transition"}
            </p>
          </div>

          <div className="lead-funnel-signal rounded-2xl border p-3.5" data-tone="rose">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[12px] font-semibold text-text-muted">
                {ar ? "حالتها Lost الآن" : "Currently Lost"}
              </span>
              <strong className="num text-xl font-bold text-text">{fmtNum(group.lost)}</strong>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
              {ar
                ? "حالة حالية للمجموعة، وليست طرحًا من التسجيلات المدفوعة."
                : "Current cohort status, not a subtraction from paid enrollments."}
            </p>
          </div>
        </div>
        <p className="mt-4 border-t border-border pt-3 text-[12px] leading-relaxed text-text-muted">
          {ar
            ? `وسم Fresh الحالي: ${fmtNum(group.freshTagged)}. التصنيف الحالي منفصل عن مرحلة البيع ولا يثبت حالة الليد يوم دخوله.`
            : `Currently tagged Fresh: ${fmtNum(group.freshTagged)}. This tag is separate from sales state and does not establish the lead's entry-day status.`}
        </p>
      </aside>
    </div>
  );
}
